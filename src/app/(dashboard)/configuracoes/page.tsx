import { Check, X } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { tenantChecks, type Check as HealthCheck } from "@/lib/health";
import { getUsageSummary, type UsageSummary } from "@/modules/billing/usage";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ProfileForm } from "./ProfileForm";
import { PasswordForm } from "./PasswordForm";
import { FeedbackForm } from "./FeedbackForm";

/** Traduz o status cru do provedor que vem no `detail` do check de WhatsApp. */
const DETAIL_PT: Record<string, string> = {
  connected: "conectado",
  pending_qr: "aguardando QR",
  disconnected: "desconectado",
};

function CheckRow({ c }: { c: HealthCheck }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
            c.ok ? "bg-success text-white" : "bg-white/10 text-white/60"
          }`}
        >
          {c.ok ? <Check size={12} strokeWidth={3} /> : <X size={12} />}
        </span>
        <span className="truncate text-sm text-white/85">
          {c.label}
          {/* o ícone é decorativo: o estado precisa existir em texto */}
          <span className="sr-only">{c.ok ? " — pronto" : " — pendente"}</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {c.detail && (
          <span className="font-mono text-micro uppercase tracking-wide text-white/55">
            {DETAIL_PT[c.detail] ?? c.detail}
          </span>
        )}
        {!c.ok && c.href && (
          <ButtonLink href={c.href} variant="outline" size="sm" aria-label={`Resolver: ${c.label}`}>
            Resolver
          </ButtonLink>
        )}
      </div>
    </li>
  );
}

function UsageCard({ usage }: { usage: UsageSummary }) {
  const pct = usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 100;
  const barTone = usage.atLimit ? "bg-danger" : pct >= 80 ? "bg-warn" : "bg-iris";

  const capAt = usage.perConversationUsed >= usage.perConversationCap;
  const capPct =
    usage.perConversationCap > 0
      ? Math.min(100, Math.round((usage.perConversationUsed / usage.perConversationCap) * 100))
      : 100;
  const capBarTone = capAt ? "bg-danger" : capPct >= 80 ? "bg-warn" : "bg-iris";

  return (
    <Card>
      <CardTitle
        hint="Como sua conta consome o plano neste mês. O chat de teste não conta."
        action={
          <span
            className={`font-mono text-micro uppercase tracking-[0.15em] ${
              usage.atLimit ? "text-danger" : "text-white/60"
            }`}
          >
            {usage.atLimit
              ? "limite atingido"
              : `${usage.used.toLocaleString("pt-BR")} de ${usage.limit.toLocaleString("pt-BR")}`}
          </span>
        }
      >
        Uso atual
      </CardTitle>

      <div className="grid gap-5 sm:grid-cols-2 sm:gap-8">
        {/* Cota da conta: conversas/mês */}
        <div>
          <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/55">
            Cota da conta · conversas
          </p>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <p className="font-display text-lg font-semibold text-white">
              {usage.used.toLocaleString("pt-BR")}
              <span className="text-white/55"> de {usage.limit.toLocaleString("pt-BR")}</span>
            </p>
            <span
              className={`font-mono text-micro uppercase tracking-[0.15em] ${
                usage.atLimit ? "text-danger" : "text-white/45"
              }`}
            >
              {pct}%
            </span>
          </div>
          <div aria-hidden className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/85">
            {usage.atLimit ? (
              <>
                Você chegou ao limite de {usage.limit.toLocaleString("pt-BR")} conversas do plano{" "}
                {usage.plan.name} neste mês. A IA parou de responder automaticamente — as novas
                mensagens ficam registradas em Conversas, marcadas como “precisa de você”.
              </>
            ) : (
              <>
                Você usou {pct}% da cota do plano {usage.plan.name} neste mês.
                {usage.override && " (limite definido pelo suporte)"}
              </>
            )}
          </p>

          {usage.atLimit ? (
            usage.nextPlan ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-surface border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-white/75">
                  O plano{" "}
                  <span className="font-medium text-white">{usage.nextPlan.name}</span> oferece{" "}
                  {usage.nextPlan.conversationsPerMonth.toLocaleString("pt-BR")} conversas/mês.
                </p>
                <ButtonLink href="/planos" size="sm">
                  Ver planos
                </ButtonLink>
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/55">
                Você está no plano máximo. Fale com o suporte para aumentar o limite.
              </p>
            )
          ) : null}
        </div>

        {/* Teto por conversa: respostas da IA/mês */}
        <div className="sm:border-l sm:border-white/10 sm:pl-8">
          <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/55">
            Teto por conversa · respostas
          </p>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <p className="font-display text-lg font-semibold text-white">
              {usage.perConversationUsed.toLocaleString("pt-BR")}
              <span className="text-white/55">
                {" "}
                de {usage.perConversationCap.toLocaleString("pt-BR")}
              </span>
            </p>
            <span
              className={`font-mono text-micro uppercase tracking-[0.15em] ${
                capAt ? "text-danger" : "text-white/45"
              }`}
            >
              {capAt ? "conversa no teto" : "conversa mais ativa"}
            </span>
          </div>
          <div aria-hidden className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full ${capBarTone}`} style={{ width: `${capPct}%` }} />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/85">
            {capAt ? (
              <>
                A conversa mais ativa atingiu o teto de{" "}
                {usage.perConversationCap.toLocaleString("pt-BR")} respostas e a IA ficou muda
                nela — as demais continuam atendendo normalmente.
              </>
            ) : (
              <>
                A conversa mais ativa usou{" "}
                {usage.perConversationUsed.toLocaleString("pt-BR")} das{" "}
                {usage.perConversationCap.toLocaleString("pt-BR")} respostas permitidas por
                conversa neste mês. Passou do teto, a IA fica muda só nessa conversa.
              </>
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

export default async function ConfiguracoesPage() {
  const { session, tenantId } = await requireTenant();

  // Direto do banco, não da sessão: o nome no JWT só atualiza no próximo
  // login, então relendo aqui o formulário sempre mostra o valor salvo.
  const [user, checks, usage] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, email: true },
    }),
    tenantChecks(tenantId),
    getUsageSummary(tenantId),
  ]);
  const pending = checks.filter((c) => !c.ok).length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        eyebrow="configurações"
        title="Configurações"
        description="Sua conta, status da configuração e envio de feedback."
        className="mb-2"
      />

      <UsageCard usage={usage} />

      {/*
        Mesmo grid de /inicio: coluna principal (2/3) para o que se edita,
        coluna lateral (1/3) para status e ações secundárias. Em telas
        estreitas cai para 1 coluna só — a ordem no DOM já é a leitura certa.
      */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardTitle hint="Nome e e-mail usados na sua conta.">Perfil</CardTitle>
            <ProfileForm name={user.name ?? ""} email={user.email} />
          </Card>

          <Card>
            <CardTitle hint="Recomendado a cada alguns meses.">Senha</CardTitle>
            <PasswordForm />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle
              hint="Complete todos para o agente funcionar 100%."
              action={
                <span className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
                  {pending === 0 ? "tudo pronto" : `${pending} pendente${pending > 1 ? "s" : ""}`}
                </span>
              }
            >
              Sua configuração
            </CardTitle>
            <ul className="divide-y divide-white/5">
              {checks.map((c) => (
                <CheckRow key={c.label} c={c} />
              ))}
            </ul>
          </Card>

          <Card>
            <CardTitle hint="Sua opinião ajuda a melhorar o produto.">Enviar feedback</CardTitle>
            <FeedbackForm />
          </Card>
        </div>
      </div>
    </div>
  );
}
