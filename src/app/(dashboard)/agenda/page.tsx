import Link from "next/link";
import { CalendarX2, Clock, User, UsersRound } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { describeSchedule, parseScheduleConfig } from "@/modules/scheduling/config";
import { isGoogleCalendarConfigured } from "@/modules/scheduling/google";
import { getCalendarFeatures } from "@/modules/scheduling/features";
import { listMonthAppointments } from "@/modules/scheduling/repository";
import { timeInZone, todayInZone } from "@/modules/scheduling/time";
import { leadStatusLabel } from "../conversas/leadStatus";
import { CalendarMonth } from "./CalendarMonth";
import { AppointmentActions } from "./AppointmentActions";
import { NewAppointmentDialog, type ContactOption } from "./NewAppointmentDialog";
import { CalendarSyncStatus, type CalendarSyncItem } from "./CalendarSyncStatus";

/** Quantos contatos mostrar no painel lateral — o resto fica em /contatos. */
const SIDEBAR_CONTACTS = 6;

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "neutral" | "danger" }> = {
  scheduled: { label: "marcado", tone: "success" },
  done: { label: "realizado", tone: "neutral" },
  canceled: { label: "cancelado", tone: "danger" },
};

/**
 * Agenda da conta: mês à esquerda, dia escolhido à direita.
 *
 * A ação "Agendar horário" existia como mock — trocava o status do lead e a
 * data combinada se perdia na conversa. Esta tela é o outro lado dela: o que o
 * agente marca no WhatsApp aparece aqui, junto do que foi marcado à mão.
 */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; mes?: string; dia?: string; google?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { ano, mes, dia, google } = await searchParams;

  // A configuração de horário do agente principal é a da conta: fuso e duração
  // padrão saem dela (ver módulo scheduling).
  const primaryAgent = await prisma.agent.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      enabled: true,
      actions: { where: { key: "schedule_meeting" }, select: { enabled: true, config: true } },
    },
  });

  const scheduleAction = primaryAgent?.actions[0];
  const config = parseScheduleConfig(scheduleAction?.config);
  const today = todayInZone(config.timezone);

  // Parâmetros da URL são editáveis: qualquer coisa fora da faixa cai em hoje.
  const yearNum = Number(ano);
  const monthNum = Number(mes);
  const year = Number.isInteger(yearNum) && yearNum >= 1970 && yearNum <= 2999 ? yearNum : today.year;
  const month = Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12 ? monthNum : today.month;

  const dayNum = Number(dia);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const selectedDay =
    Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= daysInMonth
      ? dayNum
      : year === today.year && month === today.month
        ? today.day
        : null;

  const [{ byDay }, features, integration, clinicorp, contacts] = await Promise.all([
    listMonthAppointments(tenantId, year, month, config.timezone),
    getCalendarFeatures(tenantId),
    prisma.calendarIntegration.findUnique({ where: { tenantId } }),
    prisma.clinicorpIntegration.findUnique({ where: { tenantId } }),
    prisma.lead.findMany({
      where: { tenantId, isTest: false },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, phone: true, status: true },
    }),
  ]);

  const countByDay = new Map([...byDay].map(([key, rows]) => [key, rows.length]));

  const pad = (n: number) => String(n).padStart(2, "0");
  const selectedKey = selectedDay ? `${year}-${pad(month)}-${pad(selectedDay)}` : null;
  const dayAppointments = selectedKey ? (byDay.get(selectedKey) ?? []) : [];

  const hrefFor = ({
    year: y = year,
    month: m = month,
    day,
  }: {
    year?: number;
    month?: number;
    day?: number | null;
  }) => {
    const p = new URLSearchParams({ ano: String(y), mes: String(m) });
    if (day) p.set("dia", String(day));
    return `/agenda?${p}`;
  };

  // Só o ESTADO das integrações: conectar e configurar é em /integracoes.
  // Quem olha a agenda quer saber "o que eu marcar agora chega na clínica?".
  const syncItems: CalendarSyncItem[] = ([
    features.googleEnabled && isGoogleCalendarConfigured()
      ? {
          key: "google" as const,
          name: "Google Agenda",
          connected: Boolean(integration),
          sending: Boolean(integration?.syncEnabled),
          // O Google é espelho de mão única: só enviamos eventos para lá.
          receiving: false,
        }
      : null,
    features.clinicorpEnabled
      ? {
          key: "clinicorp" as const,
          name: "Clinicorp",
          connected: Boolean(clinicorp),
          sending: Boolean(clinicorp?.syncEnabled),
          receiving: Boolean(clinicorp?.checkAvailability),
          error: clinicorp?.lastError ?? null,
        }
      : null,
  ] as (CalendarSyncItem | null)[]).filter((x) => x !== null);

  const contactOptions: ContactOption[] = contacts.map((c) => ({
    id: c.id,
    label: c.name ? `${c.name} · ${c.phone}` : c.phone,
  }));

  const selectedLabel = selectedKey
    ? new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        timeZone: "UTC",
      }).format(new Date(`${selectedKey}T12:00:00Z`))
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        eyebrow="agenda"
        title="Agenda"
        description="Os horários que seu agente marcou nas conversas, mais o que você marcar à mão."
        actions={
          <NewAppointmentDialog
            contacts={contactOptions}
            defaultDate={selectedKey ?? `${today.year}-${pad(today.month)}-${pad(today.day)}`}
            defaultDuration={config.durationMinutes}
          />
        }
      />

      {/* Resultado da ida ao Google — a rota de callback devolve por query. */}
      {google === "conectado" && <Alert tone="success">Google Agenda conectado.</Alert>}
      {google === "cancelado" && (
        <Alert tone="info">Conexão com o Google cancelada. Nada foi alterado.</Alert>
      )}
      {google === "erro" && (
        <Alert tone="danger">
          Não conseguimos conectar ao Google Agenda. Tente de novo em alguns instantes.
        </Alert>
      )}
      {google === "indisponivel" && (
        <Alert tone="warn">
          A integração com o Google não está configurada nesta instalação.
        </Alert>
      )}

      {/* O caminho para o agente marcar sozinho, dito onde a dúvida aparece:
          quem abre a Agenda vazia precisa saber que existe um toggle a ligar. */}
      {primaryAgent && !scheduleAction?.enabled && (
        <Alert tone="info" title="Seu agente ainda não marca horários">
          A ação <strong className="font-medium">Agendar horário</strong> está desligada. Ligue no
          passo “Ações” do agente para ele combinar data e hora durante a conversa —{" "}
          <Link
            href={`/agentes/${primaryAgent.id}`}
            className="underline underline-offset-2 hover:text-white"
          >
            abrir {primaryAgent.name}
          </Link>
          .
        </Alert>
      )}

      {scheduleAction?.enabled && primaryAgent && !primaryAgent.enabled && (
        <Alert tone="warn">
          O agente está desligado, então ninguém está marcando horários pelas conversas.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Card>
            <CalendarMonth
              year={year}
              month={month}
              selectedDay={selectedDay}
              today={today}
              countByDay={countByDay}
              hrefFor={hrefFor}
            />
          </Card>

          <Card>
            <h2 className="font-display text-lg font-semibold capitalize text-white">
              {selectedLabel ?? "Escolha um dia"}
            </h2>

            {dayAppointments.length === 0 ? (
              <EmptyState
                icon={CalendarX2}
                title="Nada marcado neste dia"
                description="Quando o agente combinar um horário com alguém, ele aparece aqui. Você também pode marcar à mão."
                className="py-8"
              />
            ) : (
              <ul className="mt-4 space-y-3">
                {dayAppointments.map((appointment) => {
                  const badge = STATUS_BADGE[appointment.status] ?? {
                    label: appointment.status,
                    tone: "neutral" as const,
                  };
                  return (
                    <li
                      key={appointment.id}
                      className="rounded-surface border border-white/10 bg-white/5 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 font-medium text-white">
                            <span className="font-mono tabular-nums text-white/80">
                              {timeInZone(appointment.startsAt, config.timezone)}–
                              {timeInZone(appointment.endsAt, config.timezone)}
                            </span>
                            <span className="truncate">{appointment.title}</span>
                            <Badge tone={badge.tone}>{badge.label}</Badge>
                            {appointment.source === "agent" && <Badge tone="iris">pelo agente</Badge>}
                          </p>

                          {appointment.lead && (
                            <p className="mt-1 flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.15em] text-white/55">
                              <User size={12} aria-hidden />
                              {appointment.lead.name || appointment.lead.phone}
                            </p>
                          )}
                          {appointment.notes && (
                            <p className="mt-2 text-sm text-white/60">{appointment.notes}</p>
                          )}
                          {appointment.googleEventId && (
                            <p className="mt-2 font-mono text-micro uppercase tracking-wide text-white/35">
                              no google agenda
                            </p>
                          )}
                        </div>

                        {appointment.status === "scheduled" && (
                          <AppointmentActions id={appointment.id} title={appointment.title} />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="font-display text-base font-semibold text-white">
              Horário de atendimento
            </h2>
            <p className="mt-2 flex items-start gap-2 text-sm text-white/65">
              <Clock size={15} aria-hidden className="mt-0.5 shrink-0 text-white/40" />
              {describeSchedule(config)}
            </p>
            <p className="mt-2 text-sm text-white/45">Fuso: {config.timezone}</p>
            {primaryAgent && (
              <Link
                href={`/agentes/${primaryAgent.id}`}
                className="mt-3 inline-block rounded-control font-mono text-micro uppercase tracking-[0.15em] text-signal underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
              >
                Mudar em Ações do agente
              </Link>
            )}
          </Card>

          <CalendarSyncStatus items={syncItems} />

          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-white">Contatos</h2>
              <Link
                href="/contatos"
                className="shrink-0 rounded-control font-mono text-micro uppercase tracking-wide text-iris underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
              >
                Ver todos
              </Link>
            </div>

            {contacts.length === 0 ? (
              <EmptyState
                icon={UsersRound}
                title="Nenhum contato ainda"
                description="Quando alguém falar com seu agente, aparece aqui."
                className="py-6"
              />
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {contacts.slice(0, SIDEBAR_CONTACTS).map((c) => {
                  const status = leadStatusLabel(c.status);
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/contatos?q=${encodeURIComponent(c.phone)}`}
                        className="flex items-center justify-between gap-2 rounded-control px-2 py-2 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-white/85">
                            {c.name || c.phone}
                          </span>
                          {c.name && (
                            <span className="block truncate font-mono text-micro text-white/45">
                              {c.phone}
                            </span>
                          )}
                        </span>
                        <Badge tone={status.tone} className="shrink-0">
                          {status.label}
                        </Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
