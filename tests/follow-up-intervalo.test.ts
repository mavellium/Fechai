import { describe, expect, it, vi } from "vitest";

/**
 * Testes da config do follow-up (duas esteiras, várias mensagens).
 *
 * O risco real de cada mudança de formato não é o cálculo novo — é a config
 * que JÁ ESTAVA salva. Toda conta com follow-up ligado tem no banco o formato
 * antigo (`delayHours`, depois `delayMinutes` + `message`); se a leitura
 * passasse a ignorá-lo, o intervalo e o texto escolhidos virariam em silêncio
 * a esteira padrão de 10 mensagens.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  DEFAULT_DECLINED_STEPS,
  DEFAULT_FOLLOWUP_CONFIG,
  DEFAULT_FOLLOWUP_WINDOW,
  DEFAULT_NO_REPLY_STEPS,
  MAX_FOLLOWUP_DELAY_MINUTES,
  MAX_FOLLOWUP_STEPS,
  cumulativeDelays,
  describeFollowUp,
  formatDelay,
  parseFollowUpConfig,
  splitFollowUpDelay,
  validateFollowUpConfig,
  type FollowUpConfig,
} from "@/modules/follow-up/config";

describe("Leitura da config (parseFollowUpConfig)", () => {
  it("usa as duas esteiras padrão quando a ação nunca foi configurada", () => {
    expect(parseFollowUpConfig(null)).toEqual(DEFAULT_FOLLOWUP_CONFIG);
    expect(parseFollowUpConfig(undefined)).toEqual(DEFAULT_FOLLOWUP_CONFIG);
  });

  it("a esteira padrão de quem sumiu segue a régua combinada", () => {
    expect(cumulativeDelays(DEFAULT_NO_REPLY_STEPS)).toEqual([
      30, 210, 1650, 2190, 3630, 4170, 5610, 12810, 27210, 41610,
    ]);
    expect(cumulativeDelays(DEFAULT_DECLINED_STEPS).map((m) => m / 1440)).toEqual([1, 4, 11, 26]);
  });

  it("converte o formato de mensagem única em esteira de UMA etapa, sem perder o que estava salvo", () => {
    const cfg = parseFollowUpConfig({ delayMinutes: 90, message: "  Oi, tudo bem?  " });
    expect(cfg.noReply).toEqual({
      enabled: true,
      steps: [{ delayMinutes: 90, message: "Oi, tudo bem?", ai: false }],
    });
    expect(cfg.declined).toEqual(DEFAULT_FOLLOWUP_CONFIG.declined);
  });

  it("converte `delayHours` de configs ainda mais antigas", () => {
    expect(parseFollowUpConfig({ delayHours: 24 }).noReply.steps[0].delayMinutes).toBe(1440);
    expect(parseFollowUpConfig({ delayHours: 2 }).noReply.steps[0].delayMinutes).toBe(120);
  });

  it("prefere minutos quando os dois campos antigos existem", () => {
    expect(parseFollowUpConfig({ delayMinutes: 30, delayHours: 24 }).noReply.steps[0].delayMinutes).toBe(30);
  });

  it("formato antigo com valor fora da faixa cai em 24h, não num absurdo", () => {
    expect(parseFollowUpConfig({ delayMinutes: 0 }).noReply.steps[0].delayMinutes).toBe(1440);
    expect(parseFollowUpConfig({ delayMinutes: MAX_FOLLOWUP_DELAY_MINUTES + 1 }).noReply.steps[0].delayMinutes).toBe(1440);
  });

  it("descarta etapa quebrada em vez de inventar intervalo ou texto", () => {
    const cfg = parseFollowUpConfig({
      noReply: {
        enabled: true,
        steps: [
          { delayMinutes: 60, message: "Oi" },
          { delayMinutes: 0, message: "sem espera" },
          { delayMinutes: 60, message: "   " },
          { delayMinutes: "60", message: "espera em texto" },
        ],
      },
    });
    expect(cfg.noReply.steps).toEqual([{ delayMinutes: 60, message: "Oi", ai: false }]);
  });

  it("não passa do teto de mensagens por esteira", () => {
    const steps = Array.from({ length: MAX_FOLLOWUP_STEPS + 5 }, () => ({ delayMinutes: 60, message: "Oi" }));
    expect(parseFollowUpConfig({ noReply: { enabled: true, steps } }).noReply.steps).toHaveLength(MAX_FOLLOWUP_STEPS);
  });

  it("esteira desligada continua guardando as mensagens", () => {
    const cfg = parseFollowUpConfig({ declined: { enabled: false, steps: [{ delayMinutes: 1440, message: "Oi" }] } });
    expect(cfg.declined).toEqual({ enabled: false, steps: [{ delayMinutes: 1440, message: "Oi", ai: false }] });
  });

  it("janela inválida cai no padrão", () => {
    expect(parseFollowUpConfig({ noReply: {}, window: { startHour: 22, endHour: 6 } }).window).toEqual(DEFAULT_FOLLOWUP_WINDOW);
    expect(parseFollowUpConfig({ noReply: {}, window: { startHour: 8, endHour: 20 } }).window).toEqual({ startHour: 8, endHour: 20 });
  });
});

describe("Validação da escrita (validateFollowUpConfig)", () => {
  const base: FollowUpConfig = {
    noReply: { enabled: true, steps: [{ delayMinutes: 30, message: "Oi", ai: false }] },
    declined: { enabled: true, steps: [{ delayMinutes: 1440, message: "Oi", ai: true }] },
    window: { startHour: 6, endHour: 22 },
  };

  it("aceita uma config normal", () => {
    expect(validateFollowUpConfig(base)).toBeNull();
    expect(validateFollowUpConfig(DEFAULT_FOLLOWUP_CONFIG)).toBeNull();
  });

  it("recusa esteira ligada sem mensagem — o toggle ligado não faria nada", () => {
    expect(validateFollowUpConfig({ ...base, declined: { enabled: true, steps: [] } })).toMatch(/sem nenhuma mensagem/);
    expect(validateFollowUpConfig({ ...base, declined: { enabled: false, steps: [] } })).toBeNull();
  });

  it("recusa texto em branco e espera fora da faixa", () => {
    expect(validateFollowUpConfig({ ...base, noReply: { enabled: true, steps: [{ delayMinutes: 30, message: "  ", ai: false }] } })).toMatch(/precisa de texto/);
    expect(validateFollowUpConfig({ ...base, noReply: { enabled: true, steps: [{ delayMinutes: 0, message: "Oi", ai: false }] } })).toMatch(/espera/);
  });

  it("recusa janela que termina antes de começar", () => {
    expect(validateFollowUpConfig({ ...base, window: { startHour: 22, endHour: 6 } })).toMatch(/horário de envio/);
  });
});

describe("Unidades e resumo", () => {
  it("reabre a espera na maior unidade inteira", () => {
    expect(splitFollowUpDelay(1440)).toEqual({ amount: 1, unit: "days" });
    expect(splitFollowUpDelay(180)).toEqual({ amount: 3, unit: "hours" });
    expect(splitFollowUpDelay(90)).toEqual({ amount: 90, unit: "minutes" });
  });

  it("escreve o tempo como gente fala", () => {
    expect(formatDelay(1)).toBe("1 minuto");
    expect(formatDelay(90)).toBe("1h30min");
    expect(formatDelay(1440 + 210)).toBe("1 dia e 3h30min");
  });

  it("o card resume as duas esteiras", () => {
    expect(describeFollowUp(DEFAULT_FOLLOWUP_CONFIG)).toBe(
      "sem resposta: 10 mensagens em 28 dias e 21h30min · não quer agendar: 4 mensagens em 26 dias",
    );
    expect(describeFollowUp({ ...DEFAULT_FOLLOWUP_CONFIG, declined: { enabled: false, steps: DEFAULT_DECLINED_STEPS } }))
      .toContain("não quer agendar: desligado");
  });
});
