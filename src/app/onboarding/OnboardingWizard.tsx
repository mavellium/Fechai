"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, MessageSquare, Sparkles, Zap } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TypingToCheck } from "@/components/ui/TypingToCheck";
import { cn } from "@/lib/utils";
import {
  countActionsOverLimit,
  LAST_STEP,
  OBJECTIVE_OPTIONS,
  ONBOARDING_STEPS,
  PROCESS_CATALOG,
  TONE_OPTIONS,
  validateStep,
  type OnboardingDraft,
  type ProcessKey,
  type StepErrors,
  type StepNumber,
} from "@/modules/tenants/onboarding-wizard";
import { completeOnboarding, saveOnboardingProgress } from "./actions";
import { ChatPreview } from "./ChatPreview";
import { IntegrationPanel } from "./IntegrationPanel";

const AUTOSAVE_DELAY = 800;

type SaveState = "idle" | "saving" | "saved";

export function OnboardingWizard({
  businessName,
  tenantId,
  planLabel,
  actionLimit,
  whatsappStatus,
  initialStep,
  initialDraft,
}: {
  businessName: string;
  tenantId: string;
  planLabel: string;
  actionLimit: number;
  whatsappStatus: string;
  initialStep: StepNumber;
  initialDraft: OnboardingDraft;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();

  const [step, setStep] = useState<StepNumber>(initialStep);
  const [draft, setDraft] = useState<OnboardingDraft>(initialDraft);
  const [errors, setErrors] = useState<StepErrors>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [maxReached, setMaxReached] = useState<StepNumber>(initialStep);

  const update = useCallback(<K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    // Some o erro assim que o usuário mexe no campo — não deixa o aviso preso.
    setErrors((e) => (key in e ? { ...e, [key]: undefined } : e));
  }, []);

  /* -------------------------------------------------------------- autosave */
  // Salva o rascunho sozinho enquanto ele preenche, para poder fechar a aba e
  // voltar depois sem perder nada. O primeiro render não grava (nada mudou).
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(async () => {
      await saveOnboardingProgress({ step, draft });
      setSaveState("saved");
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [draft, step]);

  /* ------------------------------------------------------------- navegação */
  function goNext() {
    const found = validateStep(step, draft);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    const next = Math.min(step + 1, LAST_STEP) as StepNumber;
    setStep(next);
    setMaxReached((m) => (next > m ? next : m));
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }

  function goTo(target: StepNumber) {
    if (target > maxReached) return; // só volta para passo já visitado
    setErrors({});
    setStep(target);
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }

  async function finish() {
    // Revalida os passos que travam — o botão final não deve confiar só na UI.
    for (const s of [2, 3] as StepNumber[]) {
      const found = validateStep(s, draft);
      if (Object.keys(found).length > 0) {
        setErrors(found);
        setStep(s);
        return;
      }
    }
    setFinishError(null);
    setFinishing(true);
    const res = await completeOnboarding({ draft });
    if (!res.ok) {
      setFinishError(res.error ?? "Não conseguimos finalizar agora. Tente de novo.");
      setFinishing(false);
      return;
    }
    posthog.capture("onboarding_completed", { process_count: draft.processes.length });
    router.push("/inicio");
    router.refresh();
  }

  const current = ONBOARDING_STEPS[step - 1];

  return (
    <div className="min-h-screen bg-paper px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-signal">
          primeiros passos
        </p>

        <Stepper step={step} maxReached={maxReached} onSelect={goTo} />

        <motion.div
          key={step}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className="mt-8"
        >
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {current.title}
          </h1>
          <p className="mt-2 max-w-prose text-neutral">{current.subtitle}</p>

          <div className="mt-8">
            {step === 1 && <StepWelcome businessName={businessName} planLabel={planLabel} />}
            {step === 2 && (
              <StepAgent
                draft={draft}
                errors={errors}
                businessName={businessName}
                onChange={update}
              />
            )}
            {step === 3 && (
              <StepProcesses
                draft={draft}
                errors={errors}
                actionLimit={actionLimit}
                onChange={update}
              />
            )}
            {step === 4 && (
              <StepIntegration
                draft={draft}
                tenantId={tenantId}
                whatsappStatus={whatsappStatus}
              />
            )}
          </div>
        </motion.div>

        {finishError && (
          <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
            {finishError}
          </p>
        )}

        {/* ------------------------------------------------------- navegação */}
        <div className="mt-10 flex items-center justify-between gap-4 border-t border-neutral/20 pt-6">
          <div className="flex min-w-0 items-center gap-3">
            {step > 1 ? (
              <Button variant="ghost" onClick={() => goTo((step - 1) as StepNumber)} disabled={finishing}>
                <ArrowLeft size={16} aria-hidden />
                Voltar
              </Button>
            ) : (
              <span />
            )}
            <SaveIndicator state={saveState} />
          </div>

          {step < LAST_STEP ? (
            <Button variant="cta" size="lg" onClick={goNext}>
              Continuar
              <ArrowRight size={16} aria-hidden />
            </Button>
          ) : (
            <Button variant="cta" size="lg" onClick={finish} disabled={finishing}>
              {finishing ? (
                <TypingToCheck state="typing" size={18} doneColor="white" />
              ) : (
                <>
                  Concluir
                  <Check size={16} strokeWidth={3} aria-hidden />
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========================================================== sub-componentes */

function Stepper({
  step,
  maxReached,
  onSelect,
}: {
  step: StepNumber;
  maxReached: StepNumber;
  onSelect: (s: StepNumber) => void;
}) {
  const progress = (step / ONBOARDING_STEPS.length) * 100;

  return (
    <nav aria-label="Progresso do onboarding" className="mt-4">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-neutral">
          passo {step} de {ONBOARDING_STEPS.length}
        </p>
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-neutral">
          {Math.round(progress)}%
        </p>
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-neutral/15">
        <div
          className="h-full rounded-full bg-signal transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {ONBOARDING_STEPS.map((s) => {
          const done = s.n < step;
          const active = s.n === step;
          const reachable = s.n <= maxReached && s.n !== step;

          return (
            <li key={s.n}>
              <button
                type="button"
                onClick={() => onSelect(s.n)}
                disabled={!reachable}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                  reachable && "hover:text-ink",
                  active ? "font-medium text-ink" : "text-neutral",
                  !reachable && !active && "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px]",
                    done && "bg-success text-white",
                    active && "bg-signal text-white",
                    !done && !active && "border border-neutral/30 text-neutral",
                  )}
                >
                  {done ? <Check size={12} strokeWidth={3} aria-hidden /> : String(s.n).padStart(2, "0")}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className="flex items-center gap-2 text-xs text-neutral" aria-live="polite">
      {state === "saving" ? (
        <>
          <TypingToCheck state="typing" size={12} />
          Salvando
        </>
      ) : (
        <>
          <TypingToCheck state="done" size={12} doneColor="success" />
          Progresso salvo
        </>
      )}
    </span>
  );
}

/* ------------------------------------------------------------ passo 1 */

function StepWelcome({ businessName, planLabel }: { businessName: string; planLabel: string }) {
  const items = [
    {
      icon: MessageSquare,
      title: "Ele responde na hora",
      text: "Quem chamar seu negócio recebe resposta em segundos, a qualquer hora do dia.",
    },
    {
      icon: Zap,
      title: "Ele resolve sozinho",
      text: "Marca horário, tira dúvida e registra o contato sem você entrar na conversa.",
    },
    {
      icon: Sparkles,
      title: "Você só entra quando precisa",
      text: "Se for algo que ele não dá conta, ele te avisa e passa a conversa para você.",
    },
  ];

  return (
    <div className="rounded-xl border border-neutral/20 bg-white p-6 sm:p-8">
      <p className="text-ink">
        Você acabou de criar a conta do{" "}
        <strong className="font-semibold">{businessName}</strong> no plano{" "}
        <strong className="font-semibold">{planLabel}</strong>. Nos próximos 3 passos você vai montar
        seu atendente e deixar ele pronto para conversar.
      </p>

      <ul className="mt-8 grid gap-6 sm:grid-cols-3">
        {items.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <Icon size={20} className="text-iris" aria-hidden />
            <h2 className="font-display mt-3 text-base font-semibold text-ink">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral">{text}</p>
          </li>
        ))}
      </ul>

      <p className="mt-8 border-t border-neutral/15 pt-6 text-sm text-neutral">
        Leva uns 3 minutos. Se precisar parar no meio, é só fechar — a gente guarda o que você já
        preencheu.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ passo 2 */

function StepAgent({
  draft,
  errors,
  businessName,
  onChange,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  businessName: string;
  onChange: <K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) => void;
}) {
  const nameId = useId();

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-8">
        {/* nome */}
        <Field
          label="Como ele vai se chamar?"
          hint="É o nome que aparece para quem conversa."
          htmlFor={nameId}
          error={errors.agentName}
        >
          <Input
            id={nameId}
            value={draft.agentName}
            onChange={(e) => onChange("agentName", e.target.value)}
            placeholder="Ex: Aurora"
            maxLength={40}
            autoFocus
            aria-invalid={Boolean(errors.agentName)}
          />
        </Field>

        {/* tom */}
        <ChoiceGroup
          label="Como ele deve falar?"
          hint="Escolha o jeito que combina com seu negócio."
          error={errors.tone}
          options={TONE_OPTIONS}
          value={draft.tone}
          onSelect={(v) => onChange("tone", v)}
        />

        {/* objetivo */}
        <ChoiceGroup
          label="O que ele deve buscar em cada conversa?"
          hint="É para onde ele vai levar o papo."
          error={errors.objective}
          options={OBJECTIVE_OPTIONS}
          value={draft.objective}
          onSelect={(v) => onChange("objective", v)}
        />
      </div>

      <div className="lg:sticky lg:top-8 lg:self-start">
        <ChatPreview
          agentName={draft.agentName}
          businessName={businessName}
          tone={draft.tone}
          objective={draft.objective}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ passo 3 */

function StepProcesses({
  draft,
  errors,
  actionLimit,
  onChange,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  actionLimit: number;
  onChange: <K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) => void;
}) {
  const customId = useId();
  const overLimit = countActionsOverLimit(draft, actionLimit);

  function toggle(key: ProcessKey) {
    const next = draft.processes.includes(key)
      ? draft.processes.filter((p) => p !== key)
      : [...draft.processes, key];
    onChange("processes", next);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {PROCESS_CATALOG.map((p) => {
          const checked = draft.processes.includes(p.key);
          return (
            <button
              key={p.key}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => toggle(p.key)}
              className={cn(
                "flex gap-3 rounded-xl border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                checked ? "border-iris bg-iris/5" : "border-neutral/20 bg-white hover:border-neutral/40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                  checked ? "border-iris bg-iris text-white" : "border-neutral/40",
                )}
                aria-hidden
              >
                {checked && <Check size={13} strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="font-display block text-base font-semibold text-ink">{p.label}</span>
                <span className="mt-1 block text-sm leading-relaxed text-neutral">
                  {p.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {errors.processes && (
        <p role="alert" className="text-sm text-danger">
          {errors.processes}
        </p>
      )}

      {overLimit > 0 && (
        <p className="rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn">
          Seu plano liga {actionLimit} automações. Vamos ativar as principais agora — o resto você
          libera trocando de plano depois, sem refazer nada.
        </p>
      )}

      <Field
        label="Tem mais alguma coisa que ele deve resolver?"
        hint="Opcional. Escreva com suas palavras."
        htmlFor={customId}
      >
        <Textarea
          id={customId}
          value={draft.customProcess}
          onChange={(e) => onChange("customProcess", e.target.value)}
          placeholder="Ex: avisar quando chegar pedido de orçamento acima de R$ 2.000"
          maxLength={240}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------ passo 4 */

function StepIntegration({
  draft,
  tenantId,
  whatsappStatus,
}: {
  draft: OnboardingDraft;
  tenantId: string;
  whatsappStatus: string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 px-5 py-4">
        <Check size={16} strokeWidth={3} className="mt-0.5 shrink-0 text-success" aria-hidden />
        <p className="text-sm text-ink">
          <strong className="font-semibold">{draft.agentName || "Seu atendente"}</strong> está
          pronto. Agora é só escolher onde ele vai atender — dá para fazer isso agora ou depois, pelo
          painel.
        </p>
      </div>

      <IntegrationPanel
        tenantId={tenantId}
        initialWhatsappStatus={whatsappStatus}
      />
    </div>
  );
}

/* ------------------------------------------------------- peças de formulário */

/** Grupo de escolha única em cartões — usado para tom de voz e objetivo. */
function ChoiceGroup({
  label,
  hint,
  error,
  options,
  value,
  onSelect,
}: {
  label: string;
  hint?: string;
  error?: string;
  options: { value: string; hint: string }[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label}>
      <p className="text-sm font-medium text-ink">{label}</p>
      {hint && <p className="mt-0.5 text-sm text-neutral">{hint}</p>}

      <div className="mt-2 grid gap-2">
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onSelect(o.value)}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                checked ? "border-iris bg-iris/5" : "border-neutral/20 bg-white hover:border-neutral/40",
              )}
            >
              <span
                className={cn(
                  "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  checked ? "border-iris" : "border-neutral/40",
                )}
                aria-hidden
              >
                {checked && <span className="h-2 w-2 rounded-full bg-iris" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{o.value}</span>
                <span className="mt-0.5 block text-sm text-neutral">{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
