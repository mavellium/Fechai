import { requireSuperadmin } from "@/lib/session";
import { AI_MODELS, getActiveModel, getAiSettingMeta } from "@/modules/ai";
import { activeEmbeddingModel } from "@/modules/ai/embeddings";
import type { ProviderKey } from "@/modules/ai/types";
import { getUsageOverview, PROVIDER_ENV_KEY } from "@/modules/ai/usage";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ModelPicker } from "./ModelPicker";
import { UsagePanel } from "./UsagePanel";

const ALL_PROVIDERS: ProviderKey[] = ["gemini", "openai", "grok", "groq"];

function Meta({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-micro uppercase tracking-wide text-white/55">{term}</dt>
      <dd className="mt-0.5 text-sm text-white/75">{children}</dd>
    </div>
  );
}

export default async function AdminIaPage() {
  await requireSuperadmin();
  const [active, meta, usage] = await Promise.all([
    getActiveModel(),
    getAiSettingMeta(),
    getUsageOverview(),
  ]);

  // A chave vive só no servidor — mandamos ao client apenas "existe ou não".
  const models = AI_MODELS.map((m) => ({ ...m, keyConfigured: Boolean(process.env[m.envKey]) }));
  const activeKeyOk = Boolean(process.env[active.envKey]);
  const embedding = activeEmbeddingModel();
  const keyConfigured = Object.fromEntries(
    ALL_PROVIDERS.map((p) => [p, Boolean(process.env[PROVIDER_ENV_KEY[p]])]),
  ) as Record<ProviderKey, boolean>;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        eyebrow="admin"
        title="Inteligência artificial"
        description="Define qual modelo responde os leads de todos os tenants. Salvo no banco — sem deploy."
      />

      <Card>
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/55">
          modelo ativo agora
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <span className="font-display text-2xl font-bold text-white">{active.label}</span>
          <span className="font-mono text-micro uppercase tracking-wide text-white/55">
            {active.provider} · {active.id}
          </span>
        </div>

        <dl className="mt-4 grid gap-3 border-t border-white/5 pt-4 sm:grid-cols-3">
          <Meta term="credencial">
            <span className={activeKeyOk ? "text-success" : "text-danger"}>
              {activeKeyOk ? `${active.envKey} ok` : `${active.envKey} ausente`}
            </span>
          </Meta>
          <Meta term="embeddings">{embedding ?? "desligado"}</Meta>
          <Meta term="alterado">
            {meta
              ? `${meta.updatedAt.toLocaleDateString("pt-BR")}${meta.updatedBy ? ` · ${meta.updatedBy}` : ""}`
              : "nunca (padrão do catálogo)"}
          </Meta>
        </dl>

        {!activeKeyOk && (
          <Alert tone="warn" className="mt-4">
            Sem a variável {active.envKey} o agente responde em modo demonstração. Configure no .env e
            reinicie o servidor.
          </Alert>
        )}
      </Card>

      <UsagePanel
        providers={usage.providers}
        historicalEstimateTokens={usage.historicalEstimateTokens}
        keyConfigured={keyConfigured}
      />

      <section>
        <h2 className="font-display text-lg font-semibold text-white">Trocar modelo</h2>
        <p className="mb-4 mt-1 text-sm text-white/60">
          Limites e preços são referência de 24/07/2026 — o Google revisa o free tier sem aviso.
        </p>
        <ModelPicker models={models} activeId={active.id} />
      </section>
    </div>
  );
}
