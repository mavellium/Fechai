"use client";

import { useState } from "react";
import { Check, MessageSquareText, FileText, Zap, Rocket } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { PersonaAnswers } from "@/modules/agent-engine/persona";
import { Button } from "@/components/ui/button";
import { PersonaForm } from "../PersonaForm";
import { KnowledgeManager } from "../KnowledgeManager";
import { ActionsToggles } from "../ActionsToggles";

type Doc = { id: string; title: string; status: string; createdAt: Date };

const STEPS = [
  {
    key: "persona",
    label: "Persona",
    icon: MessageSquareText,
    title: "Quem é o seu agente",
    help: "Responda como se estivesse treinando um funcionário novo. É isso que define o jeito dele falar.",
  },
  {
    key: "conhecimento",
    label: "Conhecimento",
    icon: FileText,
    title: "O que ele precisa saber",
    help: "Preços, horários, regras, perguntas frequentes. O agente responde com base nestes documentos — sem eles, ele não inventa: diz que vai verificar.",
  },
  {
    key: "acoes",
    label: "Ações",
    icon: Zap,
    title: "O que ele pode fazer",
    help: "Além de responder, o agente pode registrar o lead, agendar e passar para um humano.",
  },
  {
    key: "testar",
    label: "Testar",
    icon: Rocket,
    title: "Converse com ele",
    help: "Fale com o agente como se fosse um cliente. Nada aqui vai para o WhatsApp.",
  },
] as const;

/**
 * Passo a passo do agente. A tela antiga empilhava os três formulários (7
 * campos de persona + upload + 5 toggles) numa página só — quem chegava pela
 * primeira vez não sabia por onde começar nem quando tinha terminado.
 *
 * Os passos são estado local, não rota: cada um já salva sozinho na sua
 * própria action, então trocar de passo não perde nada e não precisa de URL
 * (mesma decisão do wizard de /onboarding).
 */
export function AgentWizard({
  agentId,
  initialStep,
  persona,
  documents,
  enabledKeys,
  planLimit,
  done,
}: {
  agentId: string;
  initialStep: number;
  persona: Partial<PersonaAnswers>;
  documents: Doc[];
  enabledKeys: string[];
  planLimit: number;
  done: Record<string, boolean>;
}) {
  const [step, setStep] = useState(initialStep);
  const current = STEPS[step];

  return (
    <div className="space-y-6">
      {/* Stepper: mostra onde a pessoa está, o que já ficou pronto, e deixa
          voltar em qualquer passo (nada aqui é sequencial de verdade). */}
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => {
          const isDone = done[s.key];
          const isCurrent = i === step;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-control border px-3 py-2 font-mono text-micro uppercase tracking-[0.15em] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
                  isCurrent
                    ? "border-white/25 bg-white/10 text-white"
                    : "border-white/10 text-white/60 hover:bg-white/5 hover:text-white",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                    isDone ? "bg-success/20 text-success" : "bg-white/10 text-white/70",
                  )}
                >
                  {isDone ? <Check size={11} /> : i + 1}
                </span>
                {s.label}
                {isDone && <span className="sr-only">(concluído)</span>}
              </button>
            </li>
          );
        })}
      </ol>

      <section className="rounded-surface border border-white/10 bg-white/5 p-6">
        <div className="mb-6 flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-iris/20 text-white"
          >
            <current.icon size={18} />
          </span>
          <div>
            <h2 className="font-display text-xl font-bold text-white">{current.title}</h2>
            <p className="mt-1 max-w-prose text-sm text-white/65">{current.help}</p>
          </div>
        </div>

        {current.key === "persona" && <PersonaForm agentId={agentId} initial={persona} />}
        {current.key === "conhecimento" && (
          <KnowledgeManager agentId={agentId} documents={documents} />
        )}
        {current.key === "acoes" && (
          <ActionsToggles agentId={agentId} enabledKeys={enabledKeys} planLimit={planLimit} />
        )}
        {current.key === "testar" && (
          <div className="space-y-4">
            <p className="text-sm text-white/70">
              O sandbox fica em Conversas — ele usa a persona, a base e as ações que você acabou de
              configurar aqui.
            </p>
            <Link href="/conversas">
              <Button variant="cta">Abrir o sandbox</Button>
            </Link>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          Voltar
        </Button>
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">
          passo {step + 1} de {STEPS.length}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          disabled={step === STEPS.length - 1}
        >
          Próximo
        </Button>
      </div>
    </div>
  );
}
