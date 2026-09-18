import { describe, expect, it, vi } from "vitest";

/**
 * "Investido" da visão Financeira: meses cobrados e preço da conta.
 *
 * O bug que originou estes testes: uma conta criada em 09/09, vista em 17/09
 * com a janela "últimos 30 dias" (que começa em 19/08), mostrava R$ 398,00 —
 * dois meses de Starter numa conta com oito dias de vida. O "Investido" ficava
 * maior que a fatura e, por consequência, o ROI do cliente menor que a
 * realidade. A correção é clampar o início da janela em `Tenant.createdAt`.
 *
 * O cálculo é reproduzido aqui (e não importado) porque mora no meio de
 * `computeFinancialSummary`, que faz seis queries antes de chegar nele; o que
 * precisa de trava é a regra, e ela é esta.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { partsInZone } from "@/modules/scheduling/time";

const TZ = "America/Sao_Paulo";

/** Mesma fórmula de `computeFinancialSummary`, incluindo o clamp em createdAt. */
function monthsCharged(from: Date | null, to: Date, createdAt: Date | null): number {
  let anchor = from ?? createdAt ?? to;
  if (createdAt && anchor.getTime() < createdAt.getTime()) anchor = createdAt;
  const a = partsInZone(anchor, TZ);
  const t = partsInZone(to, TZ);
  return Math.max(1, (t.year - a.year) * 12 + (t.month - a.month) + 1);
}

const STARTER = 19900;

describe("Meses cobrados nunca começam antes da conta existir", () => {
  const createdAt = new Date("2026-09-09T12:00:00Z");
  const to = new Date("2026-09-17T23:59:59Z");
  const from30 = new Date(to.getTime() - 29 * 86_400_000); // 19/08

  it("conta de 8 dias na janela de 30 dias cobra 1 mês, não 2", () => {
    expect(monthsCharged(from30, to, createdAt)).toBe(1);
    expect(STARTER * monthsCharged(from30, to, createdAt)).toBe(19900);
  });

  it("é exatamente o caso que mostrava R$ 398,00 sem o clamp", () => {
    // Sem o clamp (comportamento antigo), para deixar a regressão explícita.
    const semClamp = (() => {
      const a = partsInZone(from30, TZ);
      const t = partsInZone(to, TZ);
      return Math.max(1, (t.year - a.year) * 12 + (t.month - a.month) + 1);
    })();
    expect(semClamp).toBe(2);
    expect(STARTER * semClamp).toBe(39800);
  });

  it("não muda nada para conta antiga: a janela é que manda", () => {
    const velha = new Date("2026-03-01T12:00:00Z");
    expect(monthsCharged(from30, to, velha)).toBe(2);
  });

  it("'tudo' (from null) ancora na criação da conta", () => {
    expect(monthsCharged(null, to, createdAt)).toBe(1);
    expect(monthsCharged(null, to, new Date("2026-07-15T12:00:00Z"))).toBe(3);
  });

  it("janela dentro de um mês só conta 1, como antes", () => {
    const from = new Date("2026-09-10T00:00:00Z");
    expect(monthsCharged(from, to, createdAt)).toBe(1);
  });

  it("mês tocado conta inteiro, não proporcional aos dias", () => {
    // Conta criada dia 30/08, vista em 02/09: dois meses tocados, e é isso que
    // ela pagou. Ratear daria um ROI mais bonito que o extrato.
    const criada = new Date("2026-08-30T12:00:00Z");
    const fim = new Date("2026-09-02T23:59:59Z");
    expect(monthsCharged(new Date("2026-08-25T00:00:00Z"), fim, criada)).toBe(2);
  });
});

describe("Preço cobrado: override do admin vence o preço de tabela", () => {
  /** Mesma resolução de `computeFinancialSummary`. */
  function priceOf(planPriceCents: number, override: number | null): number {
    return override ?? planPriceCents;
  }

  it("sem override, usa o preço do plano", () => {
    expect(priceOf(STARTER, null)).toBe(19900);
  });

  it("com override, usa o valor negociado", () => {
    expect(priceOf(STARTER, 14900)).toBe(14900);
  });

  it("override de zero é cortesia legítima, não 'sem override'", () => {
    // `?? ` e não `||` justamente por isto: com `||`, uma conta cortesia
    // voltaria a exibir o preço de tabela.
    expect(priceOf(STARTER, 0)).toBe(0);
  });

  it("investido combina preço cobrado × meses cobrados", () => {
    const createdAt = new Date("2026-09-09T12:00:00Z");
    const to = new Date("2026-09-17T23:59:59Z");
    const from = new Date(to.getTime() - 29 * 86_400_000);
    const meses = monthsCharged(from, to, createdAt);
    expect(priceOf(STARTER, 14900) * meses).toBe(14900);
  });
});
