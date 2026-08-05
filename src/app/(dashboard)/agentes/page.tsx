import Link from "next/link";
import { Bot, Check, MessageSquare, FileText, ArrowRight } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { agentSteps, getAgentUsage, listAgents } from "@/modules/agent-engine/agents";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { NewAgentButton } from "./NewAgentButton";

export default async function AgentesPage() {
  const { tenantId } = await requireTenant();
  const [agents, usage] = await Promise.all([listAgents(tenantId), getAgentUsage(tenantId)]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="agentes"
        title="Seus agentes"
        description="Cada agente tem persona, base de conhecimento e ações próprias."
        className="mb-2"
        actions={<NewAgentButton usage={usage} />}
      />

      {/* Uso do plano em texto explícito: antes não havia nenhum lugar no
          produto que dissesse quantos agentes a conta tem nem qual o teto. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-white/10 bg-white/5 px-5 py-4">
        <div>
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/55">
            agentes do seu plano
          </p>
          <p className="mt-1 text-sm text-white/80">
            <span className="font-display text-lg font-bold tabular-nums text-white">
              {usage.used}
            </span>
            <span className="text-white/55"> de {usage.limit} em uso</span>
          </p>
        </div>
        {usage.canCreate ? (
          <p className="text-xs text-white/55">
            Você ainda pode criar {usage.remaining}{" "}
            {usage.remaining === 1 ? "agente" : "agentes"}.
          </p>
        ) : (
          <p className="text-xs text-white/70">
            Limite atingido.{" "}
            <Link href="/planos" className="text-signal underline underline-offset-2">
              Mudar de plano
            </Link>{" "}
            para criar mais.
          </p>
        )}
      </div>

      <ul className="space-y-3">
        {agents.map((agent) => {
          const steps = agentSteps(agent);
          const done = steps.filter((s) => s.done).length;
          const ready = done === steps.length;

          return (
            <li key={agent.id}>
              <Link
                href={`/agentes/${agent.id}`}
                className="group block rounded-surface border border-white/10 bg-white/5 p-5 transition-colors hover:border-white/20 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-iris/20 text-white"
                    >
                      <Bot size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold text-white">
                        <span className="truncate">{agent.name}</span>
                        {agent.isPrimary && <Badge tone="iris">whatsapp</Badge>}
                        {/* Desligado é o estado mais importante da linha: sem
                            isto a lista mostrava "pronto" para um agente que
                            não responde a ninguém. */}
                        {!agent.enabled && <Badge tone="danger">desligado</Badge>}
                        {ready ? (
                          <Badge tone="success" icon={<Check size={11} aria-hidden />}>
                            pronto
                          </Badge>
                        ) : (
                          <Badge tone="warn">
                            {done} de {steps.length}
                          </Badge>
                        )}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-micro uppercase tracking-[0.15em] text-white/55">
                        <span className="inline-flex items-center gap-1.5">
                          <FileText size={12} aria-hidden />
                          {agent._count.knowledgeDocs} doc(s)
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <MessageSquare size={12} aria-hidden />
                          {agent._count.conversations} conversa(s)
                        </span>
                        <span>{agent.actions.length} ação(ões)</span>
                      </p>
                    </div>
                  </div>
                  <ArrowRight
                    size={18}
                    aria-hidden
                    className="mt-2 shrink-0 text-white/40 transition-colors group-hover:text-white"
                  />
                </div>

                {/* Passo a passo do agente, visível na lista: a pessoa vê onde
                    parou sem precisar abrir cada um. */}
                {!ready && (
                  <ul className="mt-4 flex flex-wrap gap-2 pl-12">
                    {steps.map((step) => (
                      <li
                        key={step.key}
                        className={
                          step.done
                            ? "inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 font-mono text-micro uppercase tracking-wide text-success"
                            : "inline-flex items-center gap-1.5 rounded-full border border-dashed border-white/20 px-2.5 py-1 font-mono text-micro uppercase tracking-wide text-white/50"
                        }
                      >
                        {step.done && <Check size={11} aria-hidden />}
                        {step.label}
                      </li>
                    ))}
                  </ul>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
