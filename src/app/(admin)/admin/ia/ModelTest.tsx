"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, PlayCircle, TriangleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { testAiModel, type AiTestResult } from "../../actions";

const PROVIDER_LABEL: Record<string, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  grok: "xAI (Grok)",
  groq: "Groq",
};

/**
 * Prova de qual modelo está atendendo de verdade.
 *
 * A tela dizia qual modelo estava configurado, mas o agente tem uma chain de
 * fallback (Gemini free → Grok → Groq): quando o ativo estoura a cota, outro
 * provedor responde em silêncio. Ler "Gemini 2.5 Flash" no painel não provava
 * que era o Gemini falando com os leads — e era exatamente isso que não dava
 * para testar aqui.
 *
 * O botão faz uma chamada real, pela mesma chain do orquestrador, e mostra
 * quem respondeu. Quando não é o modelo ativo, o resultado diz em destaque.
 */
export function ModelTest() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AiTestResult | null>(null);

  function run() {
    setResult(null);
    start(async () => setResult(await testAiModel()));
  }

  return (
    <div className="rounded-surface border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-white">Testar agora</h2>
          <p className="mt-0.5 text-sm text-white/55">
            Faz uma chamada real e mostra qual provedor respondeu — gasta alguns tokens.
          </p>
        </div>
        <Button onClick={run} loading={pending} loadingLabel="Chamando o modelo">
          <PlayCircle size={15} aria-hidden />
          Testar
        </Button>
      </div>

      {result && (
        <div
          role="status"
          className={`mt-4 rounded-control border p-4 ${
            !result.ok
              ? "border-danger/40 bg-danger/10"
              : result.usedFallback
                ? "border-warn/40 bg-warn/10"
                : "border-success/40 bg-success/10"
          }`}
        >
          {!result.ok ? (
            <>
              <p className="flex items-center gap-2 font-medium text-white">
                <XCircle size={16} aria-hidden className="shrink-0 text-danger" />
                Nenhum provedor respondeu
              </p>
              <p className="mt-1 text-sm text-white/70">{result.error}</p>
            </>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2 font-medium text-white">
                {result.usedFallback ? (
                  <TriangleAlert size={16} aria-hidden className="shrink-0 text-warn" />
                ) : (
                  <CheckCircle2 size={16} aria-hidden className="shrink-0 text-success" />
                )}
                Respondeu: {PROVIDER_LABEL[result.provider ?? ""] ?? result.provider} ·{" "}
                {result.modelLabel}
                {/* Com várias chaves do mesmo provedor, saber QUAL respondeu é
                    metade da resposta — sem isso o teste diria "Groq" sem
                    dizer se foi a conta 1 ou a 2. */}
                {result.credentialLabel && (
                  <span className="font-mono text-micro uppercase tracking-wide text-white/55">
                    chave: {result.credentialLabel}
                  </span>
                )}
              </p>

              {/* O ponto inteiro desta tela: quando quem responde não é quem
                  está configurado, isso precisa gritar, não ser uma nota. */}
              {result.usedFallback && (
                <p className="mt-1 text-sm text-white/75">
                  O primeiro degrau da sequência não respondeu — quem atendeu foi o próximo. É ele
                  que está falando com os leads agora.
                </p>
              )}

              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-3 font-mono text-micro uppercase tracking-wide text-white/50">
                <div>
                  <dt className="inline">id </dt>
                  <dd className="inline normal-case text-white/75">{result.model}</dd>
                </div>
                <div>
                  <dt className="inline">tempo </dt>
                  <dd className="inline tabular-nums text-white/75">{result.latencyMs} ms</dd>
                </div>
                {result.tokens !== undefined && (
                  <div>
                    <dt className="inline">tokens </dt>
                    <dd className="inline tabular-nums text-white/75">{result.tokens}</dd>
                  </div>
                )}
              </dl>

              {/* A identidade vem do SDK que executou a chamada, não do texto:
                  num teste real o Gemini respondeu "GPT-4o" quando perguntado
                  qual modelo era. Isto aqui é só sinal de que a API respondeu. */}
              {result.reply && (
                <p className="mt-3 truncate rounded-control bg-black/30 px-3 py-2 font-mono text-xs text-white/45">
                  resposta recebida: “{result.reply}”
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
