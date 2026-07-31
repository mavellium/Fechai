import Link from "next/link";
import { StatusDot } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

type Item = {
  label: string;
  tone: "success" | "warn" | "danger" | "neutral";
  /** Para onde ir quando este ponto estiver ruim. */
  href?: string;
  fix?: string;
};

/**
 * "Está tudo no ar?" — a pergunta que vem antes de qualquer número.
 *
 * O painel não tinha nenhum lugar que respondesse isso: dava para o WhatsApp
 * cair e a conta seguir dias sem ninguém perceber, porque a home só mostrava um
 * checklist de configuração já concluído.
 */
export function HealthStrip({
  agentReady,
  whatsappStatus,
  planName,
  conversationsThisPeriod,
  planLimit,
}: {
  agentReady: boolean;
  whatsappStatus: string;
  planName: string;
  conversationsThisPeriod: number;
  planLimit: number;
}) {
  const items: Item[] = [
    agentReady
      ? { label: "Agente ativo", tone: "success" }
      : {
          label: "Agente sem configuração",
          tone: "warn",
          href: "/agentes",
          fix: "configurar",
        },
    whatsappStatus === "connected"
      ? { label: "WhatsApp conectado", tone: "success" }
      : {
          label:
            whatsappStatus === "pending_qr"
              ? "WhatsApp aguardando leitura"
              : "WhatsApp desconectado",
          tone: "warn",
          href: "/whatsapp",
          fix: "conectar",
        },
    {
      label: `Plano ${planName} · ${conversationsThisPeriod}/${planLimit} conversas`,
      tone: conversationsThisPeriod >= planLimit ? "danger" : "neutral",
      href: conversationsThisPeriod >= planLimit * 0.8 ? "/planos" : undefined,
      fix: conversationsThisPeriod >= planLimit * 0.8 ? "ver planos" : undefined,
    },
  ];

  return (
    <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
      <h2 className="sr-only">Situação da conta</h2>
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <StatusDot tone={item.tone}>{item.label}</StatusDot>
          {item.href && item.fix && (
            <Link
              href={item.href}
              className="rounded-control font-mono text-micro uppercase tracking-wide text-iris underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            >
              {item.fix}
            </Link>
          )}
        </div>
      ))}
    </Card>
  );
}
