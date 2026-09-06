"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { SelectMenu } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import type { SafeCredential } from "@/modules/ai/credentials";
import { saveAiChain } from "../../actions";

export type ChainRow = {
  modelId: string;
  credentialId: string | null;
  enabled: boolean;
};

type ModelOption = {
  id: string;
  label: string;
  provider: string;
  /** Tem chave no `.env` deste ambiente. */
  envConfigured: boolean;
  /** Veio de uma credencial cadastrada no painel, não do catálogo. */
  custom?: boolean;
};

const PROVIDER_LABEL: Record<string, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  grok: "xAI (Grok)",
  groq: "Groq",
  custom: "Personalizado",
};

/**
 * A ordem em que a IA tenta responder.
 *
 * Antes a cadeia era fixa no código (Gemini free → Grok → Groq): mudar a ordem
 * ou pôr outro provedor no meio exigia deploy. Cada linha aqui é "tente este
 * modelo com esta chave" — e como a chave faz parte do degrau, o mesmo modelo
 * pode aparecer duas vezes com credenciais diferentes: esgotada a primeira, a
 * segunda assume.
 *
 * A lista é editada inteira e salva de uma vez (a action regrava tudo numa
 * transação): a ordem é a informação principal, e salvar linha a linha deixaria
 * a cadeia meio antiga e meio nova entre um clique e outro.
 */
export function FallbackChain({
  initial,
  models,
  credentials,
}: {
  initial: ChainRow[];
  models: ModelOption[];
  credentials: SafeCredential[];
}) {
  const [rows, setRows] = useState<ChainRow[]>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  // Quem realmente atende: o primeiro degrau LIGADO, não o primeiro da lista.
  const firstEnabledIndex = rows.findIndex((r) => r.enabled);

  function update(i: number, patch: Partial<ChainRow>) {
    setSaved(false);
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    setSaved(false);
    setRows((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function add() {
    setSaved(false);
    setRows((prev) => [
      ...prev,
      { modelId: models[0]?.id ?? "", credentialId: null, enabled: true },
    ]);
  }

  function remove(i: number) {
    setSaved(false);
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function save() {
    setError(null);
    start(async () => {
      const result = await saveAiChain(rows);
      if (result.ok) setSaved(true);
      else setError(result.error ?? "Não foi possível salvar.");
    });
  }

  /**
   * Só as chaves que servem ao modelo escolhido — mais o `.env` quando o
   * provedor tem uma. Provedor cadastrado no painel não tem `.env`: a chave
   * dele É a credencial, então ali a opção "padrão" não aparece.
   */
  function credentialOptions(modelId: string) {
    const model = models.find((m) => m.id === modelId);
    if (!model) return [];

    if (model.custom) {
      return credentials
        .filter((c) => c.provider === "custom" && c.modelId === model.id)
        .map((c) => ({ value: c.id, label: c.label, badge: `••••${c.lastFour}` }));
    }

    return [
      ...(model.envConfigured ? [{ value: "", label: "Chave do .env", badge: "padrão" }] : []),
      ...credentials
        .filter((c) => c.provider === model.provider)
        .map((c) => ({ value: c.id, label: c.label, badge: `••••${c.lastFour}` })),
    ];
  }

  return (
    <section>
      <h2 className="font-display flex items-center gap-1.5 text-lg font-semibold text-white">
        Quem responde, nesta ordem
        <InfoHint label="ordem de resposta">
          A lista já vem com a sequência que o sistema usa hoje. Reordene com as setas, troque a
          chave, desligue um degrau sem perdê-lo — e salve.
        </InfoHint>
      </h2>
      {/* A regra em uma linha, visível: é ela que faz a lista fazer sentido, e
          escondê-la na bolinha deixava a tela sem explicar o que a ordem
          significa. */}
      <p className="mb-3 mt-1 text-sm text-white/55">
        O <strong className="font-medium text-white/75">1º</strong> atende os leads. Os outros só
        entram se o anterior falhar ou estourar a cota.
      </p>

      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="rounded-surface border border-danger/30 bg-danger/10 px-4 py-4 text-center text-sm text-white/70">
            Sem nenhum degrau, a IA não tem como responder. Adicione ao menos um.
          </p>
        )}

        {rows.map((row, i) => (
          <div
            key={i}
            className={`flex flex-wrap items-center gap-2 rounded-surface border p-3 ${
              row.enabled ? "border-white/10 bg-white/5" : "border-white/5 bg-transparent opacity-50"
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-micro ${
                // O primeiro LIGADO é quem atende — destacado, porque é a
                // informação que a pessoa vem buscar nesta tela.
                i === firstEnabledIndex ? "bg-success/25 text-success" : "bg-white/10 text-white/60"
              }`}
            >
              {i + 1}º
            </span>

            <div className="min-w-48 flex-1">
              <p className="mb-1 font-mono text-micro uppercase tracking-wide text-white/40">
                modelo
              </p>
              <SelectMenu
                size="sm"
                label={`Modelo do ${i + 1}º degrau`}
                value={row.modelId}
                onChange={(modelId) => update(i, { modelId, credentialId: null })}
                options={models.map((m) => ({
                  value: m.id,
                  label: m.label,
                  badge: PROVIDER_LABEL[m.provider] ?? m.provider,
                }))}
              />
            </div>

            <div className="min-w-44">
              <p className="mb-1 font-mono text-micro uppercase tracking-wide text-white/40">
                chave
              </p>
              <SelectMenu
                size="sm"
                label={`Chave do ${i + 1}º degrau`}
                value={row.credentialId ?? ""}
                onChange={(id) => update(i, { credentialId: id || null })}
                options={credentialOptions(row.modelId)}
              />
            </div>

            <div className="flex items-center gap-1 self-end pb-0.5">
              <Button
                size="icon"
                variant="ghost"
                disabled={i === 0}
                aria-label={`Subir degrau ${i + 1}`}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={15} aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={i === rows.length - 1}
                aria-label={`Descer degrau ${i + 1}`}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={15} aria-hidden />
              </Button>
              {/* Switch, não um botão que alterna o próprio rótulo: ali o texto
                  ("ligado") dizia o estado atual e o botão prometia a ação, e
                  não dava para saber qual dos dois era. */}
              <Switch
                checked={row.enabled}
                onCheckedChange={(next) => update(i, { enabled: next })}
                label={`${i + 1}º degrau ${row.enabled ? "ligado" : "desligado"}`}
                className="mx-1"
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remover degrau ${i + 1}`}
                onClick={() => remove(i)}
              >
                <Trash2 size={15} aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={add} disabled={models.length === 0}>
          <Plus size={15} aria-hidden />
          Adicionar degrau
        </Button>
        {dirty && (
          <>
            <Button size="sm" onClick={save} loading={pending} loadingLabel="Salvando">
              Salvar sequência
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRows(initial)}>
              Desfazer
            </Button>
          </>
        )}
        {saved && !dirty && <Badge tone="success">sequência salva</Badge>}
      </div>
    </section>
  );
}
