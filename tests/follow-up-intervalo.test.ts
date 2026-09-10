import { describe, expect, it, vi } from "vitest";

/**
 * Testes do intervalo do follow-up depois da mudança de horas para minutos.
 *
 * O risco real da migração não é o cálculo novo — é a config que JÁ ESTAVA
 * salva. Toda conta com follow-up ligado tem um `delayHours` no banco; se a
 * leitura passasse a ignorá-lo, o intervalo escolhido viraria silenciosamente o
 * padrão de 24h (ou, pior, 24 minutos) sem ninguém mexer em nada.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  DEFAULT_FOLLOWUP_CONFIG,
  MAX_FOLLOWUP_DELAY_MINUTES,
  describeFollowUp,
  parseFollowUpConfig,
} from "@/modules/follow-up/config";

describe("Leitura do intervalo (parseFollowUpConfig)", () => {
  it("usa o padrão de 24h quando a ação nunca foi configurada", () => {
    expect(parseFollowUpConfig(null).delayMinutes).toBe(24 * 60);
    expect(parseFollowUpConfig(undefined)).toEqual(DEFAULT_FOLLOWUP_CONFIG);
  });

  it("lê minutos, o formato atual", () => {
    expect(parseFollowUpConfig({ delayMinutes: 90 }).delayMinutes).toBe(90);
  });

  it("converte `delayHours` de configs antigas em vez de perder o intervalo", () => {
    expect(parseFollowUpConfig({ delayHours: 24 }).delayMinutes).toBe(1440);
    expect(parseFollowUpConfig({ delayHours: 2 }).delayMinutes).toBe(120);
  });

  it("prefere minutos quando os dois campos existem (config regravada)", () => {
    expect(parseFollowUpConfig({ delayMinutes: 30, delayHours: 24 }).delayMinutes).toBe(30);
  });

  it("aceita o intervalo curto que motivou a mudança", () => {
    expect(parseFollowUpConfig({ delayMinutes: 15 }).delayMinutes).toBe(15);
  });

  it("cai no padrão em valores fora da faixa, em vez de agendar um absurdo", () => {
    expect(parseFollowUpConfig({ delayMinutes: 0 }).delayMinutes).toBe(24 * 60);
    expect(parseFollowUpConfig({ delayMinutes: -5 }).delayMinutes).toBe(24 * 60);
    expect(parseFollowUpConfig({ delayMinutes: MAX_FOLLOWUP_DELAY_MINUTES + 1 }).delayMinutes).toBe(
      24 * 60,
    );
    expect(parseFollowUpConfig({ delayMinutes: "30" }).delayMinutes).toBe(24 * 60);
  });

  it("guarda a mensagem, com o padrão quando vier vazia", () => {
    expect(parseFollowUpConfig({ message: "  Oi, tudo bem?  " }).message).toBe("Oi, tudo bem?");
    expect(parseFollowUpConfig({ message: "   " }).message).toBe(DEFAULT_FOLLOWUP_CONFIG.message);
  });
});

describe("Resumo no card (describeFollowUp)", () => {
  it("escreve minutos abaixo de uma hora", () => {
    expect(describeFollowUp({ delayMinutes: 15, message: "x" })).toContain("15 minutos");
    expect(describeFollowUp({ delayMinutes: 1, message: "x" })).toContain("1 minuto");
  });

  it("escreve horas quando é hora cheia — 24h é mais legível que 1440 minutos", () => {
    expect(describeFollowUp({ delayMinutes: 1440, message: "x" })).toContain("24h");
  });

  it("mistura as duas unidades no quebrado", () => {
    expect(describeFollowUp({ delayMinutes: 90, message: "x" })).toContain("1h30min");
  });
});
