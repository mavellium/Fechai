// `AtSign` e não um ícone de marca: o lucide removeu os logos de terceiros, e
// inventar um SVG do Instagram aqui criaria um ícone fora do conjunto.
import Link from "next/link";
import { AtSign, Globe, MessageCircle } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusDot } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { PageHeader } from "@/components/ui/page-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { dateLabel } from "@/lib/format";
import { ensureTenantWidgetDeployed } from "@/lib/widget/deploy";
import { isGoogleCalendarConfigured } from "@/modules/scheduling/google";
import { getCalendarFeatures } from "@/modules/scheduling/features";
import { getClinicorpStatus, listClinicorpBusinesses } from "@/modules/scheduling/clinicorp";
import { isEncryptionConfigured } from "@/lib/crypto";
import { CalendarFeatureToggles } from "./CalendarFeatureToggles";
import { GoogleCalendarCard, type GoogleState } from "./GoogleCalendarCard";
import { ClinicorpCard, type ClinicorpState } from "./ClinicorpCard";
import { WhatsappConnect } from "./WhatsappConnect";
import { SnippetBox } from "./SnippetBox";

const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warn" | "neutral" }> = {
  disconnected: { label: "Não conectado", tone: "neutral" },
  pending_qr: { label: "Aguardando leitura", tone: "warn" },
  connected: { label: "Conectado", tone: "success" },
};

/** As duas famílias de integração da tela. `canais` é o padrão. */
const TABS = [
  { key: "canais", label: "Canais" },
  { key: "calendarios", label: "Calendários" },
] as const;

