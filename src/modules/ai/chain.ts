import { prisma } from "@/lib/prisma";
import { AI_MODELS, findModel, type AiModelInfo } from "./catalog";
import { getActiveModelId } from "./settings";

/**
 * A cadeia de fallback da IA: quem responde, e quem assume quando o anterior
 * falha.
 *
 * Antes isso era fixo no código (`getGeminiFallbackChain`: Gemini free → Grok
 * → Groq), então mudar a ordem ou acrescentar um provedor pedia deploy. Agora
 * o admin monta a sequência em /admin/ia e cada degrau aponta para uma
 * credencial — o que permite mais de uma chave do mesmo provedor: esgotada a
 * primeira, a próxima assume.
 *
 * **A cadeia do código continua sendo o padrão** enquanto não houver nenhum
 * degrau cadastrado. Uma instalação que nunca abriu essa tela não pode ficar
 * sem fallback por omissão — seria uma regressão silenciosa no atendimento.
 */

export type ChainStep = {
  /** Id do degrau no banco; `null` quando veio do padrão do código. */
  id: string | null;
  model: AiModelInfo;
  /** Credencial explícita, ou `null` para a chave do `.env` do provedor. */
  credentialId: string | null;
  credentialLabel: string | null;
  /** Em quarentena até este instante — o resolvedor pula degraus assim. */
  cooldownUntil: Date | null;
};

const CACHE_TTL_MS = 30_000;
let cache: { steps: ChainStep[]; expiresAt: number } | null = null;

/** Invalida o cache — chame depois de qualquer escrita na cadeia. */
export function invalidateChainCache() {
  cache = null;
}

/**
 * A cadeia configurada, na ordem de tentativa.
 *
 * Cacheada por 30s pelo mesmo motivo de `settings.ts`: o agente resolve isto a
 * cada turno, e sem cache seria um SELECT por mensagem do WhatsApp.
 */
export async function getChain(): Promise<ChainStep[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.steps;

  let steps: ChainStep[] = [];
  try {
    const rows = await prisma.aiFallbackStep.findMany({
      where: { enabled: true },
      orderBy: { position: "asc" },
      include: { credential: true },
    });

    steps = rows
      .map((r): ChainStep | null => {
        const cred = r.credential;

        // Provedor cadastrado pelo admin: o "modelo" não vem do catálogo, é
        // montado da própria credencial (URL base + nome do modelo digitado).
        const model =
          cred?.provider === "custom" && cred.baseUrl && cred.modelId
            ? {
                id: cred.modelId,
                provider: "custom" as const,
                label: cred.label,
                tier: "paid" as const,
                description: "Provedor cadastrado no painel.",
                limits: "—",
                pricing: "—",
                envKey: "" as const,
                baseUrl: cred.baseUrl,
              }
            : findModel(r.modelId);

        // Modelo que saiu do catálogo: o degrau é ignorado, não quebra a
        // cadeia inteira.
        if (!model) return null;
        return {
          id: r.id,
          model,
          credentialId: r.credentialId,
          credentialLabel: cred?.label ?? null,
          cooldownUntil: cred?.cooldownUntil ?? null,
        };
      })
      .filter((s): s is ChainStep => s !== null);
  } catch (err) {
    // Banco fora do ar não pode calar o agente — cai no padrão do código.
    console.error("[ai/chain] falha ao ler a cadeia, usando o padrão", err);
  }

  if (steps.length === 0) steps = await defaultChain();

  cache = { steps, expiresAt: Date.now() + CACHE_TTL_MS };
  return steps;
}

/**
 * A cadeia embutida: modelo ativo, e depois um reserva de cada outro provedor
 * com chave neste ambiente. É o que vale enquanto o admin não montar a dele.
 */
async function defaultChain(): Promise<ChainStep[]> {
  const activeId = await getActiveModelId();
  const active = findModel(activeId);
  if (!active) return [];

  // Modelo ativo primeiro; depois um reserva de cada OUTRO provedor que tenha
  // chave neste ambiente.
  //
  // Antes isto era `getGeminiFallbackChain`, que só devolvia reservas quando o
  // ativo era um Gemini do FREE tier — a lógica original protegia a cota
  // gratuita. O efeito colateral aparecia aqui: com um Gemini pago ativo, a
  // sequência nascia com um degrau só, e a tela parecia não ter fallback
  // nenhum. Agora que a sequência é editável, o padrão certo é oferecer tudo
  // que dá para usar; quem quiser menos, remove.
  const seen = new Set([active.provider]);
  const reserves = AI_MODELS.filter((m) => {
    if (seen.has(m.provider) || !process.env[m.envKey]) return false;
    seen.add(m.provider);
    return true;
  });

  return [active, ...reserves].map((model) => ({
    id: null,
    model,
    credentialId: null,
    credentialLabel: null,
    cooldownUntil: null,
  }));
}

