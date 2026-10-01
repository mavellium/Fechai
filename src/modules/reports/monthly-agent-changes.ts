import { z } from "zod";

/*
 * "O que ajustamos no agente": as mudanças do mês, uma por linha, com o tipo
 * (incluído na base, regra nova, corrigido) e a data. Escritas pela Mavellium
 * na revisão; a IA pode propor a partir do log de auditoria, nunca inventar.
 * Substitui o texto livre `adjustments`, que segue valendo nos relatórios
 * salvos antes.
 */

export const AGENT_CHANGE_KINDS = ["added", "rule", "fixed"] as const;
export type AgentChangeKind = (typeof AGENT_CHANGE_KINDS)[number];
export const AGENT_CHANGE_LABELS: Record<AgentChangeKind, string> = { added: "Incluído", rule: "Regra nova", fixed: "Corrigido" };
export const AGENT_CHANGES_MAX = 8;

export const agentChangeSchema = z.object({
  kind: z.enum(AGENT_CHANGE_KINDS),
  text: z.string().trim().min(1, "Descreva cada mudança.").max(200),
  purpose: z.string().trim().max(200).optional(),
  /** Dia da mudança (YYYY-MM-DD), quando registrado. */
  date: z.iso.date({ error: "Data inválida." }).nullable().default(null),
}).strict();
export const agentChangesSchema = z.array(agentChangeSchema).max(AGENT_CHANGES_MAX, `Use no máximo ${AGENT_CHANGES_MAX} mudanças.`);
export type ReportedAgentChange = z.infer<typeof agentChangeSchema>;

/** Nunca lança: a coluna pode estar vazia, antiga ou editada à mão. */
export function parseAgentChanges(raw: unknown): ReportedAgentChange[] {
  const parsed = agentChangesSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}
