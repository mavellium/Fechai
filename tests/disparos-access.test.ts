import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  product: vi.fn(),
  tenant: vi.fn(),
  connection: vi.fn(),
  templates: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  recipients: vi.fn(),
  recent: vi.fn(),
  findRecipient: vi.fn(),
}));
vi.mock("@/lib/require-product", () => ({
  requireProductAccess: mocks.product,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/broadcasts/connection", () => ({
  getBroadcastConnection: mocks.connection,
}));
vi.mock("@/modules/broadcasts/recent", () => ({
  recentlyContacted: mocks.recent,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenant },
    broadcastCampaign: { findFirst: mocks.find, updateMany: mocks.update },
    broadcastRecipient: {
      findMany: mocks.recipients,
      findUnique: mocks.findRecipient,
    },
  },
}));
import { requireBroadcastAccess } from "@/modules/broadcasts/access";
import {
  getBroadcastDetails,
  startBroadcast,
  pauseBroadcast,
  resumeBroadcast,
  sendBroadcastTest,
  exportBroadcast,
} from "@/app/(dashboard)/disparos/actions";
const template = {
  id: "t",
  name: "ola",
  language: "pt_BR",
  header: "",
  footer: "",
  body: "Olá",
  parameterCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.product.mockResolvedValue({
    session: {
      user: { tenantId: "tenant-a", id: "user-a", email: "owner@example.test" },
    },
  });
  mocks.tenant.mockResolvedValue({
    id: "tenant-a",
    status: "active",
    metaWhatsappEnabled: true,
  });
  mocks.connection.mockResolvedValue({
    phoneNumberId: "phone-a",
    provider: { listBroadcastTemplates: mocks.templates },
  });
  mocks.templates.mockResolvedValue([template]);
  mocks.find.mockResolvedValue({
    id: "campaign-a",
    tenantId: "tenant-a",
    status: "draft",
    phoneNumberId: "phone-a",
    template,
  });
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.recipients.mockResolvedValue([]);
  mocks.recent.mockResolvedValue([]);
  mocks.findRecipient.mockResolvedValue(null);
});

describe("autorização de Disparos", () => {
  it.each([
    { metaWhatsappEnabled: false, status: "active" },
    { metaWhatsappEnabled: true, status: "suspended" },
    null,
  ])("bloqueia acesso sem liberação/conta ativa", async (tenant) => {
    mocks.tenant.mockResolvedValue(tenant);
    await expect(requireBroadcastAccess()).rejects.toThrow("NOT_FOUND");
    await expect(startBroadcast("id", true)).rejects.toThrow("NOT_FOUND");
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("repassa a proteção de papel do produto", async () => {
    mocks.product.mockRejectedValue(new Error("AFFILIATE_ONLY"));
    await expect(requireBroadcastAccess()).rejects.toThrow("AFFILIATE_ONLY");
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
  it("lê destinatários só da conta autenticada", async () => {
    mocks.recipients.mockResolvedValue([]);
    await getBroadcastDetails("campaign-b");
    expect(mocks.recipients).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "campaign-b", campaign: { tenantId: "tenant-a" } },
      }),
    );
  });
  it("não confirma campanha de outro tenant", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await startBroadcast("campaign-b", true)).ok).toBe(false);
    expect(mocks.find).toHaveBeenCalledWith({
      where: { id: "campaign-b", tenantId: "tenant-a" },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("exige consentimento e reconfirma o template aprovado", async () => {
    expect((await startBroadcast("campaign-a", false)).ok).toBe(false);
    mocks.templates.mockResolvedValue([]);
    expect((await startBroadcast("campaign-a", true)).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("faz transição condicional e confirmação repetida não reenvia", async () => {
    expect((await startBroadcast("campaign-a", true)).ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "campaign-a", tenantId: "tenant-a", status: "draft" },
      data: expect.objectContaining({
        status: "queued",
        confirmedAt: expect.any(Date),
        confirmedBy: "user-a",
        confirmedByLabel: "owner@example.test",
        consentVersion: "whatsapp-opt-in-v1",
      }),
    });
    mocks.find.mockResolvedValue({ status: "queued" });
    expect((await startBroadcast("campaign-a", true)).ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it("não confirma campanha cancelada ou com remetente trocado", async () => {
    mocks.connection.mockResolvedValue(null);
    expect((await startBroadcast("campaign-a", true)).ok).toBe(false);
    mocks.find.mockResolvedValue({ status: "cancelled" });
    expect((await startBroadcast("campaign-a", true)).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("controles de disparos", () => {
  it("reconfere contatos recentes e exige reconhecimento explícito", async () => {
    mocks.recent.mockResolvedValue(["5511987654321"]);
    expect((await startBroadcast("campaign-a", true)).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect((await startBroadcast("campaign-a", true, {}, true)).ok).toBe(true);
  });
  it("pausa apenas a campanha da sessão e preserva os destinatários", async () => {
    await pauseBroadcast("campaign-b");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "campaign-b", tenantId: "tenant-a", status: "queued" },
        data: expect.objectContaining({ status: "paused" }),
      }),
    );
    expect(mocks.recipients).not.toHaveBeenCalled();
  });
  it("não retoma um remetente diferente", async () => {
    mocks.find.mockResolvedValue({
      id: "c",
      status: "paused",
      phoneNumberId: "other",
    });
    expect((await resumeBroadcast("c")).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("teste e exportação não acessam campanha de outro tenant", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await sendBroadcastTest("foreign", "5511987654321")).ok).toBe(
      false,
    );
    await expect(exportBroadcast("foreign")).rejects.toThrow("não encontrado");
    expect(mocks.findRecipient).not.toHaveBeenCalled();
    expect(mocks.recipients).not.toHaveBeenCalled();
  });
  it("repetir teste para o mesmo número não chama a Meta novamente", async () => {
    mocks.find.mockResolvedValue({
      id: "campaign-a",
      recipients: [{ id: "sample" }],
    });
    mocks.findRecipient.mockResolvedValue({ status: "sent" });
    expect((await sendBroadcastTest("campaign-a", "5511987654321")).ok).toBe(
      true,
    );
    expect(mocks.connection).not.toHaveBeenCalled();
  });
});
