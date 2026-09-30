import type { MonthlyMetrics, MonthlyReport, SplitCount } from "./monthly";
import { hoursPremise } from "./monthly-time";

/**
 * Selo de qualidade de cada indicador do ROI mensal. Diz ao decisor quanto
 * confiar no número antes de ele perguntar: contado registro a registro
 * (verificado), derivado de premissas (estimado), com registros sem o dado que
 * classifica (cobertura parcial), sem dado para calcular (pendente) ou com um
 * valor que os registros não sustentam (inconsistente).
 *
 * Calculado em `computeMonthlyReport` e congelado no snapshot, para o painel e
 * o PDF mostrarem o mesmo selo do número publicado. Puro.
 */

export type QualityStatus = "verified" | "estimated" | "partial" | "pending" | "inconsistent";
export type MetricQuality = { status: QualityStatus; reasons: string[] };

export const QUALITY_KEYS = [
  "newContacts", "conversations", "firstResponse", "qualified", "scheduled", "attended", "handoffs", "unanswered",
  "gapAnswer", "audios", "textMessages", "assumedHours", "revenue", "savings", "investment", "roi", "peaks", "leads",
] as const;
export type QualityKey = typeof QUALITY_KEYS[number];
export type MonthlyQuality = Partial<Record<QualityKey, MetricQuality>>;

export const QUALITY_LABEL: Record<QualityStatus, string> = {
  verified: "Verificado", estimated: "Estimado", partial: "Cobertura parcial", pending: "Pendente", inconsistent: "Inconsistente",
};
/** Uma linha para a legenda do painel e do PDF. */
export const QUALITY_LEGEND = "Verificado: contado registro a registro. Estimado: usa premissas. Cobertura parcial: há registros sem o dado que classifica. Pendente: falta dado para calcular. Inconsistente: o valor não bate com os registros.";
/** A mesma legenda numa linha, para o rodapé do PDF. */
export const QUALITY_FOOTER = "Qualidade: verificado = registro a registro · estimado = premissas · cobertura parcial = registros sem o dado · pendente = falta dado · inconsistente = diverge dos registros. Registros no painel.";

// Da pior para a melhor: o selo é a pior situação encontrada.
const SEVERITY: QualityStatus[] = ["inconsistent", "pending", "partial", "estimated", "verified"];

type Report = Pick<MonthlyReport, "current" | "automatic" | "assumptions" | "metricOverrides" | "clinicorpError" | "investmentSource" | "leadQuality" | "evidence">;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fmt = (v: number | null | undefined) => v == null ? "vazio" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

class Grade {
  private issues: { status: QualityStatus; reason: string }[] = [];
  add(status: QualityStatus, reason: string) { this.issues.push({ status, reason }); return this; }
  /** Correção manual que os registros não sustentam. */
  manual(label: string, shown: number | null | undefined, computed: number | null | undefined, tolerance = 0) {
    const differ = shown == null || computed == null ? shown != computed : Math.abs(shown - computed) > tolerance;
    if (differ) this.add("inconsistent", `${label}: ajustado manualmente para ${fmt(shown)}; os registros somam ${fmt(computed)}.`);
    return this;
  }
  done(base: QualityStatus, reason?: string): MetricQuality {
    const all = reason ? [...this.issues, { status: base, reason }] : [...this.issues, { status: base, reason: "" }];
    const status = SEVERITY.find((s) => all.some((i) => i.status === s))!;
    return { status, reasons: all.map((i) => i.reason).filter(Boolean) };
  }
}

function split(g: Grade, label: string, shown: SplitCount, auto: SplitCount | undefined) {
  if (!auto) return g;
  return g.manual(`${label} dentro`, shown.inside, auto.inside).manual(`${label} fora`, shown.outside, auto.outside)
    .manual(`${label} sem classificação`, shown.unclassified, auto.unclassified);
}