/**
 * A cadeia pronta para uso, sem os degraus em quarentena.
 *
 * Se TODOS estiverem de molho, devolve a cadeia inteira em vez de uma lista
 * vazia: melhor tentar uma chave provavelmente esgotada do que deixar o lead
 * sem resposta — a quarentena é uma otimização, não uma trava.
 */
export async function getUsableChain(): Promise<ChainStep[]> {
  return filterUsable(await getChain(), new Date());
}

/**
 * Tira os degraus em quarentena — separada de `getUsableChain` para ser
 * testável sem banco (a suíte do projeto roda em Node puro).
 *
 * Se TODOS estiverem de molho, devolve a cadeia inteira em vez de uma lista
 * vazia: melhor tentar uma chave provavelmente esgotada do que deixar o lead
 * sem resposta — a quarentena é uma otimização, não uma trava.
 */
export function filterUsable(steps: ChainStep[], now: Date): ChainStep[] {
  const t = now.getTime();
  const usable = steps.filter((s) => !s.cooldownUntil || s.cooldownUntil.getTime() <= t);
  return usable.length > 0 ? usable : steps;
}

/** Minutos de quarentena configurados pelo admin (0 = desligada). */
export async function getCooldownMinutes(): Promise<number> {
  try {
    const row = await prisma.aiSetting.findUnique({ where: { id: "singleton" } });
    return row?.cooldownMinutes ?? 5;
  } catch {
    return 5;
  }
}

/* ------------------------------------------------------------------ *
 * Escrita — usada pelas actions do painel admin.
 * ------------------------------------------------------------------ */

export type ChainStepInput = {
  modelId: string;
  credentialId: string | null;
  enabled: boolean;
};

/**
 * Regrava a cadeia inteira, na ordem recebida.
 *
 * Substituição completa em vez de edição degrau a degrau: a ordem é a
 * informação principal aqui, e reposicionar itens de uma lista com
 * `@@unique([position])` exigiria uma dança de updates temporários. Numa
 * transação para a cadeia nunca ficar meio gravada.
 */
export async function saveChain(steps: ChainStepInput[]): Promise<void> {
  // Um degrau vale se o modelo está no catálogo OU se aponta para uma
  // credencial (provedor cadastrado no painel, cujo modelo é digitado e por
  // definição não está no catálogo).
  const valid = steps.filter((s) => findModel(s.modelId) || s.credentialId);

  await prisma.$transaction([
    prisma.aiFallbackStep.deleteMany({}),
    ...valid.map((s, i) =>
      prisma.aiFallbackStep.create({
        data: {
          modelId: s.modelId,
          position: i,
          enabled: s.enabled,
          credentialId: s.credentialId,
        },
      }),
    ),
  ]);

  invalidateChainCache();
}

export type AdminChainRow = {
  modelId: string;
  credentialId: string | null;
  enabled: boolean;
};

/**
 * A sequência para editar no painel.
 *
 * Nunca devolve lista vazia: sem nada gravado, monta as linhas a partir do que
 * o sistema JÁ usa hoje (modelo ativo + os fallbacks com chave). A tela abria
 * vazia com um aviso de "usa o padrão do código", o que obrigava o admin a
 * adivinhar e redigitar a sequência que já estava rodando — a configuração
 * deve começar do estado real, não do zero.
 */
export async function listChainForAdmin(): Promise<AdminChainRow[]> {
  const rows = await prisma.aiFallbackStep.findMany({ orderBy: { position: "asc" } });

  if (rows.length > 0) {
    return rows.map((r) => ({
      modelId: r.modelId,
      credentialId: r.credentialId,
      enabled: r.enabled,
    }));
  }

  const fallback = await defaultChain();
  return fallback.map((s) => ({
    modelId: s.model.id,
    credentialId: null,
    enabled: true,
  }));
}
