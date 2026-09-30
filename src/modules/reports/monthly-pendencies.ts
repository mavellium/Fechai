import { normalizeLabel, type MonthlyAssumptions } from "./monthly-config";
import type { MonthlyMetrics } from "./monthly";

/*
 * Central de pendências do fechamento mensal.
 *
 * `detectMonthlyPendencies` é a regra ÚNICA do que falta: `applyMonthlyOverrides`
 * gera `missing` a partir dela, e as limitações do fechamento
 * (`monthly-limitations.ts`) também. Pendência não trava mais o fechamento:
 * vira limitação que o admin confirma. Assim a central nunca diz "confirmado"
 * para algo que o relatório entrega como "não verificado" (nem o contrário).
 *
 * A pendência é calculada na leitura, nunca gravada. O que a Mavellium registra
 * (quem responde, quando pediu, a resposta) mora em `MonthlyRoiPendency`, por
 * tópico, e não muda número nenhum: a resposta é aplicada à mão na revisão.
 *
 * Nada aqui leva dado de paciente: as perguntas usam contagens e nomes de
 * procedimento, nunca nome, telefone ou texto de conversa.
 */

export type PendencyOwner = "reception" | "agenda" | "finance" | "mavellium";
export const PENDENCY_OWNERS: Record<PendencyOwner, string> = {
  reception: "Recepção", agenda: "Agenda", finance: "Financeiro", mavellium: "Mavellium",
};
const OWNER_ORDER: PendencyOwner[] = ["reception", "agenda", "finance", "mavellium"];

/** O que falta: um dado que ninguém passou, algo a confirmar ou um número a conferir. */
export type PendencyKind = "data" | "confirm" | "check";
export type AffectedMetric = "classification" | "revenue" | "savings" | "investment" | "roi";
export const AFFECTED_METRIC_LABELS: Record<AffectedMetric, string> = {
  classification: "Dentro/fora do horário", revenue: "Receita estimada", savings: "Economia estimada",
  investment: "Investimento mensal", roi: "ROI do mês",
};

export const PENDENCY_TOPICS = ["hours", "attendance", "classification", "ticket", "team", "consistency", "investment"] as const;
export type PendencyTopic = (typeof PENDENCY_TOPICS)[number];
export function isPendencyTopic(value: string): value is PendencyTopic {
  return (PENDENCY_TOPICS as readonly string[]).includes(value);
}

type TopicDef = { owner: PendencyOwner; kind: PendencyKind; affects: AffectedMetric[]; title: (monthName: string) => string };
export const TOPIC_DEFS: Record<PendencyTopic, TopicDef> = {
  hours: { owner: "reception", kind: "confirm", affects: ["classification", "revenue", "roi"], title: () => "Expediente da recepção" },
  attendance: { owner: "agenda", kind: "confirm", affects: ["revenue", "roi"], title: () => "Comparecimento das avaliações" },
  classification: { owner: "agenda", kind: "check", affects: ["revenue", "roi"], title: () => "Classificação dos agendamentos" },
  ticket: { owner: "finance", kind: "data", affects: ["revenue", "roi"], title: () => "Ticket e conversão" },
  team: { owner: "finance", kind: "data", affects: ["savings", "roi"], title: () => "Custo e tempo da equipe" },
  consistency: { owner: "mavellium", kind: "check", affects: ["revenue", "roi"], title: () => "Conferência dos indicadores" },
  investment: { owner: "mavellium", kind: "data", affects: ["investment", "roi"], title: (monthName) => `Mensalidade de ${monthName}` },
};
/** Só a clínica responde estes; os da Mavellium nunca entram na solicitação. */
export const askedFromClinic = (topic: PendencyTopic) => TOPIC_DEFS[topic].owner !== "mavellium";

export type MonthlyPendency = { topic: PendencyTopic; text: string };

/**
 * O que ainda falta para fechar a competência, na ordem em que o relatório
 * sempre listou. Recebe as métricas já com procedimentos, economia e
 * mensalidade calculados; a receita é derivada DEPOIS, a partir daqui.
 */
