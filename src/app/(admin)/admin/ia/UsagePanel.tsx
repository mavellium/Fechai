import type { ProviderKey } from "@/modules/ai/types";
import { PROVIDER_ENV_KEY, type ProviderUsage } from "@/modules/ai/usage";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MeterChart } from "@/components/charts/MeterChart";

const PROVIDER_LABEL: Record<ProviderKey, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  grok: "xAI (Grok)",
  groq: "Groq",
};

/** "1.234" / "12,3K" / "1,2M" — compacto o bastante pra caber num card. */
function formatTokens(n: number): string {
  if (n < 10_000) return n.toLocaleString("pt-BR");
  if (n < 1_000_000) return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}K`;
  return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
}

function NoQuotaNote({ reason }: { reason: NonNullable<ProviderUsage["noQuotaReason"]> }) {
  if (reason === "not_supported") {
    return (
      <p className="mt-2 text-xs text-white/55">
        Não é possível identificar a cota desse provedor — a API do Gemini não expõe limite/uso sem uma
        integração separada de conta de serviço do Google Cloud.
      </p>
    );
  }
  if (reason === "no_admin_key") {
    return (
      <p className="mt-2 text-xs text-white/55">
        Sem teto conhecido — o provedor só devolve a cota do plano com uma chave de administração
        separada da usada aqui, que esta versão não configura.
      </p>
    );
  }
  return <p className="mt-2 text-xs text-white/55">Ainda sem chamada recente para ler a cota.</p>;
}

/**
 * Uso por chave/provedor de IA. Três tratamentos, um por linha de dado
 * disponível (ver `src/modules/ai/usage.ts` para a razão de cada um):
 *
 * - **Groq**: teto real (headers de rate-limit) → medidor com %.
 * - **Gemini**: nenhum teto identificável → aviso, nunca um número inventado.
 * - **OpenAI/xAI**: uso capturado (tokens), sem % — precisa de credencial
 *   admin/management extra pra ter teto, fora do escopo desta entrega.
 */
export function UsagePanel({
  providers,
  historicalEstimateTokens,
  keyConfigured,
}: {
  providers: ProviderUsage[];
  historicalEstimateTokens: number;
  keyConfigured: Record<ProviderKey, boolean>;
}) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-white">Uso das chaves de IA</h2>
      <p className="mb-4 mt-1 text-sm text-white/60">
        Consumo de tokens desde que este painel passou a registrar — sem histórico de antes disso (ver
        nota abaixo).
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {providers.map((p) => {
          const configured = keyConfigured[p.provider];
          return (
            <Card key={p.provider}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-white">{PROVIDER_LABEL[p.provider]}</span>
                <Badge tone={configured ? "success" : "neutral"}>
                  {configured ? `${PROVIDER_ENV_KEY[p.provider]} ok` : `sem ${PROVIDER_ENV_KEY[p.provider]}`}
                </Badge>
              </div>

              {p.percentUsed !== null ? (
                <div className="mt-3">
                  <MeterChart value={p.percentUsed / 100} label="cota do minuto atual" />
                </div>
              ) : (
                <NoQuotaNote reason={p.noQuotaReason!} />
              )}

              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-white/5 pt-3">
                <div>
                  <dt className="font-mono text-micro uppercase tracking-wide text-white/55">hoje</dt>
                  <dd className="mt-0.5 font-mono text-sm tabular-nums text-white/80">
                    {formatTokens(p.tokensToday)} tokens
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-micro uppercase tracking-wide text-white/55">30 dias</dt>
                  <dd className="mt-0.5 font-mono text-sm tabular-nums text-white/80">
                    {formatTokens(p.tokensLast30Days)} tokens
                  </dd>
                </div>
              </dl>
            </Card>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-white/50">
        ≈ {formatTokens(historicalEstimateTokens)} tokens estimados nas conversas geradas antes desta
        instrumentação — estimativa grosseira (tamanho do histórico de mensagens ÷ 4, uma aproximação
        comum de caracteres por token), atribuída inteira ao modelo ativo hoje. Não reflete trocas de
        modelo nem o fallback automático (Gemini → Grok → Groq) que pode ter respondido no lugar do
        modelo ativo em qualquer momento do passado — não há registro de qual provedor gerou cada
        mensagem antes de hoje.
      </p>
    </section>
  );
}
