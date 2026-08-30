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
  messagesUsed,
  messageLimit,
  trialExpired,
  trialDaysLeft,
}: {
  agentReady: boolean;
  whatsappStatus: string;
  planName: string;
  /** Respostas da IA no mês — a mesma cota de /configuracoes e da sidebar. */
  messagesUsed: number;
  messageLimit: number;
  /** Teste grátis vencido: a IA parou por prazo, não por cota. */
  trialExpired?: boolean;
  /** Dias restantes do teste (quando a conta está num plano de teste). */
  trialDaysLeft?: number | null;
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
          href: "/integracoes",
          fix: "conectar",
        },
    // Teste vencido cala a IA mesmo com cota sobrando, então ele domina o item
    // do plano — mostrar "20/100 mensagens" sem dizer que o prazo acabou
    // esconderia o motivo real de o agente ter parado.
    trialExpired
      ? {
          label: `Teste encerrado · escolha um plano`,
          tone: "danger",
          href: "/planos",
          fix: "ver planos",
        }
      : {
          label:
            trialDaysLeft != null
              ? `Teste · ${trialDaysLeft} dia${trialDaysLeft === 1 ? "" : "s"} · ${messagesUsed}/${messageLimit} mensagens`
              : `Plano ${planName} · ${messagesUsed}/${messageLimit} mensagens`,
          tone: messagesUsed >= messageLimit ? "danger" : "neutral",
          href: messagesUsed >= messageLimit * 0.8 ? "/planos" : undefined,
          fix: messagesUsed >= messageLimit * 0.8 ? "ver planos" : undefined,
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
