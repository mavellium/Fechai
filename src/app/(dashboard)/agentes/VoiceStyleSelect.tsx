"use client";

import { useId, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { InfoHint } from "@/components/ui/info-hint";
import { SelectMenu } from "@/components/ui/select-menu";
import { VOICE_STYLES, parseVoiceStyle } from "@/modules/voice/style";
import { setAgentVoiceStyle, type Result } from "./actions";

/**
 * Como a voz se comporta ao falar (`Agent.voiceStyle`).
 *
 * `SelectMenu`, não `<select>` nativo: o menu do sistema abre claro dentro do
 * painel escuro (ver components/ui/select-menu.tsx).
 *
 * A explicação de cada opção vive na bolinha de dúvida, não em parágrafo fixo:
 * é texto que se lê uma vez e depois só atrapalha quem já escolheu. O **aviso**
 * da opção mais expressiva é a exceção e fica à vista — é consequência, não
 * contexto, e esconder consequência atrás de hover é como o "HAHAHA" apareceu.
 *
 * Salva na hora, como os toggles ao lado. Falhou, volta o valor anterior: um
 * estilo na tela que não está no banco faria a próxima resposta sair diferente
 * do que a tela promete.
 */
export function VoiceStyleSelect({ agentId, initial }: { agentId: string; initial: string }) {
  const [value, setValue] = useState(() => parseVoiceStyle(initial).key);
  const [state, setState] = useState<Result | null>(null);
  const [, startTransition] = useTransition();
  const labelId = useId();

  const atual = parseVoiceStyle(value);

  function change(next: string) {
    const anterior = value;
    setValue(parseVoiceStyle(next).key);
    setState(null);
    startTransition(async () => {
      const res = await setAgentVoiceStyle(agentId, next);
      if (!res.ok) setValue(anterior);
      setState(res);
    });
  }

  return (
    <div className="mt-5 border-t border-white/10 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <h4 id={labelId} className="flex items-center gap-1.5 font-display text-sm font-semibold text-white">
          Como ele fala
          <InfoHint label="como ele fala">
            Vale para todo áudio do agente — a resposta automática e o “enviar como áudio” em
            Conversas.
            <ul className="mt-2 space-y-1">
              {VOICE_STYLES.map((s) => (
                <li key={s.key}>
                  <strong className="font-medium text-white">{s.label}:</strong> {s.description}
                </li>
              ))}
            </ul>
          </InfoHint>
        </h4>
        <div className="min-w-[13rem]">
          <SelectMenu
            options={VOICE_STYLES.map((s) => ({ value: s.key, label: s.label }))}
            value={value}
            onChange={change}
            labelledBy={labelId}
            label="Como o agente fala"
            size="sm"
          />
        </div>
      </div>

      {atual.warning && (
        <p className="mt-2 flex max-w-prose items-start gap-2 text-sm text-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>{atual.warning}</span>
        </p>
      )}

      <div className="mt-3" aria-live="polite">
        <FormFeedback error={state?.error} info={state?.ok ? state.info : undefined} />
      </div>
    </div>
  );
}