export function monthlyQuality(r: Report): MonthlyQuality {
  const a = r.current, c = r.assumptions;
  // Sem `automatic` (não acontece em relatório gerado aqui) não há com o que
  // conferir a correção: a checagem de consistência simplesmente não roda.
  const auto: MonthlyMetrics | undefined = r.automatic?.current;
  const partialTracking = "Só eventos registrados depois da implantação; histórico ausente não significa zero.";
  const noHours = "Expediente humano não informado: dentro/fora não pode ser classificado.";
  const q: MonthlyQuality = {};

  q.newContacts = new Grade().manual("Novos contatos", a.newContacts, auto?.newContacts)
    .done("verified", "Conversas com resposta do agente de contatos criados no mês.");

  const conv = split(new Grade(), "Conversas", a.conversations, auto?.conversations);
  if (!c.humanHours) conv.add("pending", noHours);
  if (a.conversations.unclassified) conv.add("partial", `${plural(a.conversations.unclassified, "conversa", "conversas")} sem horário de chegada classificado.`);
  q.conversations = conv.done("verified", "Conversas com resposta do agente, pela primeira chegada respondida no mês.");

  const first = new Grade().manual("Primeira resposta", a.firstResponseSeconds, auto?.firstResponseSeconds, 0.5);
  if (a.firstResponseSeconds === null) first.add("pending", "Nenhuma resposta registrada no mês.");
  q.firstResponse = first.done("verified", "Média de um par (chegada, primeira resposta) por conversa, de IA e da equipe.");

  for (const [key, label] of [["qualified", "Leads qualificados"], ["handoffs", "Transbordos"], ["unanswered", "Perguntas sem resposta"]] as const) {
    const g = new Grade().manual(label, a[key], auto?.[key]);
    if (!a.trackingComplete) g.add("partial", partialTracking);
    q[key] = g.done("verified", "Eventos registrados pelo agente no mês.");
  }

  const scheduled = split(new Grade(), "Agendadas", a.scheduled, auto?.scheduled).manual("Sem tipo", a.untypedAppointments, auto?.untypedAppointments);
  if (!c.humanHours) scheduled.add("pending", noHours);
  if (a.scheduled.unclassified) scheduled.add("partial", `${plural(a.scheduled.unclassified, "avaliação agendada", "avaliações agendadas")} sem horário de chegada do contato.`);
  if (a.untypedAppointments) scheduled.add("partial", `${plural(a.untypedAppointments, "agendamento", "agendamentos")} sem tipo de atendimento, fora da conta até a conferência.`);
  q.scheduled = scheduled.done("verified", "Agendamentos do agente criados no mês, de tipo avaliação.");

  const attended = split(new Grade(), "Realizadas", a.attended, auto?.attended).manual("Comparecimento pendente", a.attendanceUnknown, auto?.attendanceUnknown);
  if (!c.humanHours) attended.add("pending", noHours);
  const byProcedure = a.procedures.reduce((sum, p) => sum + p.attendedOutside, 0);
  if (byProcedure !== a.attended.outside) attended.add("inconsistent", `A soma por procedimento (${byProcedure}) não bate com as realizadas fora do expediente (${a.attended.outside}).`);
  if (a.attended.unclassified) attended.add("partial", `${plural(a.attended.unclassified, "avaliação realizada", "avaliações realizadas")} sem horário de chegada do contato.`);
  if (a.attendanceUnknown) attended.add("partial", `${plural(a.attendanceUnknown, "avaliação", "avaliações")} sem comparecimento confirmado.`);
  if (r.clinicorpError) attended.add("partial", "A agenda do Clinicorp não pôde ser lida; comparecimentos vinculados ficam pendentes.");
  q.attended = attended.done("verified", "Consultas do mês com comparecimento confirmado (fechai ou status do Clinicorp).");

  if (a.gapsAnswered !== undefined) {
    q.gapAnswer = new Grade().manual("Perguntas aprovadas", a.gapsAnswered, auto?.gapsAnswered)
      .done("verified", "Perguntas da fila aprovadas no mês: da primeira vez perguntada até a aprovação.");
  }

  if (a.time) {
    const audios = new Grade().manual("Áudios", a.time.audios, auto?.time?.audios).manual("Minutos de áudio", a.time.audioMinutes, auto?.time?.audioMinutes, 0.01);
    if (a.time.unmeasuredAudios) audios.add("partial", `${plural(a.time.unmeasuredAudios, "áudio", "áudios")} sem duração medida; entram só com o tempo de resposta.`);
    q.audios = audios.done("verified", "Áudios do contato que o agente ouviu (transcritos) e respondeu.");
    q.textMessages = new Grade().manual("Mensagens de texto", a.time.textMessages, auto?.time?.textMessages)
      .done("verified", "Mensagens do contato cuja primeira resposta foi do agente.");
  }

  const hours = new Grade();
  if (a.assumedHours === null) hours.add("pending", "Informe o tempo por mensagem ou por conversa.");
  q.assumedHours = hours.done("estimated", `Estimativa: ${hoursPremise(r)}.`);

  const missing = (g: Grade) => { for (const m of a.missing) g.add("pending", m); return g; };
  q.revenue = (a.revenueCents === null ? missing(new Grade()) : new Grade())
    .done("estimated", "Avaliações realizadas fora do expediente × conversão × ticket, por procedimento.");
  const savings = new Grade();
  if (a.savingsCents === null) savings.add("pending", "Informe custo e carga mensal do atendente e o tempo por mensagem (ou por conversa).");
  q.savings = savings.done("estimated", "Horas devolvidas × custo/hora do atendente.");

  const investment = new Grade();
  if (a.investmentCents === null) investment.add("pending", "Mensalidade não informada.");
  if (r.investmentSource) investment.add("estimated", `${r.investmentSource}, a conferir nesta competência.`);
  q.investment = investment.done("verified", "Mensalidade informada na revisão.");

  const roi = a.roiPercent === null ? missing(new Grade()) : new Grade();
  if (a.investmentCents === 0) roi.add("pending", "Mensalidade zero: o ROI percentual não se aplica.");
  q.roi = roi.done("estimated", "(receita + economia − mensalidade) ÷ mensalidade.");

  const peaks = new Grade();
  const autoPeaks = auto?.peaks;
  if (autoPeaks && JSON.stringify(a.peaks) !== JSON.stringify(autoPeaks)) {
    peaks.add("inconsistent", "Horários de pico ajustados manualmente; os registros indicam outra ordem ou contagem.");
  }
  q.peaks = peaks.done("verified", "Mensagens recebidas por hora local da clínica.");

  if (r.leadQuality) {
    const leads = new Grade();
    const listed = r.evidence?.leads ? r.evidence.truncated.leads ?? r.evidence.leads.length : undefined;
    if (listed !== undefined && listed !== r.leadQuality.leads) leads.add("inconsistent", `O bloco mostra ${r.leadQuality.leads} leads; os registros somam ${listed}.`);
    q.leads = leads.done("verified", "Leads reais criados no mês. Cidade, dúvida e motivo: só o que o contato disse ao agente.");
  }
  return q;
}
