"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  composeSystemPrompt,
  PERSONA_FIELDS,
  PERSONA_GROUPS,
  type PersonaAnswers,
} from "@/modules/agent-engine/persona";
import { FormFeedback } from "@/components/ui/alert";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { StepTabs, type StepTab } from "./StepTabs";
import { savePersona } from "./actions";

const EMPTY: PersonaAnswers = {
  agentName: "",
  businessName: "",
  sector: "",
  tone: "",
  offer: "",
  avoid: "",
  objective: "",
};

/**
 * Persona do agente.
 *
 * Antes eram sete campos empilhados, sem explicação e sem nenhuma pista do que
 * o preenchimento produzia — quem chegava não sabia se estava configurando
 * aparência, texto de saudação ou comportamento. Agora os campos vêm em três
 * blocos com título ("quem ele é", "como fala", "onde a conversa chega"), cada
 * um com uma dica do que responder, e uma prévia do briefing que o agente
 * recebe: o mesmo texto que vai para o modelo, montado no cliente pela mesma
 * função do servidor (`composeSystemPrompt`).
 */
export function PersonaForm({
  agentId,
  initial,
}: {
  agentId: string;
  initial: Partial<PersonaAnswers>;
}) {
  const [state, formAction, pending] = useActionState(savePersona, null);
  const [answers, setAnswers] = useState<PersonaAnswers>({ ...EMPTY, ...initial });
  const [showPreview, setShowPreview] = useState(false);

  const preview = composeSystemPrompt(answers);

  // Um grupo por sub-aba, todas sempre montadas (ver StepTabs) — os três
  // grupos continuam sendo UM `<form>` só, com UM botão salvar.
  const tabs: StepTab[] = PERSONA_GROUPS.map((group) => ({
    key: group.key,
    label: group.legend.replace(/^\d+\.\s*/, ""),
    hint: group.hint,
    content: (
      <fieldset className="min-w-0 space-y-5">
        {/* A sub-aba ativa logo acima já mostra o nome do grupo — repetir aqui
            como título numerado, com um parágrafo embaixo, era a segunda vez
            que a mesma frase aparecia. Fica só a legenda acessível (o
            `<fieldset>` precisa de uma) e a explicação na bolinha. */}
        <legend className="sr-only">{group.legend}</legend>

        {PERSONA_FIELDS.filter((f) => f.group === group.key).map((f) => {
          // `name` já é único e estável — serve de id sem precisar de useId().
          const id = `persona-${f.name}`;
          // O schema do servidor só exige o nome do negócio; o resto é opcional.
          const required = f.name === "businessName";
          const Control = f.type === "textarea" ? Textarea : Input;

          return (
            // O hint da persona explica o que é o campo, não como preenchê-lo
            // (disso cuida o placeholder) — por isso vai na bolinha, não em
            // linha: sete parágrafos empilhados afogavam os sete campos.
            <Field key={f.name} label={f.label} htmlFor={id} about={f.hint} optional={!required}>
              <Control
                {...fieldProps(id)}
                name={f.name}
                placeholder={f.placeholder}
                value={answers[f.name]}
                onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                  setAnswers((prev) => ({ ...prev, [f.name]: e.target.value }))
                }
                required={required}
              />
            </Field>
          );
        })}
      </fieldset>
    ),
  }));

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="agentId" value={agentId} />

      {/* O aviso "isto vira instrução permanente; fato que muda vai na Base de
          conhecimento" migrou para a bolinha do título do passo (AgentWizard):
          era a terceira vez que a mesma ideia aparecia antes do primeiro campo. */}
      <StepTabs tabs={tabs} />

      {/* Prévia fechada por padrão: é para conferir, não para editar — quem
          quiser ajustar volta nos campos, que é onde o texto é gerado. */}
      <div className="rounded-surface border border-white/10 bg-black/20 p-4">
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          aria-expanded={showPreview}
          className="flex items-center gap-2 rounded-control font-mono text-micro uppercase tracking-[0.15em] text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          {showPreview ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
          {showPreview ? "Ocultar" : "Ver"} o briefing que o agente recebe
        </button>

        {showPreview && (
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-white/70">
            {preview}
          </pre>
        )}
      </div>

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="submit" loading={pending} loadingLabel="Salvando persona">
        Salvar persona
      </Button>
    </form>
  );
}
