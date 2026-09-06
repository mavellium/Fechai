import { prisma } from "@/lib/prisma";
import type { LlmUsage, ProviderKey } from "./types";

/**
 * Consumo de tokens por provedor de IA, para /admin/ia.
 *
 * Três fontes bem diferentes, cada uma com sua honestidade:
 *
 * 1. **Uso real, a partir de agora** (`AiUsageDaily`, gravado por
 *    `recordUsage` a cada resposta bem-sucedida do orquestrador). Preciso e
 *    atribuído ao provedor que DE FATO respondeu — inclusive quando foi um
 *    fallback (Gemini → Grok → Groq).
 * 2. **Teto real, só a Groq** (`recordRateLimitHeaders`, cache em memória do
 *    último header lido). A Groq devolve `x-ratelimit-limit-tokens` /
 *    `x-ratelimit-remaining-tokens` em toda chamada — teto verdadeiro do
 *    plano, sem precisar de credencial extra. OpenAI e xAI têm APIs de
 *    uso/billing, mas exigem uma segunda chave mais privilegiada (Admin key /
 *    Management key) que o projeto não tem hoje — por isso mostram tokens sem
 *    %. O Gemini (5 dos 8 modelos do catálogo) não expõe cota nenhuma sem uma
 *    integração OAuth/conta-de-serviço do Google Cloud à parte — por isso
 *    nunca aparece com %, só o aviso de "não é possível identificar".
 * 3. **Estimativa retroativa** (`estimateHistoricalTokens`): antes desta
 *    instrumentação, nenhuma mensagem grava qual provedor a gerou — e existe
 *    fallback automático silencioso, então mesmo sabendo "qual era o modelo
 *    ativo" numa data não dá pra saber quem respondeu de verdade. A única
 *    aproximação possível é contar TODO o histórico de mensagens `assistant`
 *    e atribuir ao provedor ativo HOJE — sabidamente errado quando houve troca
 *    de modelo, mas é o único número que os dados sustentam. Nunca gravado
 *    como se fosse `AiUsageDaily` real (corromperia a série por dia) — só
 *    somado por cima, à parte, e rotulado como estimativa em todo lugar que
 *    aparece.
 */

const CHARS_PER_TOKEN = 4; // aproximação padrão (não é medição — é heurística)
const HISTORICAL_CACHE_TTL_MS = 10 * 60_000; // recalcular full scan a cada carregamento seria caro à toa

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Grava o consumo de uma chamada bem-sucedida. Fire-and-forget por design —
 * quem chama nunca deve `await` isso de um jeito que travaria o turno do
 * agente; ver uso em `orchestrator.ts` (`.catch(() => {})`).
 */
export async function recordUsage(provider: ProviderKey, usage: LlmUsage | undefined): Promise<void> {
  if (!usage) return;
  const day = startOfUtcDay(new Date());
  await prisma.aiUsageDaily.upsert({
    where: { provider_day: { provider, day } },
    create: {
      provider,
      day,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      requests: 1,
    },
    update: {
      promptTokens: { increment: usage.promptTokens },
      completionTokens: { increment: usage.completionTokens },
      totalTokens: { increment: usage.totalTokens },
      requests: { increment: 1 },
    },
  });
}

/**
 * Cota corrente por rate-limit headers — só um snapshot em memória do último
 * lido, não persistido: o dado só é útil "agora" (a Groq manda de novo na
 * próxima chamada, então não precisa sobreviver a um restart do processo).
 */
type RateLimitSnapshot = { limitTokens: number; remainingTokens: number; readAt: number };
const rateLimitCache = new Map<ProviderKey, RateLimitSnapshot>();

/**
 * Lê headers de rate-limit de uma resposta de chat completion, quando
 * existem. Hoje só a Groq é tratada como confiável o bastante pra virar %
 * (ver o cabeçalho do arquivo) — OpenAI/xAI usam o mesmo formato de header,
 * então ler os três é barato e vira a base pronta se decidirmos habilitar %
 * pra eles depois; por ora só a Groq é lida pelo `getUsageOverview`.
 */
export function recordRateLimitHeaders(provider: ProviderKey, headers: Headers): void {
  const limitTokens = Number(headers.get("x-ratelimit-limit-tokens"));
  const remainingTokens = Number(headers.get("x-ratelimit-remaining-tokens"));
  if (!Number.isFinite(limitTokens) || limitTokens <= 0 || !Number.isFinite(remainingTokens)) return;
  rateLimitCache.set(provider, { limitTokens, remainingTokens, readAt: Date.now() });
}

let historicalCache: { estimate: number; expiresAt: number } | null = null;

