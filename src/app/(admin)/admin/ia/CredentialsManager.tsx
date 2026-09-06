"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectMenu } from "@/components/ui/select-menu";
import type { SafeCredential } from "@/modules/ai/credentials";
import { addAiCredential, clearAiCooldown, removeAiCredential } from "../../actions";

const PROVIDERS = [
  { value: "gemini", label: "Gemini", badge: "Google" },
  { value: "openai", label: "OpenAI", badge: "GPT" },
  { value: "grok", label: "xAI (Grok)", badge: "xAI" },
  { value: "groq", label: "Groq", badge: "inferência" },
  // Qualquer serviço com API no formato da OpenAI: DeepSeek, Together,
  // OpenRouter, Mistral, Fireworks, Ollama, vLLM… Entra sem deploy porque o
  // formato /chat/completions virou padrão de fato.
  //
  // O rótulo cita exemplos porque "Outro provedor" não dizia o que cabia ali:
  // os quatro de cima são atalhos (já têm URL no código), e esta opção é a que
  // aceita qualquer serviço.
  {
    value: "custom",
    label: "Outro provedor (DeepSeek, OpenRouter, Ollama…)",
    badge: "qualquer um",
    separatorBefore: true,
  },
];

const PROVIDER_LABEL = Object.fromEntries(PROVIDERS.map((p) => [p.value, p.label]));

/** "em 3 min" / "em 2 h" — quanto falta da quarentena. */
function untilLabel(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.ceil(min / 60);
  return h < 24 ? `${h} h` : `${Math.ceil(h / 24)} d`;
}

/**
 * Chaves de API cadastradas pelo admin, sem deploy.
 *
 * Mais de uma chave por provedor é o ponto: cada uma pode entrar num degrau
 * diferente da cadeia, então esgotada a primeira a próxima assume. A chave do
 * `.env` continua valendo como padrão de cada provedor.
 *
 * O segredo só trafega uma vez, no cadastro. Depois disso o servidor devolve
 * apenas o rótulo e os últimos quatro dígitos — o bastante para o admin saber
 * qual é qual, e nada além.
 */