export default async function IntegracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { aba } = await searchParams;
  // Parâmetro de URL é editável: qualquer coisa fora da lista cai em "canais".
  const tab = TABS.some((t) => t.key === aba) ? (aba as (typeof TABS)[number]["key"]) : "canais";

  const since = new Date(new Date().getTime() - 7 * 86_400_000);
  const [instance, inboundLast7, tenant, agent] = await Promise.all([
    prisma.whatsappInstance.findUnique({ where: { tenantId } }),
    prisma.message.count({
      where: { role: "user", createdAt: { gte: since }, conversation: { tenantId } },
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        widgetColor: true,
        widgetGreeting: true,
        widgetIconType: true,
        widgetIconEmoji: true,
        widgetIconUrl: true,
        widgetShape: true,
        widgetBorderColor: true,
        widgetEnabled: true,
        whatsappIgnoreGroups: true,
      },
    }),
    prisma.agent.findFirst({
      where: { tenantId, archived: false },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { name: true, enabled: true },
    }),
  ]);

  // Publica o widget.js do tenant na CDN na primeira visita — sem comando
  // manual. No-op se já foi publicado (ver ensureTenantWidgetDeployed).
  await ensureTenantWidgetDeployed(tenantId);

  // Só a aba de calendários precisa disso: nada de pagar por essas queries em
  // quem abriu a tela para conectar o WhatsApp.
  const calendars =
    tab === "calendarios"
      ? await Promise.all([
          getCalendarFeatures(tenantId),
          prisma.calendarIntegration.findUnique({ where: { tenantId } }),
          getClinicorpStatus(tenantId),
        ])
      : null;

  const [features, googleRow, clinicorpRow] = calendars ?? [null, null, null];

  const googleState: GoogleState | null = !features?.googleEnabled
    ? null
    : !isGoogleCalendarConfigured()
      ? { configured: false }
      : googleRow
        ? {
            configured: true,
            connected: true,
            accountEmail: googleRow.accountEmail,
            syncEnabled: googleRow.syncEnabled,
          }
        : { configured: true, connected: false };

  // As clínicas do assinante são uma chamada de rede ao Clinicorp — só quando
  // há conexão de pé para consultar.
  const clinicorpState: ClinicorpState | null = !features?.clinicorpEnabled
    ? null
    : clinicorpRow
      ? {
          connected: true,
          subscriberId: clinicorpRow.subscriberId,
          businessId: clinicorpRow.businessId,
          dentistId: clinicorpRow.dentistId,
          categoryDescription: clinicorpRow.categoryDescription,
          syncEnabled: clinicorpRow.syncEnabled,
          checkAvailability: clinicorpRow.checkAvailability,
          lastError: clinicorpRow.lastError,
          businesses: await listClinicorpBusinesses(tenantId),
        }
      : { connected: false };

  const configured = getWhatsAppProvider().isConfigured();
  const status = instance?.status ?? "disconnected";
  const connected = status === "connected";
  const s = STATUS_LABEL[status] ?? { label: status, tone: "neutral" as const };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <PageHeader
        eyebrow="integracoes"
        title="Integrações"
        description={
          connected
            ? "Seu agente já responde no WhatsApp. Aqui você acompanha a conexão e liga os outros canais."
            : "Ligue os canais onde seu agente atende — o WhatsApp e o botão no seu site."
        }
      />

      <FilterTabs
        options={TABS.map((t) => ({ key: t.key, label: t.label }))}
        active={tab}
        href={(key) => (key === "canais" ? "/integracoes" : `/integracoes?aba=${key}`)}
        label="Tipo de integração"
      />

      {tab === "calendarios" && features && (
        <section className="space-y-3">
          {/* A explicação virou bolinha (os cards abaixo já mostram o toggle e
              o que fazer), mas o link para a Agenda continua clicável ao lado:
              um balão que fecha ao perder o foco não é lugar para navegação. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display flex items-center gap-1.5 text-lg font-semibold text-white">
              Calendários
              <InfoHint label="calendários">
                Habilite os calendários que sua conta usa e conecte cada um aqui. O que estiver
                ligado aparece como status na Agenda.
              </InfoHint>
            </h2>
            <Link
              href="/agenda"
              className="rounded-control font-mono text-micro uppercase tracking-[0.15em] text-white/60 underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            >
              Ver na Agenda
            </Link>
          </div>

          <CalendarFeatureToggles
            items={[
              {
                key: "google",
                name: "Google Agenda",
                description: "Espelha os horários marcados aqui na agenda do Google.",
                enabled: features.googleEnabled,
                connected: Boolean(googleRow),
                unavailable: isGoogleCalendarConfigured()
                  ? undefined
                  : "Faltam as credenciais do Google no servidor desta instalação.",
              },
              {
                key: "clinicorp",
                name: "Clinicorp",
                description:
                  "Envia os horários para a agenda da clínica e consulta o que já está ocupado lá.",
                enabled: features.clinicorpEnabled,
                connected: Boolean(clinicorpRow),
                unavailable: isEncryptionConfigured()
                  ? undefined
                  : "Falta a chave de criptografia no servidor desta instalação.",
              },
            ]}
            // Cada formulário renderiza dentro do card do seu toggle: ligar e
            // configurar viraram um passo só, sem card solto embaixo.
            panels={{
              google: googleState ? <GoogleCalendarCard state={googleState} /> : null,
              clinicorp: clinicorpState ? <ClinicorpCard state={clinicorpState} /> : null,
            }}
          />
        </section>
      )}

      {tab === "canais" && (
        <>
      {!configured && (
        <Alert tone="warn" title="Conexão indisponível neste ambiente">
          Não dá para conectar o WhatsApp agora. Enquanto isso, você pode conversar com seu agente
          na página de Conversas.{" "}
          <ButtonLink href="/conversas" variant="ghost" size="sm" className="ml-1 underline">
            Ir para Conversas
          </ButtonLink>
        </Alert>
      )}

      {/*
        A tela tem uma missão só e ela muda com o estado: desconectada, o código
        é o assunto inteiro; conectada, nada disso é útil e o card vira painel de
        saúde do canal (quem decide isso é o WhatsappConnect).
      */}
      <Card className="md:p-8">
        <CardTitle
          hintLabel="WhatsApp"
          hint={
            connected
              ? "Este é o número que seus clientes usam para falar com o agente."
              : "Leva menos de um minuto — o código é gerado assim que a página abre."
          }
          action={<StatusDot tone={s.tone}>{s.label}</StatusDot>}
        >
          <span className="inline-flex items-center gap-2">
            <MessageCircle size={18} aria-hidden className="text-success" />
            WhatsApp
          </span>
        </CardTitle>

        {/* key={status}: quando desconecta, o WhatsappConnect remonta no estado
            novo (o status é estado local dele e não se atualizaria sozinho). */}
        <WhatsappConnect
          key={status}
          initialStatus={status}
          configured={configured}
          connectedSince={
            connected && instance?.updatedAt ? dateLabel(instance.updatedAt) : undefined
          }
          inboundLast7={connected ? inboundLast7 : undefined}
          agentName={agent?.name ?? "Agente"}
          agentEnabled={agent?.enabled ?? false}
          ignoreGroups={tenant?.whatsappIgnoreGroups ?? true}
        />
      </Card>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-white">Outros canais</h2>
        <p className="max-w-prose text-sm text-white/60">
          Seu agente pode atender em mais de um lugar. O que estiver ligado usa a mesma persona e a
          mesma base de conhecimento.
        </p>

        <Card className="p-0">
          {/* `<details>` nativo: abre sem JS, é navegável por teclado e não
              precisa de estado nem de biblioteca de acordeão. Fechado por
              padrão — quem quer instalar abre e vê o código. */}
          <details className="group">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3 rounded-surface p-4 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
              <Globe size={18} aria-hidden className="text-iris" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">Botão no seu site</span>
                <span className="block text-xs text-white/55">
                  Um código pronto para colar — quem visita o site fala com o agente sem sair da
                  página.
                </span>
              </span>
              <span className="font-mono text-micro uppercase tracking-wide text-white/50 group-open:hidden">
                abrir
              </span>
              <span className="hidden font-mono text-micro uppercase tracking-wide text-white/50 group-open:inline">
                fechar
              </span>
            </summary>
            <div className="border-t border-white/10 p-4">
              <SnippetBox
                tenantId={tenantId}
                widgetEnabled={tenant?.widgetEnabled ?? false}
                widgetColor={tenant?.widgetColor ?? "#6d5ef8"}
                widgetGreeting={tenant?.widgetGreeting ?? "Olá! Como posso ajudar?"}
                widgetIconType={tenant?.widgetIconType ?? "emoji"}
                widgetIconEmoji={tenant?.widgetIconEmoji ?? "💬"}
                widgetIconUrl={tenant?.widgetIconUrl ?? null}
                widgetShape={tenant?.widgetShape ?? "circle"}
                widgetBorderColor={tenant?.widgetBorderColor ?? null}
              />
            </div>
          </details>
        </Card>

        <Card className="flex flex-wrap items-center gap-3 p-4 opacity-70">
          <AtSign size={18} aria-hidden className="text-white/50" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white/80">Instagram Direct</span>
            <span className="block text-xs text-white/50">
              Responder mensagens do Direct com o mesmo agente.
            </span>
          </span>
          <Badge>em breve</Badge>
        </Card>
      </section>
        </>
      )}
    </div>
  );
}
