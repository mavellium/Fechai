import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(), categories: vi.fn(), create: vi.fn(), features: vi.fn(), status: vi.fn(),
  lead: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireTenant: vi.fn(async () => ({ tenantId: "tenant-logado" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  clinicorpIntegration: { updateMany: mocks.updateMany },
  agent: { findFirst: vi.fn(async () => null) }, lead: { findFirst: mocks.lead },
} }));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: vi.fn(() => null) }));
vi.mock("@/modules/whatsapp", () => ({}));
vi.mock("@/lib/widget/deploy", () => ({}));
vi.mock("@/lib/bunny", () => ({}));
vi.mock("@/modules/audit/log", () => ({}));
vi.mock("@/modules/scheduling/google", () => ({}));
vi.mock("@/modules/scheduling/features", () => ({ getCalendarFeatures: mocks.features }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ listClinicorpCategories: mocks.categories, getClinicorpStatus: mocks.status }));
vi.mock("@/modules/scheduling/repository", () => ({ createAppointment: mocks.create, hasConflictAnywhere: vi.fn(async () => false) }));

import { saveClinicorpSettingsAction } from "@/app/(dashboard)/integracoes/actions";
import { createManualAppointment } from "@/app/(dashboard)/agenda/actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}
const preferences = { businessId: "111111111111", dentistId: "222222222222", categoryDescription: "Avaliação" };
const appointment = { title: "Teste", date: "2026-09-14", time: "16:30", durationMinutes: "15", leadId: "contato-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.categories.mockResolvedValue({ ok: true, data: [{ id: "333333333333", name: "Avaliação" }] });
  mocks.features.mockResolvedValue({ clinicorpEnabled: true });
  mocks.status.mockResolvedValue({ syncEnabled: true });
  mocks.lead.mockResolvedValue({ id: "contato-1", phone: "5511999990000" });
  mocks.create.mockResolvedValue({ clinicorpSync: { status: "synced", appointmentId: "123" } });
});

describe("salvar preferências do Clinicorp", () => {
  it("grava profissional e categoria na conta autenticada e confirma o salvamento", async () => {
    const data = form({ ...preferences, tenantId: "outra-conta" });
    expect(await saveClinicorpSettingsAction(null, data)).toEqual({ ok: true, info: "Preferências salvas." });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { tenantId: "tenant-logado" }, data: preferences });
  });

  it.each(["businessId", "dentistId", "categoryDescription"])("não apaga valores salvos quando o formulário omite %s", async (key) => {
    const data = form(preferences);
    data.delete(key);
    expect(await saveClinicorpSettingsAction(null, data)).toMatchObject({ ok: false });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("erro na consulta de categorias preserva as preferências anteriores", async () => {
    mocks.categories.mockResolvedValue({ ok: false, error: "API indisponível" });
    expect(await saveClinicorpSettingsAction(null, form(preferences))).toMatchObject({ ok: false, error: "API indisponível" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("agendamento manual com Clinicorp", () => {
  it("exige contato antes de criar quando o envio está ativado", async () => {
    expect(await createManualAppointment(null, form({ ...appointment, leadId: "" }))).toMatchObject({ ok: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("permite compromisso sem contato quando o espelho está desligado", async () => {
    mocks.features.mockResolvedValue({ clinicorpEnabled: false });
    expect(await createManualAppointment(null, form({ ...appointment, leadId: "" }))).toMatchObject({ ok: true });
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("valida o contato na conta autenticada", async () => {
    mocks.lead.mockResolvedValue(null);
    expect(await createManualAppointment(null, form(appointment))).toMatchObject({ ok: false });
    expect(mocks.lead).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "contato-1", tenantId: "tenant-logado", isTest: false } }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("informa que salvou localmente e avisa que o espelho falhou, sem sugerir outro agendamento", async () => {
    mocks.create.mockResolvedValue({ clinicorpSync: { status: "failed", error: "API indisponível" } });
    const result = await createManualAppointment(null, form(appointment));
    expect(result).toMatchObject({ ok: true, info: "Compromisso salvo no fechai.", warning: expect.stringContaining("Não crie outro compromisso") });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ startsAt: new Date("2026-09-14T19:30:00Z"), durationMinutes: 15 }));
  });
});