export function CredentialsManager({ credentials }: { credentials: SafeCredential[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  // Estável: o modal fecha a si mesmo por efeito quando o cadastro dá certo, e
  // uma função nova a cada render faria esse efeito rodar sem parar.
  const closeModal = useCallback(() => setOpen(false), []);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display flex items-center gap-1.5 text-lg font-semibold text-white">
          Chaves de API
          <InfoHint label="chaves de api">
            Guardadas cifradas no banco (AES-256-GCM). Cadastre quantas quiser por provedor e use
            cada uma num degrau da sequência — esgotada a primeira, a próxima assume. Sem nenhuma
            cadastrada, vale a chave do .env.
          </InfoHint>
        </h2>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus size={15} aria-hidden />
          Adicionar chave
        </Button>
      </div>

      {/* Visível, não escondido na bolinha: sem isso a tela parece limitada aos
          quatro provedores da lista, quando aceita qualquer serviço com API no
          formato da OpenAI. */}
      <p className="mb-3 text-sm text-white/55">
        Além dos provedores prontos, dá para ligar qualquer serviço com API no formato da OpenAI —
        DeepSeek, OpenRouter, Together, Mistral, Ollama, vLLM — informando a URL e o modelo.
      </p>

      {rowError && (
        <Alert tone="danger" className="mb-3">
          {rowError}
        </Alert>
      )}

      {credentials.length === 0 ? (
        <p className="rounded-surface border border-dashed border-white/15 px-4 py-6 text-center text-sm text-white/50">
          Nenhuma chave cadastrada — os provedores usam o que está no .env.
        </p>
      ) : (
        <ul className="space-y-2">
          {credentials.map((c) => {
            const cooling = c.cooldownUntil ? untilLabel(c.cooldownUntil) : null;
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-surface border border-white/10 bg-white/5 p-3"
              >
                <KeyRound size={15} aria-hidden className="shrink-0 text-white/40" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                    {c.label}
                    <span className="font-mono text-micro uppercase tracking-wide text-white/45">
                      {PROVIDER_LABEL[c.provider] ?? c.provider} · ••••{c.lastFour}
                    </span>
                    {/* Quarentena é estado operacional: precisa estar à vista,
                        com o motivo, senão o admin não entende por que a chave
                        "não está sendo usada". */}
                    {cooling && <Badge tone="warn">de molho · {cooling}</Badge>}
                  </p>
                  {c.lastError && !cooling && (
                    <p className="mt-0.5 font-mono text-micro uppercase tracking-wide text-danger">
                      última falha: {c.lastError}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {cooling && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await clearAiCooldown(c.id);
                          if (!r.ok) setRowError(r.error ?? null);
                        })
                      }
                    >
                      Liberar
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Remover a chave ${c.label}`}
                    title="Remover — os degraus que a usavam voltam para a chave do .env"
                    onClick={() =>
                      start(async () => {
                        const r = await removeAiCredential(c.id);
                        if (!r.ok) setRowError(r.error ?? null);
                      })
                    }
                  >
                    <Trash2 size={15} aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AddCredentialModal open={open} onClose={closeModal} />
    </section>
  );
}

function AddCredentialModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(addAiCredential, null);
  const [provider, setProvider] = useState("gemini");
  const isCustom = provider === "custom";

  // Fecha sozinho quando gravou: o segredo não volta do servidor, então não há
  // nada para conferir na tela depois do sucesso. Num efeito, e não durante o
  // render — chamar `onClose` no corpo faria setState no componente pai em
  // plena renderização deste.
  const ok = state?.ok;
  useEffect(() => {
    if (ok && open) onClose();
  }, [ok, open, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar chave de API"
      description="Guardada cifrada no banco. Só os últimos quatro dígitos ficam visíveis depois."
    >
      <form action={formAction} className="space-y-5">
        <div>
          <p className="text-sm font-medium text-white/85">Provedor</p>
          <div className="mt-2">
            <SelectMenu
              name="provider"
              label="Provedor"
              value={provider}
              onChange={setProvider}
              options={PROVIDERS}
            />
          </div>
        </div>

        {/* Só no provedor cadastrado: os embutidos têm URL e modelos no
            código. Digitados, não escolhidos de lista — só o próprio serviço
            sabe o que oferece. */}
        {isCustom && (
          <>
            <Field
              label="URL base da API"
              htmlFor="cred-baseurl"
              hint="Termina antes de /chat/completions. Ex: https://api.deepseek.com/v1"
            >
              <Input
                {...fieldProps("cred-baseurl", { hint: true })}
                name="baseUrl"
                type="url"
                required
                placeholder="https://api.deepseek.com/v1"
              />
            </Field>

            <Field
              label="Nome do modelo"
              htmlFor="cred-model"
              hint="Exatamente como o provedor o chama."
            >
              <Input
                {...fieldProps("cred-model", { hint: true })}
                name="modelId"
                required
                placeholder="deepseek-chat"
                maxLength={120}
              />
            </Field>
          </>
        )}

        <Field
          label="Rótulo"
          htmlFor="cred-label"
          hint="Como você vai reconhecer esta chave na lista."
        >
          <Input
            {...fieldProps("cred-label", { hint: true })}
            name="label"
            placeholder="Ex: Groq conta 2"
            maxLength={60}
          />
        </Field>

        <Field
          label="Chave"
          htmlFor="cred-secret"
          hint="Colada do painel do provedor. Não será exibida de novo."
        >
          <Input
            {...fieldProps("cred-secret", { hint: true })}
            name="secret"
            type="password"
            required
            autoComplete="off"
            placeholder="sk-… / gsk_… / AIza…"
          />
        </Field>

        {state && !state.ok && <Alert tone="danger">{state.error}</Alert>}

        <div className="flex justify-end gap-2 border-t border-white/10 pt-5">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={pending} loadingLabel="Salvando">
            Salvar chave
          </Button>
        </div>
      </form>
    </Modal>
  );
}
