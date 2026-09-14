import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Testes do fluxo de gerar o QR de conexão do WhatsApp.
 *
 * Vêm de um erro que só aparecia NO CELULAR — "não foi possível conectar o
 * dispositivo, tente novamente mais tarde" — enquanto a tela mostrava um
 * código aparentemente válido, com contador correndo. Duas causas somadas:
 *
 * - a tela exibia um QR já invalidado (o WhatsApp gira o código a cada ~20s e o
 *   poll descartava o código novo que vinha na resposta);
 * - a Evolution corta a sessão ao atingir `QRCODE_LIMIT` QRs gerados e passa a
 *   recusar TODA leitura. Esse contador só zera com um logout de verdade — e o
 *   nosso estava quebrado, então nunca zerava.
 *
 * Os dois modos de falha são silenciosos do lado do painel: nada na tela
 * denuncia um código morto. Por isso estão travados aqui.
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
  getQrCode: vi.fn(),
  createInstance: vi.fn(),
  ensureWebhook: vi.fn(),
  isConfigured: vi.fn(() => true),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireTenant: vi.fn(async () => ({ tenantId: "tenant-1" })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappInstance: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      update: mocks.update,
    },
    agent: { findFirst: vi.fn(async () => null) },
    lead: { findFirst: vi.fn(async () => null) },
    clinicorpIntegration: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: vi.fn(() => null) }));
vi.mock("@/modules/whatsapp", () => ({
  getWhatsAppProvider: () => ({
    isConfigured: mocks.isConfigured,
    disconnect: mocks.disconnect,
    getQrCode: mocks.getQrCode,
    createInstance: mocks.createInstance,
    ensureWebhook: mocks.ensureWebhook,
  }),
}));
vi.mock("@/lib/widget/deploy", () => ({}));
vi.mock("@/lib/bunny", () => ({}));
vi.mock("@/modules/audit/log", () => ({ recordAudit: vi.fn(), recordChange: vi.fn() }));
vi.mock("@/modules/scheduling/google", () => ({}));
vi.mock("@/modules/scheduling/features", () => ({}));
vi.mock("@/modules/scheduling/clinicorp", () => ({}));
vi.mock("@/lib/crypto", () => ({ isEncryptionConfigured: () => true }));

import { connectWhatsapp } from "@/app/(dashboard)/integracoes/actions";

/** Instância existente na conta, no estado indicado. */
function instancia(status: string) {
  mocks.findUnique.mockResolvedValue({
    id: "inst-1",
    externalId: "tenant_tenant-1",
    status,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isConfigured.mockReturnValue(true);
  mocks.getQrCode.mockResolvedValue({ status: "pending_qr", qrCode: "data:image/png;base64,AAA" });
  mocks.createInstance.mockResolvedValue({
    externalId: "tenant_tenant-1",
    status: "pending_qr",
    qrCode: "data:image/png;base64,AAA",
  });
  mocks.ensureWebhook.mockResolvedValue(true);
  mocks.upsert.mockResolvedValue({});
});

describe("Gerar o QR de conexão (connectWhatsapp)", () => {
  it("desloga a sessão velha antes de pedir o código", async () => {
    instancia("disconnected");

    const res = await connectWhatsapp();

    expect(mocks.disconnect).toHaveBeenCalledWith("tenant_tenant-1");
    expect(res).toMatchObject({ ok: true, qrCode: "data:image/png;base64,AAA" });
  });

  it("desloga também quando a instância ficou parada em pending_qr", async () => {
    // É o estado em que o contador de QRs da Evolution mais cresce: a pessoa
    // abre a tela, não escaneia, volta depois. Sem o logout, cada visita
    // empurra o contador para perto do limite que recusa a sessão.
    instancia("pending_qr");
    await connectWhatsapp();
    expect(mocks.disconnect).toHaveBeenCalledWith("tenant_tenant-1");
  });

  it("NÃO desloga um número que está atendendo", async () => {
    // "Conectar outro número" no meio do expediente não pode derrubar o
    // atendimento em curso para gerar um código que ninguém leu ainda.
    instancia("connected");
    mocks.getQrCode.mockResolvedValue({ status: "connected" });

    await connectWhatsapp();

    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it("não desloga quando ainda não existe instância", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await connectWhatsapp();

    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.createInstance).toHaveBeenCalledWith("tenant-1");
  });

  it("entrega o código mesmo se o logout falhar", async () => {
    // Sessão já limpa devolve erro, e é justamente o estado desejado. Sem QR a
    // pessoa não tem o que fazer nesta tela.
    instancia("disconnected");
    mocks.disconnect.mockRejectedValue(new Error("Evolution logout falhou (404)"));

    const res = await connectWhatsapp();

    expect(res).toMatchObject({ ok: true, qrCode: "data:image/png;base64,AAA" });
  });
});
