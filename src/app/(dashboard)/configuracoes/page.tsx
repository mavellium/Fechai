import { Check, X } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { tenantChecks, type Check as HealthCheck } from "@/lib/health";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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

export default async function ConfiguracoesPage() {
  const { tenantId } = await requireTenant();
  const checks = await tenantChecks(tenantId);
  const pending = checks.filter((c) => !c.ok).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        eyebrow="configurações"
        title="Configurações"
        description="Status da conta e envio de feedback."
        className="mb-2"
      />

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
  );
}