export function detectMonthlyPendencies(m: MonthlyMetrics, config: MonthlyAssumptions): MonthlyPendency[] {
  const found: MonthlyPendency[] = [];
  const add = (topic: PendencyTopic, text: string) => found.push({ topic, text });
  if (!config.humanHours) add("hours", "Horário humano não informado.");
  if (m.attendanceUnknown) add("attendance", `${m.attendanceUnknown} avaliação(ões) sem comparecimento confirmado.`);
  if (m.untypedAppointments) add("classification", `${m.untypedAppointments} agendamento(s) sem tipo de atendimento; confira se são avaliações.`);
  if (m.attended.unclassified) add("consistency", "Há avaliações realizadas sem horário de chegada do contato.");
  if (m.procedures.some((p) => p.revenueCents === null)) add("ticket", "Faltam procedimento, ticket ou conversão de avaliações realizadas fora do horário.");
  if (!config.procedures.length) add("ticket", "Ticket e conversão por procedimento ainda não informados.");
  if (config.procedures.some((p) => p.ticketCents === null || p.conversionBps === null)) add("ticket", "Há procedimentos sem ticket ou conversão nas premissas.");
  // Uma correção não pode criar receita maior que o total de presenças fora do expediente.
  const outside = m.procedures.reduce((sum, p) => sum + p.attendedOutside, 0);
  if (outside !== m.attended.outside) add("consistency", "Confira as avaliações realizadas fora do horário: o total deve corresponder à soma por procedimento.");
  if (m.savingsCents === null) add("team", "Informe custo e carga mensal do atendente e o tempo por mensagem (ou por conversa) para a economia estimada.");
  if (m.investmentCents === null) add("investment", "Mensalidade não informada.");
  return found;
}
export const blocksRevenue = (pendencies: MonthlyPendency[]) => pendencies.some((p) => TOPIC_DEFS[p.topic].affects.includes("revenue"));

/** A pergunta que vai para a clínica, com o detalhe que a pessoa precisa para responder. */
export function pendencyQuestion(topic: PendencyTopic, m: MonthlyMetrics, config: MonthlyAssumptions): string | null {
  switch (topic) {
    case "hours":
      return "Em quais dias e horários a recepção atende (com as pausas)? É isso que separa os contatos que chegaram fora do expediente.";
    case "attendance":
      return `${m.attendanceUnknown} ${m.attendanceUnknown === 1 ? "avaliação marcada pelo agente ainda não tem" : "avaliações marcadas pelo agente ainda não têm"} comparecimento confirmado. Podem conferir na agenda quais aconteceram?`;
    case "classification":
      return `${m.untypedAppointments} ${m.untypedAppointments === 1 ? "agendamento antigo do agente está" : "agendamentos antigos do agente estão"} sem tipo de atendimento. Eram avaliações?`;
    case "ticket": {
      // Premissa incompleta ou procedimento realizado sem premissa nenhuma.
      const names = [...new Map([
        ...config.procedures.filter((p) => p.ticketCents === null || p.conversionBps === null).map((p) => p.name),
        ...m.procedures.filter((p) => p.revenueCents === null).map((p) => p.name),
      ].map((name) => [normalizeLabel(name), name])).values()];
      if (!names.length) return "Quais procedimentos vocês oferecem, com o ticket médio de cada um e quantas avaliações, em média, viram tratamento?";
      return `Qual o ticket médio e a conversão (de cada 10 avaliações, quantas viram tratamento) de: ${names.join(", ")}?`;
    }
    case "team": {
      const asks = [
        config.attendantMonthlyCents === null && "o custo mensal de quem atende (salário + encargos)",
        !config.attendantMonthlyHours && "a carga horária mensal dessa pessoa",
        config.secondsPerMessage == null && config.minutesPerConversation == null && "quanto tempo, em média, ela leva para ler e responder uma mensagem",
      ].filter(Boolean) as string[];
      if (!asks.length) return null;
      return `Precisamos de ${asks.length === 1 ? asks[0] : `${asks.slice(0, -1).join(", ")} e ${asks.at(-1)}`}.`;
    }
    default:
      return null;
  }
}

export const PENDENCY_ANSWER_MAX = 1000;
export const PENDENCY_ASSIGNEE_MAX = 80;
export type PendencyTracking = {
  topic: string; assignee: string; requestedAt: Date | null; requestedVia: string | null;
  answer: string; answeredAt: Date | null;
};
export type PendencyStatus = "confirmed" | "answered" | "requested" | PendencyKind;
export const PENDENCY_STATUS_LABELS: Record<PendencyStatus, string> = {
  confirmed: "Confirmado", answered: "Resposta a aplicar", requested: "Aguardando clínica",
  data: "Aguardando dados", confirm: "Aguardando confirmação", check: "Requer conferência",
};
export type PendencyRow = {
  topic: PendencyTopic; title: string; owner: PendencyOwner; ownerLabel: string; status: PendencyStatus;
  details: string[]; question: string | null; affects: string[]; askedFromClinic: boolean;
  assignee: string; requestedAt: string | null; requestedVia: string | null; answer: string; answeredAt: string | null;
};

