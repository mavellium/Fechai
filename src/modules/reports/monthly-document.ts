import type { MonthlyReport } from "./monthly";

/*
 * O documento que sai para a clínica: só o conteúdo aprovado.
 *
 * Arquitetura do relatório mensal, em três passos que não se misturam:
 *   1. o motor de dados calcula e valida (`evaluateMonthlyMetrics`, selo,
 *      limitações) — é a única origem de número;
 *   2. a IA só redige a partir desses números (`monthly-analysis.ts`), e o que
 *      ela escreve é rascunho até a Mavellium conferir e salvar;
 *   3. o PDF apresenta só o que foi aprovado e versionado: o snapshot do
 *      fechamento, com o número da versão.
 *
 * `approvedDocument` é a fronteira do passo 3. O gerador de PDF recebe o
 * relatório e passa por aqui antes de desenhar qualquer coisa, então nada
 * interno chega ao arquivo — não por um botão de esconder, mas porque o dado
 * não está no documento: registros individuais, valores antes das correções,
 * as correções em si, a origem presumida da mensalidade, os status crus do
 * Clinicorp e a conversa de onde o caso do mês foi lido. Notas da IA, contexto
 * do administrador e a central de pendências nunca fizeram parte do relatório.
 */

declare const approved: unique symbol;
/** Um `MonthlyReport` que já passou por `approvedDocument`. */
export type MonthlyDocument = MonthlyReport & { readonly [approved]: true;
  /** Houve indicador corrigido à mão pela Mavellium: o documento avisa, sem dizer qual nem quanto. */
  manualAdjustments: boolean };

export function approvedDocument(r: MonthlyReport): MonthlyDocument {
  // Lista explícita do que fica de fora; o resto é o conteúdo do relatório.
  const { evidence: _evidence, automatic: _automatic, revision: _revision, assumptionsFromMonth: _inherited,
    investmentSource: _source, clinicorpIntegrationState: _state, metricOverrides, caseFacts, ...content } = r;
  void _evidence; void _automatic; void _revision; void _inherited; void _source; void _state;
  const manualHours = metricOverrides?.current.assumedHours;
  const adjusted = Boolean(metricOverrides && (Object.keys(metricOverrides.current).length || Object.keys(metricOverrides.previous).length));
  const document: MonthlyReport & { manualAdjustments: boolean } = {
    ...content,
    clinicorpStatusTypes: [],
    // Do que foi corrigido à mão sai só o fato de ter havido correção (o
    // documento avisa) e as horas informadas, que mudam o texto da premissa.
    manualAdjustments: adjusted,
    ...(manualHours !== undefined ? { metricOverrides: { current: { assumedHours: manualHours }, previous: {} } } : {}),
    ...(caseFacts ? { caseFacts: { ...caseFacts, conversationId: "" } } : {}),
  };
  return document as MonthlyDocument;
}

/** O relatório foi aprovado (fechado) e pode ser entregue. Rascunho só existe como prévia do admin. */
export const isApproved = (r: Pick<MonthlyReport, "status">) => r.status === "ready";