/**
 * Estimativa grosseira de tokens já gerados ANTES desta instrumentação: soma
 * o tamanho de todo o histórico de mensagens `assistant` (aproximação de
 * ~4 caracteres por token) e devolve como um único número — atribuído, na UI,
 * ao provedor ativo hoje. Sem índice em `role` (schema atual), então é um
 * sequential scan; cacheado em memória porque é leitura de página admin, não
 * hot path de usuário, e o número não muda rápido o bastante pra justificar
 * recalcular a cada carregamento.
 */
export async function estimateHistoricalTokens(): Promise<number> {
  if (historicalCache && historicalCache.expiresAt > Date.now()) return historicalCache.estimate;

  let estimate = 0;
  try {
    const rows = await prisma.$queryRaw<{ total: bigint | null }[]>`
      SELECT SUM(LENGTH(content))::bigint AS total FROM "Message" WHERE role = 'assistant'
    `;
    const totalChars = Number(rows[0]?.total ?? 0);
    estimate = Math.round(totalChars / CHARS_PER_TOKEN);
  } catch (err) {
    console.error("[ai/usage] falha ao estimar uso histórico", err);
  }

  historicalCache = { estimate, expiresAt: Date.now() + HISTORICAL_CACHE_TTL_MS };
  return estimate;
}

export type ProviderUsage = {
  provider: ProviderKey;
  /** Tokens reais gravados hoje (dia UTC corrente), via `recordUsage`. */
  tokensToday: number;
  /** Tokens reais gravados nos últimos 30 dias. */
  tokensLast30Days: number;
  /**
   * `null` = sem teto conhecido pra este provedor (Gemini: nunca; OpenAI/xAI:
   * não nesta entrega — precisariam de uma credencial admin/management extra).
   * Só a Groq preenche, e só quando já houve pelo menos uma chamada recente
   * (o teto vem do header da última resposta, não de um valor fixo).
   */
  percentUsed: number | null;
  /** Motivo de `percentUsed` ser `null`, pra UI decidir a mensagem certa. */
  noQuotaReason: "not_supported" | "no_admin_key" | "no_recent_call" | null;
};

const NO_QUOTA_REASON: Record<ProviderKey, "not_supported" | "no_admin_key"> = {
  gemini: "not_supported",
  openai: "no_admin_key",
  grok: "no_admin_key",
  groq: "no_admin_key", // sobrescrito abaixo quando há snapshot de header
  // Provedor cadastrado pelo admin: não há como saber a cota de um serviço
  // arbitrário, e chutar seria pior que dizer que não sabemos.
  custom: "no_admin_key",
};

/**
 * Env var da CHAVE do provedor — não do modelo. Fonte única (a página e o
 * painel client leem daqui) porque vários modelos do catálogo (`AI_MODELS`)
 * dividem a mesma chave de provedor: 5 dos 8 modelos são Gemini.
 */
export const PROVIDER_ENV_KEY: Record<ProviderKey, string> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  grok: "XAI_API_KEY",
  groq: "GROQ_API_KEY",
  // Provedor customizado não tem env var — a chave vem sempre do banco.
  custom: "",
};

/** Uso dos 4 provedores, pra montar o painel de `/admin/ia`. */
export async function getUsageOverview(): Promise<{
  providers: ProviderUsage[];
  historicalEstimateTokens: number;
}> {
  const today = startOfUtcDay(new Date());
  const since30d = new Date(today.getTime() - 29 * 86_400_000);

  const [todayRows, last30dRows, historicalEstimateTokens] = await Promise.all([
    prisma.aiUsageDaily.findMany({ where: { day: today } }),
    prisma.aiUsageDaily.findMany({ where: { day: { gte: since30d } } }),
    estimateHistoricalTokens(),
  ]);

  const todayByProvider = new Map(todayRows.map((r) => [r.provider, r.totalTokens]));
  const last30dByProvider = new Map<string, number>();
  for (const r of last30dRows) {
    last30dByProvider.set(r.provider, (last30dByProvider.get(r.provider) ?? 0) + r.totalTokens);
  }

  const providers: ProviderKey[] = ["gemini", "openai", "grok", "groq"];
  return {
    providers: providers.map((provider) => {
      const snapshot = rateLimitCache.get(provider);
      const percentUsed =
        provider === "groq" && snapshot
          ? Math.round(((snapshot.limitTokens - snapshot.remainingTokens) / snapshot.limitTokens) * 100)
          : null;
      return {
        provider,
        tokensToday: todayByProvider.get(provider) ?? 0,
        tokensLast30Days: last30dByProvider.get(provider) ?? 0,
        percentUsed,
        noQuotaReason:
          percentUsed !== null ? null : provider === "groq" && !snapshot ? "no_recent_call" : NO_QUOTA_REASON[provider],
      };
    }),
    historicalEstimateTokens,
  };
}
