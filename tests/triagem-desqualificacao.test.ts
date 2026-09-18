import { describe, expect, it, vi } from "vitest";

/**
 * Triagem de contatos: o carimbo de desqualificação e a economia derivada dele.
 *
 * O risco aqui não é o cálculo — é o número virar ficção. A economia é
 * apresentada ao cliente em reais, e ele confere contra a própria folha de
 * pagamento. Então o que estes testes protegem é a fronteira entre "número
 * medido" (contatos filtrados) e "número derivado de uma régua declarada"
 * (tempo e dinheiro): sem a régua, o derivado tem de ser `null`, nunca zero e
 * nunca uma média do sistema.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  DISQUALIFY_REASONS,
  MAX_HOURLY_COST_CENTS,
  MAX_MINUTES_PER_LEAD,
  costPerLeadCents,
  isValidAttendanceCost,
  parseReason,
  reasonLabel,
} from "@/modules/agent-engine/disqualify";

describe("Motivo da desqualificação (parseReason)", () => {
  it("aceita os motivos do catálogo", () => {
    for (const r of DISQUALIFY_REASONS) {
      expect(parseReason(r.key)).toBe(r.key);
    }
  });

  it("nunca recusa a triagem por causa do motivo: valor estranho vira 'outro'", () => {
    // O valor está no carimbo; o motivo é o detalhe. Perder a desqualificação
    // inteira porque o LLM inventou uma string seria trocar o dado pelo enfeite.
    expect(parseReason("motivo_que_nao_existe")).toBe("outro");
    expect(parseReason(null)).toBe("outro");
    expect(parseReason(undefined)).toBe("outro");
    expect(parseReason(42)).toBe("outro");
    expect(parseReason({})).toBe("outro");
  });

  it("dá rótulo legível a qualquer motivo, inclusive linha antiga/desconhecida", () => {
    expect(reasonLabel("spam")).toBe("Spam ou trote");
    expect(reasonLabel("inexistente")).toBe("Outro motivo");
    expect(reasonLabel(null)).toBe("Outro motivo");
  });
});

describe("Custo do atendimento manual", () => {
  it("converte minutos + custo/hora em custo de um atendimento", () => {
    expect(costPerLeadCents({ minutesPerLead: 60, hourlyCostCents: 3000 })).toBe(3000);
    expect(costPerLeadCents({ minutesPerLead: 8, hourlyCostCents: 3000 })).toBe(400);
    expect(costPerLeadCents({ minutesPerLead: 15, hourlyCostCents: 2500 })).toBe(625);
  });

  it("arredonda uma vez só, no fim (centavo não acumula erro por lead)", () => {
    // 7 min a R$ 33,33/h = 388,85 centavos → 389, não 7 × arredondamentos.
    expect(costPerLeadCents({ minutesPerLead: 7, hourlyCostCents: 3333 })).toBe(389);
  });

  it("recusa valores que não são custo de atendimento nenhum", () => {
    expect(isValidAttendanceCost({ minutesPerLead: 0, hourlyCostCents: 3000 })).toBe(false);
    expect(isValidAttendanceCost({ minutesPerLead: -5, hourlyCostCents: 3000 })).toBe(false);
    expect(isValidAttendanceCost({ minutesPerLead: 8, hourlyCostCents: 0 })).toBe(false);
    expect(isValidAttendanceCost({ minutesPerLead: 8.5, hourlyCostCents: 3000 })).toBe(false);
  });

  it("tem teto de sanidade: o dedo escorregando não vira economia de milhões", () => {
    expect(isValidAttendanceCost({ minutesPerLead: MAX_MINUTES_PER_LEAD, hourlyCostCents: 3000 })).toBe(true);
    expect(isValidAttendanceCost({ minutesPerLead: MAX_MINUTES_PER_LEAD + 1, hourlyCostCents: 3000 })).toBe(false);
    expect(isValidAttendanceCost({ minutesPerLead: 8, hourlyCostCents: MAX_HOURLY_COST_CENTS })).toBe(true);
    expect(isValidAttendanceCost({ minutesPerLead: 8, hourlyCostCents: MAX_HOURLY_COST_CENTS + 1 })).toBe(false);
  });
});

/**
 * O contrato que o relatório precisa manter. Reproduzido aqui porque é a regra
 * que, quebrada, produz o pior resultado possível: um número inventado com
 * cara de fato.
 */
describe("Economia só existe com régua declarada", () => {
  function derive(screened: number, cost: { minutesPerLead: number; hourlyCostCents: number } | null) {
    return {
      screened,
      minutesSaved: cost ? screened * cost.minutesPerLead : null,
      savedCents: cost ? screened * costPerLeadCents(cost) : null,
    };
  }

  it("sem custo declarado, tempo e dinheiro são null — não zero", () => {
    const r = derive(90, null);
    // Zero leria como "não economizou nada", que é uma afirmação falsa sobre
    // 90 contatos filtrados. `null` é a UI dizendo "falta a régua".
    expect(r.minutesSaved).toBeNull();
    expect(r.savedCents).toBeNull();
    expect(r.screened).toBe(90);
  });

  it("a contagem de filtrados existe mesmo sem custo declarado", () => {
    expect(derive(12, null).screened).toBe(12);
  });

  it("com custo declarado, deriva tempo e dinheiro dos contatos filtrados", () => {
    const r = derive(90, { minutesPerLead: 8, hourlyCostCents: 3000 });
    expect(r.minutesSaved).toBe(720);
    expect(r.savedCents).toBe(36000); // R$ 360,00
  });

  it("zero contatos filtrados com custo declarado é zero de verdade", () => {
    const r = derive(0, { minutesPerLead: 8, hourlyCostCents: 3000 });
    expect(r.minutesSaved).toBe(0);
    expect(r.savedCents).toBe(0);
  });
});