/**
 * Uma linha por tópico, sempre as mesmas (tópico sem pendência aparece como
 * "Confirmado"), ordenadas por responsável. Resposta registrada depois do
 * último pedido vira "Resposta a aplicar": ela não muda número sozinha.
 */
export function buildPendencyBoard(input: {
  metrics: MonthlyMetrics; config: MonthlyAssumptions; monthName: string; tracking: PendencyTracking[];
}): PendencyRow[] {
  const found = detectMonthlyPendencies(input.metrics, input.config);
  const tracked = new Map(input.tracking.filter((t) => isPendencyTopic(t.topic)).map((t) => [t.topic, t]));
  return PENDENCY_TOPICS.map((topic): PendencyRow => {
    const def = TOPIC_DEFS[topic], t = tracked.get(topic);
    const details = found.filter((p) => p.topic === topic).map((p) => p.text);
    const answered = Boolean(t?.answeredAt && (!t.requestedAt || t.answeredAt >= t.requestedAt));
    const status: PendencyStatus = !details.length ? "confirmed" : answered ? "answered" : t?.requestedAt ? "requested" : def.kind;
    return {
      topic, title: def.title(input.monthName), owner: def.owner, ownerLabel: PENDENCY_OWNERS[def.owner], status, details,
      question: details.length ? pendencyQuestion(topic, input.metrics, input.config) : null,
      affects: def.affects.map((a) => AFFECTED_METRIC_LABELS[a]), askedFromClinic: askedFromClinic(topic),
      assignee: t?.assignee ?? "", requestedAt: t?.requestedAt?.toISOString() ?? null, requestedVia: t?.requestedVia ?? null,
      answer: t?.answer ?? "", answeredAt: t?.answeredAt?.toISOString() ?? null,
    };
  }).sort((a, b) => OWNER_ORDER.indexOf(a.owner) - OWNER_ORDER.indexOf(b.owner));
}

/** Tópicos que entram na solicitação: pendentes, da clínica e com pergunta. */
export const requestableRows = (rows: PendencyRow[]) => rows.filter((r) => r.status !== "confirmed" && r.askedFromClinic && r.question);

/**
 * Uma mensagem só para a clínica, agrupada por área (e pela pessoa atribuída),
 * em vez de uma conversa por dado. `whatsapp` usa *negrito*; `email` é texto puro.
 */
export function buildPendencyRequest(input: {
  rows: PendencyRow[]; clinicName: string; contactName: string | null; monthLabel: string;
  dueAt: Date; now?: Date; timezone: string; format: "whatsapp" | "email";
}): string {
  const rows = requestableRows(input.rows);
  if (!rows.length) return "";
  const bold = (text: string) => input.format === "whatsapp" ? `*${text}*` : text;
  const due = new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezone, day: "2-digit", month: "2-digit" }).format(input.dueAt);
  const late = (input.now ?? new Date()) >= input.dueAt;
  const firstName = input.contactName?.trim().split(/\s+/)[0];
  const groups = new Map<string, PendencyRow[]>();
  for (const row of rows) {
    const heading = row.assignee.trim() ? `${row.ownerLabel} (${row.assignee.trim()})` : row.ownerLabel;
    groups.set(heading, [...(groups.get(heading) ?? []), row]);
  }
  let n = 0;
  const blocks = [...groups].map(([heading, items]) => [bold(heading), ...items.map((r) => `${++n}. ${r.title}: ${r.question}`)].join("\n"));
  return [
    `Olá${firstName ? `, ${firstName}` : ""}! Tudo bem?`,
    `Estamos fechando o relatório de resultados do Fechai de ${input.monthLabel} da ${input.clinicName}. ${late ? "Para entregar o quanto antes" : `Para entregar até ${due}`}, precisamos de ${n === 1 ? "uma informação" : `${n} informações`}. Juntamos tudo aqui para resolver numa conversa só:`,
    ...blocks,
    "Pode responder por aqui mesmo, citando os números. Se alguma área não souber, é só nos dizer quem pode passar.",
    "Obrigado!\nEquipe Mavellium",
  ].join("\n\n");
}

/** Telefone brasileiro guardado sem máscara → número do wa.me; null quando não dá para confiar. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 12 || digits.length === 13) return digits.startsWith("55") ? digits : null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}
