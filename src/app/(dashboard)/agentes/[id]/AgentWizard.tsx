"use client";

import { useState } from "react";
import { Check, MessageSquareText, Ban, BrainCircuit, Sparkles, Mic, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PersonaAnswers } from "@/modules/agent-engine/persona";
import type { ScheduleConfig } from "@/modules/scheduling/config";
import type { FollowUpConfig } from "@/modules/follow-up/config";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sandbox } from "@/app/(dashboard)/conversas/Sandbox";
import { PersonaForm } from "../PersonaForm";
import { RulesForm } from "../RulesForm";
import { KnowledgeManager } from "../KnowledgeManager";
import { ActionsToggles } from "../ActionsToggles";
import { BehaviorSettings } from "../BehaviorSettings";
import { StepTabs } from "../StepTabs";

type Doc = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  fileUrl: string | null;
  fileName: string | null;
};

const STEPS = [
  {
    key: "personalidade",
    label: "Personalidade",
    icon: MessageSquareText,
    title: "Quem é o seu agente",
    help: "Responda como se estivesse treinando um funcionário novo: o nome, o tom de voz e o que ele deve oferecer.",
  },
  {
    key: "regras",
    label: "Regras",
    icon: Ban,
    title: "O que ele nunca faz",
    help: "Limites diretos: algo que o agente nunca deve fazer, prometer ou dizer. Opcional, mas evita surpresa.",
  },
  {
    key: "cerebro",
    label: "Cérebro",
    icon: BrainCircuit,
    title: "O que ele precisa saber",
    help: "Preços, horários, regras, perguntas frequentes. O agente responde com base nestes documentos — sem eles, ele não inventa: diz que vai verificar.",
  },
  {
    key: "habilidades",
    label: "Habilidades",
    icon: Sparkles,
    title: "O que ele pode fazer",
    help: "Além de responder, o agente pode marcar horário na sua agenda, avisar quando um contato está quente e chamar você. Ligue só o que você quer que ele faça sozinho.",
  },
  {
    key: "comportamento",
    label: "Comportamento",
    icon: Mic,
    title: "Como ele conversa",
    help: "Como ele se comporta na conversa: ouvir mensagens de voz, responder falando na sua voz e encerrar quando a pessoa manda só um emoji.",
  },
  {
    key: "testar",
    label: "Testar",
    icon: Rocket,
    title: "Converse com ele",
    help: "Fale como um cliente falaria. Nada aqui vai para o WhatsApp e nada vira contato ou número no relatório.",
  },
] as const;

/**
 * Passo a passo do agente: Personalidade → Regras → Cérebro → Habilidades →
 * Testar. A tela antiga empilhava tudo (7 campos de persona + regras + upload
 * + 5 toggles) numa página só — quem chegava pela primeira vez não sabia por
 * onde começar nem quando tinha terminado. Regras já foi sub-aba dentro de
 * Personalidade; voltou a ser passo próprio para ficar visível por si só, não
 * escondida dentro de outro passo.
 *
 * Os passos são estado local, não rota: cada um já salva sozinho na sua
 * própria action, então trocar de passo não perde nada e não precisa de URL
 * (mesma decisão do wizard de /onboarding).
 */
export function AgentWizard({
  agentId,
  persona,
  rules,
  documents,
  enabledKeys,
  planLimit,
  scheduleConfig,
  followUpConfig,
  enabled,
  listenAudio,
  speakReplies,
  stopOnEmoji,
  voice,
  catalogKey = null,
  voiceAvailable,
  done,
}: {
  agentId: string;
  persona: Partial<PersonaAnswers>;
  /** `avoid` cru do personaDraft — uma regra por linha (ver RulesForm). */
  rules: string;
  documents: Doc[];
  enabledKeys: string[];
  planLimit: number;
  scheduleConfig: ScheduleConfig;
  followUpConfig: FollowUpConfig;
  /** Agente ligado? Desligado, o teste não responde — a tela avisa antes. */
  enabled: boolean;
  /** Comportamentos de conversa (ver BehaviorSettings). */
  listenAudio: boolean;
  speakReplies: boolean;
  stopOnEmoji: boolean;
  /** Voz clonada do dono da conta, usada quando `speakReplies` está ligado. */
  voice: { label: string | null; createdAt: Date | null; source: string | null } | null;
  catalogKey?: string | null;
  voiceAvailable: boolean;
  done: Record<string, boolean>;
}) {
  // Abre no primeiro passo pendente — quem volta continua de onde parou em vez
  // de cair sempre na personalidade já preenchida. "Regras" e "Testar" ficam
  // de fora dessa checagem: regras é opcional (nunca deveria prender quem já
  // preencheu persona e quer seguir direto para Cérebro) e testar não tem
  // conclusão própria.
  const blocking = STEPS.filter(
    (s) => s.key !== "regras" && s.key !== "testar" && s.key !== "comportamento",
  );
  const firstPendingKey = blocking.find((s) => !done[s.key])?.key;
  const initialStep =
    firstPendingKey != null
      ? STEPS.findIndex((s) => s.key === firstPendingKey)
      : STEPS.length - 1;

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
                <s.icon size={14} aria-hidden />
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

        {current.key === "personalidade" && (
          <PersonaForm agentId={agentId} initial={persona} />
        )}
        {/* Passo próprio de novo (era sub-aba dentro de Personalidade) — o
            design original tinha 5 passos no topo, com Regras separado. */}
        {current.key === "regras" && <RulesForm agentId={agentId} initial={rules} />}
        {current.key === "cerebro" && (
          <KnowledgeManager agentId={agentId} documents={documents} />
        )}
        {/* Habilidades/Testar não têm seção interna para dividir — a sub-aba
            única existe só pela consistência visual com os outros passos. */}
        {current.key === "habilidades" && (
          <StepTabs
            tabs={[
              {
                key: "habilidades",
                label: "Habilidades",
                content: (
                  <ActionsToggles
                    agentId={agentId}
                    enabledKeys={enabledKeys}
                    planLimit={planLimit}
                    scheduleConfig={scheduleConfig}
                    followUpConfig={followUpConfig}
                  />
                ),
              },
            ]}
          />
        )}
        {current.key === "comportamento" && (
          <StepTabs
            tabs={[
              {
                key: "comportamento",
                label: "Comportamento",
                content: (
                  <BehaviorSettings
                    agentId={agentId}
                    listenAudio={listenAudio}
                    speakReplies={speakReplies}
                    stopOnEmoji={stopOnEmoji}
                    voice={voice}
                    catalogKey={catalogKey}
                    voiceAvailable={voiceAvailable}
                  />
                ),
              },
            ]}
          />
        )}
        {/* O teste passou a acontecer aqui dentro. Mandar para /conversas
            testava o agente PRINCIPAL da conta, não este — quem tinha dois
            agentes conversava com o errado e achava que a persona não salvou. */}
        {current.key === "testar" && (
          <StepTabs
            tabs={[
              {
                key: "conversar",
                label: "Conversar",
                content: (
                  <div className="space-y-4">
                    {!enabled && (
                      <Alert tone="warn">
                        Este agente está desligado, então ele não responde nem aqui. Ligue a chave
                        no topo da página para testar.
                      </Alert>
                    )}
                    <Sandbox agentId={agentId} />
                  </div>
                ),
              },
            ]}
          />
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
