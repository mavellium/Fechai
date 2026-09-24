import { z } from "zod";

/** Formato público e versionado usado em exportação, importação e cópia. */
export const AGENT_PACKAGE_FORMAT = "fechai-agent" as const;
export const AGENT_PACKAGE_VERSION = 1 as const;
export const AGENT_PACKAGE_EXTENSION = ".fechai-agent.json";
// O teto global das Server Actions é 50MB. Reserva 5MB para o envelope
// multipart e permite transportar bases de conhecimento realmente úteis.
export const MAX_AGENT_PACKAGE_BYTES = 45 * 1024 * 1024;

const portableActionSchema = z.object({
  key: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  config: z.unknown().nullable().default(null),
});

const portableDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(40_000_000),
});

export const agentPackageSchema = z.object({
  format: z.literal(AGENT_PACKAGE_FORMAT),
  version: z.literal(AGENT_PACKAGE_VERSION),
  exportedAt: z.string().datetime(),
  source: z.object({ tenantName: z.string().max(200).optional() }).optional(),
  agent: z.object({
    name: z.string().trim().min(1).max(60),
    systemPrompt: z.string().max(100_000),
    objective: z.string().max(10_000),
    personaDraft: z.unknown().nullable().default(null),
    variableDefinitions: z.array(z.object({ key: z.string(), description: z.string() })).max(20).default([]),
    listenAudio: z.boolean(),
    stopOnEmoji: z.boolean(),
    speakReplies: z.boolean(),
    voiceStyle: z.string().max(100),
    voicePrompt: z.string().max(1200).default(""),
    speechBlocklist: z.string().max(20_000),
    /** Só voz pronta. Modelos gravados são pessoais e não são portáveis. */
    catalogVoiceKey: z.string().max(100).nullable(),
  }),
  actions: z.array(portableActionSchema).max(50),
  knowledge: z.array(portableDocumentSchema).max(2_000),
});

export type AgentPackage = z.infer<typeof agentPackageSchema>;

export function parseAgentPackage(raw: unknown):
  | { ok: true; data: AgentPackage }
  | { ok: false; error: string } {
  const parsed = agentPackageSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error:
        issue?.path[0] === "version"
          ? "Este arquivo usa uma versão de agente que ainda não é compatível."
          : "O arquivo não contém um agente válido do fechai.",
    };
  }
  return { ok: true, data: parsed.data };
}

/** Nome seguro para Content-Disposition; o nome legível segue em filename*. */
export function safeAgentFilename(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "agente"}${AGENT_PACKAGE_EXTENSION}`;
}
