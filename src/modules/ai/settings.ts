import { prisma } from "@/lib/prisma";
import { AI_MODELS, DEFAULT_MODEL_ID, findModel, type AiModelInfo } from "./catalog";

const SINGLETON_ID = "singleton";
const CACHE_TTL_MS = 30_000;

// O agente resolve o provider a cada turno; sem cache seria 1 SELECT por
// mensagem do WhatsApp. 30s é curto o bastante para a troca no admin valer
// quase na hora e longo o bastante para não pesar.
let cache: { modelId: string; expiresAt: number } | null = null;

/** Modelo ativo da plataforma (cai no padrão do catálogo se nada salvo). */
export async function getActiveModelId(): Promise<string> {
  if (cache && cache.expiresAt > Date.now()) return cache.modelId;

  let modelId = DEFAULT_MODEL_ID;
  try {
    const row = await prisma.aiSetting.findUnique({ where: { id: SINGLETON_ID } });
    // Se o modelo salvo saiu do catálogo, ignora e usa o padrão.
    if (row && findModel(row.modelId)) modelId = row.modelId;
  } catch (err) {
    // Banco fora do ar não pode derrubar o agente — segue no padrão.
    console.error("[ai/settings] falha ao ler modelo ativo, usando padrão", err);
  }

  cache = { modelId, expiresAt: Date.now() + CACHE_TTL_MS };
  return modelId;
}

export async function getActiveModel(): Promise<AiModelInfo> {
  const id = await getActiveModelId();
  return findModel(id) ?? AI_MODELS[0];
}

/** Troca o modelo ativo. Valida contra o catálogo antes de gravar. */
export async function setActiveModelId(modelId: string, updatedBy?: string): Promise<AiModelInfo> {
  const model = findModel(modelId);
  if (!model) throw new Error(`Modelo desconhecido: ${modelId}`);

  await prisma.aiSetting.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, modelId, updatedBy },
    update: { modelId, updatedBy },
  });

  cache = null; // troca no admin reflete no próximo turno do agente
  return model;
}

export async function getAiSettingMeta() {
  try {
    return await prisma.aiSetting.findUnique({ where: { id: SINGLETON_ID } });
  } catch {
    return null;
  }
}
