import Link from "next/link";
import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requiredSteps, type OnboardingStep } from "@/modules/tenants/onboarding";

/**
 * Checklist de configuração — mas tratando os passos pelo que eles são: uma
 * sequência, não seis itens de mesmo peso.
 *
 * Antes, os seis apareciam lado a lado com um botão "Começar" idêntico cada um:
 * seis ações primárias competindo, contra a regra de uma por tela. Aqui só o
 * próximo passo tem ação; o que já foi feito colapsa e o que vem depois fica
 * como leitura.
 */
export function SetupSteps({ steps }: { steps: OnboardingStep[] }) {
  // O progresso conta só o que trava a conclusão — um passo opcional pendente
  // não pode segurar a barra em 83% para sempre.
  const required = requiredSteps(steps);
  const doneCount = required.filter((s) => s.done).length;
  // Guarda o catálogo vazio: `0/0` virava NaN% na barra de progresso.
  const progress = required.length ? Math.round((doneCount / required.length) * 100) : 0;

  const next = required.find((s) => !s.done);
  const nextIndex = next ? required.indexOf(next) : -1;
  const later = required.filter((s) => !s.done && s !== next);
  const optional = steps.filter((s) => s.optional && !s.done);
  const done = steps.filter((s) => s.done);

  return (
    <Card className="md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">Colocar seu agente no ar</h2>
          <p className="mt-1 text-sm text-white/55">
            Complete no seu ritmo — não precisa ser tudo de uma vez.
          </p>
        </div>
        <span className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
          {doneCount} de {steps.length} · {progress}%
        </span>
      </div>

      <div
        className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progresso da configuração"
      >
        <div
          className="h-full rounded-full bg-signal transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {next && (
        <div className="mt-6 rounded-surface border border-iris/40 bg-iris/10 p-5">
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/60">
            próximo passo · {String(nextIndex + 1).padStart(2, "0")}
          </p>
          <h3 className="font-display mt-2 text-xl font-semibold text-white">{next.title}</h3>
          <p className="mt-1 max-w-prose text-sm text-white/70">{next.description}</p>
          <ButtonLink href={next.href} className="mt-4" aria-label={`Começar: ${next.title}`}>
            Começar agora
          </ButtonLink>
        </div>
      )}

      {later.length > 0 && (
        <div className="mt-6">
          <h3 className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">
            Depois disso
          </h3>
          <ul className="mt-2 space-y-1">
            {later.map((s) => (
              <li key={s.key} className="flex items-baseline gap-3 text-sm text-white/60">
                <span aria-hidden className="font-mono text-micro text-white/35">
                  {String(required.indexOf(s) + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">{s.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {optional.length > 0 && (
        <div className="mt-6">
          <h3 className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">
            Quando quiser · opcional
          </h3>
          <ul className="mt-2 space-y-1">
            {optional.map((s) => (
              <li key={s.key} className="text-sm text-white/60">
                <Link
                  href={s.href}
                  className="rounded-control underline decoration-white/20 underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done.length > 0 && (
        <details className="mt-6 border-t border-white/5 pt-4">
          <summary className="cursor-pointer font-mono text-micro uppercase tracking-[0.2em] text-white/45 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
            Concluídos ({done.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {done.map((s) => (
              <li key={s.key} className="flex items-center gap-3 text-sm text-white/50">
                <span
                  aria-hidden
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white"
                >
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="min-w-0 line-through">{s.title}</span>
                <span className="sr-only">— concluído</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
