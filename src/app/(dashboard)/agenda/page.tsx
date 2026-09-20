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
import { getClinicorpStatus } from "@/modules/scheduling/clinicorp";
import { listMonthAppointments } from "@/modules/scheduling/repository";
import { timeInZone, todayInZone } from "@/modules/scheduling/time";
import { leadStatusLabel } from "../conversas/leadStatus";
import { CalendarMonth } from "./CalendarMonth";
import { AppointmentActions } from "./AppointmentActions";
import { AppointmentReminders } from "./AppointmentReminders";
import { parseReminderOverride } from "@/modules/scheduling/reminder-override";
import { NewAppointmentDialog, type ContactOption } from "./NewAppointmentDialog";
import { cn } from "@/lib/utils";
import { CalendarSyncStatus, type CalendarSyncItem } from "./CalendarSyncStatus";

/** Quantos contatos mostrar no painel lateral — o resto fica em /contatos. */
const SIDEBAR_CONTACTS = 6;

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
    getClinicorpStatus(tenantId),
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
          error: clinicorp?.lastError ?? (clinicorp && !clinicorp.businessId ? "Escolha a clínica em Integrações." : null),
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
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="agenda"
        title="Agenda"
        description="Os horários que seu agente marcou nas conversas, mais o que você marcar à mão."
        actions={
          <NewAppointmentDialog
            contacts={contactOptions}
            defaultDate={selectedKey ?? `${today.year}-${pad(today.month)}-${pad(today.day)}`}
            defaultDuration={config.durationMinutes}
            durations={config.durations}
            requiresContact={Boolean(features.clinicorpEnabled && clinicorp?.syncEnabled)}
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

      {/* Primeira View: Calendário (~65%) e Agendamentos do Dia (~35%) Lado a Lado */}
      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        {/* Calendário do Mês (Ocupa ~65% do grid, altura natural compacta) */}
        <Card className="p-4 lg:p-6 lg:col-span-7 xl:col-span-7">
          <CalendarMonth
            year={year}
            month={month}
            selectedDay={selectedDay}
            today={today}
            countByDay={countByDay}
            hrefFor={hrefFor}
          />
        </Card>

        {/* Agendamentos do Dia Selecionado (Ocupa ~35% do grid, com altura máxima e scroll interno) */}
        <Card className="flex flex-col p-5 lg:p-6 lg:col-span-5 xl:col-span-5 max-h-[33rem]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3.5 shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-semibold capitalize text-white">
                  {selectedLabel ?? "Escolha um dia"}
                </h2>
                {selectedDay === today.day && month === today.month && year === today.year && (
                  <span className="rounded-control bg-iris/20 px-2 py-0.5 font-mono text-micro uppercase tracking-wider text-iris">
                    Hoje
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-micro uppercase tracking-wider text-white/45">
                {dayAppointments.length} {dayAppointments.length === 1 ? "compromisso marcado" : "compromissos marcados"}
              </p>
            </div>

            {dayAppointments.length > 0 && (
              <NewAppointmentDialog
                contacts={contactOptions}
                defaultDate={selectedKey ?? `${today.year}-${pad(today.month)}-${pad(today.day)}`}
                defaultDuration={config.durationMinutes}
                durations={config.durations}
                requiresContact={Boolean(features.clinicorpEnabled && clinicorp?.syncEnabled)}
                triggerLabel="+ Agendar"
              />
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {dayAppointments.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                <EmptyState
                  icon={CalendarX2}
                  title="Nenhum horário marcado"
                  description="Quando o agente agendar no WhatsApp, o horário aparece aqui automaticamente."
                  action={
                    <NewAppointmentDialog
                      contacts={contactOptions}
                      defaultDate={selectedKey ?? `${today.year}-${pad(today.month)}-${pad(today.day)}`}
                      defaultDuration={config.durationMinutes}
                      durations={config.durations}
                      requiresContact={Boolean(features.clinicorpEnabled && clinicorp?.syncEnabled)}
                      triggerLabel="Marcar horário neste dia"
                    />
                  }
                  className="py-2"
                />
              </div>
            ) : (
              <ul className="space-y-3">
                {dayAppointments.map((appointment) => {
                  const leadDisplayName = appointment.lead?.name || appointment.lead?.phone || appointment.title;
                  const avatarInitial = leadDisplayName.slice(0, 1).toUpperCase();

                  // Status visual sutil como no módulo de conversas (sem pílulas chamativas)
                  const statusConfig =
                    appointment.status === "scheduled"
                      ? { text: "marcado", color: "text-success", bar: "bg-success" }
                      : appointment.status === "canceled"
                        ? { text: "cancelado", color: "text-danger", bar: "bg-danger" }
                        : { text: "realizado", color: "text-white/40", bar: "bg-white/25" };

                  return (
                    <li
                      key={appointment.id}
                      className="relative flex flex-col gap-3 rounded-surface border border-white/10 bg-white/5 p-3.5 transition-all duration-150 hover:border-white/20 hover:bg-white/[0.08]"
                    >
                      {/* Faixa indicadora de urgência/status na borda esquerda */}
                      <span
                        aria-hidden
                        className={cn("absolute left-0 top-3 bottom-3 w-1 rounded-full", statusConfig.bar)}
                      />

                      <div className="flex min-w-0 flex-1 items-start gap-3 pl-1.5">
                        {/* Avatar / Inicial do Lead */}
                        <span
                          aria-hidden
                          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 font-display text-xs font-semibold uppercase text-white/80"
                        >
                          {avatarInitial}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center rounded-control border border-iris/30 bg-iris/15 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-iris">
                              {timeInZone(appointment.startsAt, config.timezone)}–
                              {timeInZone(appointment.endsAt, config.timezone)}
                            </span>
                            <span className="truncate font-semibold text-white text-sm">{appointment.title}</span>

                            {/* Status e Origem como texto discreto estilizado (padrão conversas) */}
                            <span className={cn("font-mono text-micro uppercase tracking-wider font-medium ml-1", statusConfig.color)}>
                              {statusConfig.text}
                            </span>
                            {appointment.source === "agent" && (
                              <span className="font-mono text-micro uppercase tracking-wider text-iris/80">
                                • pelo agente
                              </span>
                            )}
                          </div>

                          {appointment.lead && (
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/60">
                              <span className="flex items-center gap-1 font-mono text-micro uppercase tracking-wider text-white/70">
                                <User size={12} aria-hidden className="text-white/40" />
                                {appointment.lead.name || appointment.lead.phone}
                              </span>
                              <Link
                                href={`/conversas?q=${encodeURIComponent(appointment.lead.phone)}`}
                                className="font-mono text-micro uppercase tracking-wide text-iris hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-iris"
                              >
                                Ver conversa →
                              </Link>
                            </div>
                          )}

                          {appointment.notes && (
                            <p className="mt-1.5 rounded-control border border-white/5 bg-black/20 px-2.5 py-1 text-xs leading-relaxed text-white/70">
                              {appointment.notes}
                            </p>
                          )}

                          <div className="mt-1.5 flex flex-wrap items-center gap-3">
                            {appointment.googleEventId && (
                              <span className="inline-flex items-center gap-1.5 font-mono text-micro uppercase tracking-wide text-white/40">
                                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                                Google Agenda
                              </span>
                            )}

                            {appointment.status === "scheduled" && features.clinicorpEnabled && (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 font-mono text-micro uppercase tracking-wide",
                                  appointment.clinicorpAppointmentId ? "text-success" : "text-warn"
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    appointment.clinicorpAppointmentId ? "bg-success" : "bg-warn"
                                  )}
                                />
                                {appointment.clinicorpAppointmentId
                                  ? "Clinicorp enviado"
                                  : "Pendente Clinicorp"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {appointment.status === "scheduled" && (
                        <div className="flex shrink-0 items-center gap-2 border-t border-white/10 pt-2 sm:border-t-0 sm:pt-0">
                          <AppointmentReminders
                            id={appointment.id}
                            title={appointment.title}
                            override={parseReminderOverride(appointment.reminderOverride)}
                            agentReminders={config.reminderEnabled ? config.reminders : []}
                            location={config.location}
                            sentCount={appointment.remindersSent.length}
                          />
                          <AppointmentActions id={appointment.id} title={appointment.title} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* Linha de Apoio: Horário de atendimento, Sincronização e Contatos em 3 colunas */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <h2 className="font-display text-sm font-semibold text-white">
            Horário de atendimento
          </h2>
          <p className="mt-2 flex items-start gap-2 text-xs text-white/65">
            <Clock size={14} aria-hidden className="mt-0.5 shrink-0 text-white/40" />
            {describeSchedule(config)}
          </p>
          <p className="mt-1.5 font-mono text-micro text-white/45">Fuso: {config.timezone}</p>
          {primaryAgent && (
            <Link
              href={`/agentes/${primaryAgent.id}`}
              className="mt-2.5 inline-block font-mono text-micro uppercase tracking-[0.15em] text-signal underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-iris"
            >
              Mudar em Ações do agente →
            </Link>
          )}
        </Card>

        <CalendarSyncStatus items={syncItems} />

        <Card className="p-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="font-display text-sm font-semibold text-white">Contatos recentes</h2>
            <Link
              href="/contatos"
              className="shrink-0 font-mono text-micro uppercase tracking-wide text-iris underline underline-offset-4 hover:text-white"
            >
              Ver todos
            </Link>
          </div>

          {contacts.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title="Nenhum contato ainda"
              description="Quando alguém falar com seu agente, aparece aqui."
              className="py-4"
            />
          ) : (
            <ul className="-mx-2 space-y-0.5">
              {contacts.slice(0, SIDEBAR_CONTACTS).map((c) => {
                const status = leadStatusLabel(c.status);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/contatos?q=${encodeURIComponent(c.phone)}`}
                      className="flex items-center justify-between gap-2 rounded-control px-2 py-1.5 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-iris"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-white/85">
                          {c.name || c.phone}
                        </span>
                        {c.name && (
                          <span className="block truncate font-mono text-[10px] text-white/45">
                            {c.phone}
                          </span>
                        )}
                      </span>
                      <Badge tone={status.tone} className="shrink-0 text-[10px] px-1.5 py-0">
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
  );
}
