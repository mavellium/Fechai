import { describe, expect, it } from "vitest";
import { parseScheduleConfig } from "@/modules/scheduling/config";
import { createQrRiskAcceptance, parseQrRiskAcceptance } from "@/modules/scheduling/qr-risk-terms";
describe("proteção da fila por aceite dos riscos", () => {
  it.each([undefined, null, {}, { version: "old" }])("flag sozinha não libera QR: %j", (risk) => {
    expect(parseScheduleConfig({ clinicorpQrEnabled: true, clinicorpQrConsentAt: new Date().toISOString(), clinicorpQrRiskAcceptance: risk }).clinicorpQrEnabled).toBe(false);
  });
  it("aceite completo permite a opção, sem ligar flag desligada", () => {
    const risk = createQrRiskAcceptance("Ana Costa", "user-1");
    expect(parseScheduleConfig({ clinicorpQrEnabled: true, clinicorpQrRiskAcceptance: risk }).clinicorpQrEnabled).toBe(true);
    expect(parseScheduleConfig({ clinicorpQrEnabled: false, clinicorpQrRiskAcceptance: risk })).toMatchObject({ clinicorpQrEnabled: false, clinicorpQrRiskAcceptance: risk });
  });
  it.each(["responsibleName", "acceptedByUserId", "acceptedAt", "termsText"])("registro sem %s não autoriza fila", (field) => {
    const risk: Record<string, unknown> = { ...createQrRiskAcceptance("Ana Costa", "user-1") }; delete risk[field];
    expect(parseQrRiskAcceptance(risk)).toBeUndefined();
  });
  it("texto alterado, data inválida e versão antiga exigem novo aceite", () => {
    const risk = createQrRiskAcceptance("Ana Costa", "user-1");
    for (const change of [{ termsText: "changed" }, { acceptedAt: "invalid" }, { version: "old" }]) expect(parseQrRiskAcceptance({ ...risk, ...change })).toBeUndefined();
  });
});
