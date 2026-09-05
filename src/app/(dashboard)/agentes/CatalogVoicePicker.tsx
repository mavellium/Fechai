"use client";

import { useRef, useState } from "react";
import { Check, Play } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CATALOG_VOICES } from "@/modules/voice/catalog";
import { previewCatalogVoice, setAgentCatalogVoice } from "./actions";

/**
 * Escolher uma voz pronta, sem gravar nada.
 *
 * Cada voz tem um play que gera a amostra sob demanda — e não ao abrir a lista.
 * Gerar as sete de uma vez custaria sete sínteses só por a pessoa ter passado
 * pela aba, e a maioria vai ouvir duas ou três antes de decidir. A amostra fica
 * em cache no componente: reouvir a mesma voz não paga de novo.
 */
export function CatalogVoicePicker({
  agentId,
  selectedKey,
  onSelected,
}: {
  agentId: string;
  /** Voz do catálogo já escolhida, se for o caso. */
  selectedKey: string | null;
  onSelected: (name: string) => void;
}) {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(selectedKey);

  // Amostras já geradas nesta visita — evita pagar de novo pelo mesmo play.
  const cacheRef = useRef<Map<string, string>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function play(key: string) {
    setError(null);
    audioRef.current?.pause();

    const cached = cacheRef.current.get(key);
    if (cached) {
      playUrl(cached);
      return;
    }

    setPlayingKey(key);
    const res = await previewCatalogVoice(key);
    setPlayingKey(null);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    cacheRef.current.set(key, res.dataUrl);
    playUrl(res.dataUrl);
  }

  function playUrl(url: string) {
    const audio = new Audio(url);
    audioRef.current = audio;
    void audio.play().catch(() => setError("Não foi possível tocar a amostra."));
  }

  async function choose(key: string, name: string) {
    setError(null);
    setSavingKey(key);
    const res = await setAgentCatalogVoice(agentId, key);
    setSavingKey(null);

    if (res.ok) {
      setCurrent(key);
      onSelected(name);
    } else {
      setError(res.error ?? "Não foi possível salvar a voz.");
    }
  }

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-white/60">
        Escolha uma voz pronta — sem precisar gravar nada. Ouça antes de decidir; dá para trocar
        quando quiser.
      </p>

      {error && <Alert tone="danger">{error}</Alert>}

      <ul className="grid gap-2 sm:grid-cols-2">
        {CATALOG_VOICES.map((v) => {
          const chosen = current === v.key;
          return (
            <li
              key={v.key}
              className={`rounded-surface border p-3 transition-colors ${
                chosen ? "border-iris/50 bg-iris/10" : "border-white/10"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-medium text-white">
                    {v.name}
                    {chosen && (
                      <span className="inline-flex items-center gap-1 font-mono text-micro uppercase tracking-[0.15em] text-iris">
                        <Check size={12} aria-hidden />
                        em uso
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-white/60">{v.description}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => play(v.key)}
                  loading={playingKey === v.key}
                  loadingLabel="Gerando amostra"
                  disabled={savingKey !== null}
                >
                  <Play size={14} aria-hidden />
                  Ouvir
                </Button>
                {!chosen && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => choose(v.key, v.name)}
                    loading={savingKey === v.key}
                    loadingLabel="Salvando"
                    disabled={savingKey !== null || playingKey !== null}
                  >
                    Usar esta voz
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
