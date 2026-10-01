"use client";
import { startTransition, useActionState, useRef, useState, useTransition, type ReactNode } from "react";
import { useActionToast } from "@/components/ui/toast";
import { ArrowLeft, ArrowRight, Calculator, Check, Download, Eye, ListChecks, Plus, RefreshCw, Send, Sparkles, Trash2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { SelectMenu } from "@/components/ui/select-menu";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, fieldProps } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, FormFeedback } from "@/components/ui/alert";
import { UnsavedForm, useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { TIMEZONES } from "@/modules/scheduling/time";
import { minuteLabel } from "@/modules/scheduling/weekly-availability";
import type { MonthlyCaseCandidate, MonthlyMetrics, MonthlyReport } from "@/modules/reports/monthly";
import { financialEnabled, humanClosedDatesFromText, monthlyAssumptionsSchema, normalizeLabel, type MonthlyAssumptions } from "@/modules/reports/monthly-config";
import { NO_INCIDENT, executiveSummary, monthlyIncidents } from "@/modules/reports/monthly-executive";
import { ACTION_RESULT_MAX, ACTION_STATUSES, ACTION_STATUS_LABEL, previousActionsProblem, type ActionStatus, type PreviousAction } from "@/modules/reports/monthly-previous-actions";
import { PERIOD_LABEL, WEEKDAY_LABEL, caseFactItems } from "@/modules/reports/monthly-case";
import { FEATURED_CASE_MAX, formatDuration, hoursPremise } from "@/modules/reports/monthly-time";
import { monthlyOverridesSchema, type MonthlyOverrides } from "@/modules/reports/monthly-overrides";
import type { MonthlyQuality, QualityKey } from "@/modules/reports/monthly-quality";
import { QualityBadge } from "@/app/(dashboard)/relatorios/MonthlyEvidence";
import { HIGHLIGHTS_MAX, LIMITATIONS_NOTE_MAX, limitationFingerprint, unverifiedMetrics, type MonthlyLimitation } from "@/modules/reports/monthly-limitations";
import { ANALYSIS_CONTEXT_MAX, draftAnalysisBase } from "@/modules/reports/monthly-analysis";
import { NEXT_ACTIONS_MAX, hasNextPlan, type MonthlyNextAction } from "@/modules/reports/monthly-next-actions";
import { ACCOUNT_OWNERS_MAX, PERSON_NAME_MAX, decisionMakerProblem, ownersFromText, samePerson } from "@/modules/reports/monthly-decision-maker";
import { MonthlyMetricFields } from "./MonthlyMetricFields";
import { MonthlyAgentImport } from "./MonthlyAgentImport";
import { MonthlyClinicorpStatus } from "./MonthlyClinicorpStatus";
import { MonthlyRoiAiAssistant } from "./MonthlyRoiAiAssistant";
import { monthlyAiDraftSchema, monthlyDraftProblem, applyMonthlyAiChanges, type MonthlyAiDraft, type MonthlyAiChange } from "@/modules/reports/monthly-ai";
import { monthlyCloseProblems } from "@/modules/reports/monthly-close-check";
import { monthlyScheduleSuggestion, type MonthlyImportSources } from "@/modules/reports/monthly-import";
import { saveMonthlyRoi, finalizeMonthlyRoi, reopenMonthlyRoi, recordMonthlyDelivery, previewMonthlyRoiImport } from "./actions";
import { generateMonthlyRoiAnalysis } from "./ai-actions";
import { AGENT_CHANGES_MAX, AGENT_CHANGE_KINDS, AGENT_CHANGE_LABELS, type AgentChangeKind, type ReportedAgentChange } from "@/modules/reports/monthly-agent-changes";
import { blockingIssues, type MonthlyIssue } from "@/modules/reports/monthly-validate";
import { formatCount, formatReais, formatSpan, STATUS_SEAL } from "@/modules/reports/monthly-format";
import type { Metric } from "@/modules/reports/monthly-data";

const decimal = (v: number | null, scale = 1) => v === null ? "" : String(v / scale).replace(".", ",");
function readNumber(value: FormDataEntryValue | null, scale = 1, currency = false): number | null {
  const raw = String(value ?? "").trim();
  const text = currency ? raw.replace(/\./g, "") : raw;
  if (!text) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) throw new Error("Revise os valores numéricos. Use vírgula para os decimais.");
  const result = Number(text.replace(",", ".")) * scale;
  return scale === 100 ? Math.round(result) : result;
}
const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
type HourRange = { start: string; end: string };
function readTime(text: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) throw new Error("Preencha os horários no formato 09:00.");
  const h = Number(match[1]), m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) throw new Error("Revise os horários do atendimento humano.");
  return h * 60 + m;
}

/*
 * Assistente de fechamento: cinco etapas sobre UM formulário. Cada etapa só
 * mostra as suas seções (as outras ficam `hidden`, mas no formulário), então
 * "Salvar revisão" grava tudo de qualquer etapa e trocar de etapa não perde o
 * que foi digitado. Nenhuma etapa trava a seguinte: o status de cada uma é
 * calculado do relatório e só orienta. O que trava é o fechamento (servidor).
 */
const STEPS = [
  { key: "import", label: "Importar e conferir", icon: Download },
  { key: "pendencies", label: "Resolver pendências", icon: ListChecks },
  { key: "results", label: "Validar resultados", icon: Calculator },
  { key: "analysis", label: "Análise com IA", icon: Sparkles },
  { key: "deliver", label: "Aprovar e entregar", icon: Send },
] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4;
/** Limitações que se conferem nos dados (etapa 1); as demais são pendências a resolver (etapa 2). */
const COVERAGE_KEYS = new Set(["tracking", "clinicorp", "arrival", "audio", "consistency"]);
const coverageOf = (list: MonthlyLimitation[] = []) => list.filter((l) => COVERAGE_KEYS.has(l.key));
const pendenciesOf = (list: MonthlyLimitation[] = []) => list.filter((l) => !COVERAGE_KEYS.has(l.key));
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type StepState = { done: boolean; hint: string };
function stepStates(r: MonthlyReport, owners: string[]): StepState[] {
  const a = r.current, coverage = coverageOf(r.limitations), pending = pendenciesOf(r.limitations);
  // A âncora é a agenda; dinheiro só conta para o status com o retorno estimado ligado.
  const anchorsOpen = (["scheduled", "attended", "conversations"] as const).filter((k) => r.quality?.[k]?.status === "pending").length;
  const unverified = anchorsOpen + (financialEnabled(r.assumptions) ? [a.revenueCents, a.savingsCents, a.roiPercent].filter((v) => v === null).length : 0);
  const decisor = !decisionMakerProblem(r, owners);
  const analysis = Boolean((r.adjustments || r.agentChanges?.length) && hasNextPlan(r) && decisor && !previousActionsProblem(r.previousActions));
  return [
    // Fechado antes da lista de limitações: não há como dizer "completa".
    { done: Boolean(r.revision), hint: !r.revision ? "revisão não salva" : !r.limitations ? "sem registro" : coverage.length ? count(coverage.length, "aviso de cobertura", "avisos de cobertura") : "cobertura completa" },
    { done: pending.length === 0, hint: !r.limitations ? "sem registro" : pending.length ? count(pending.length, "pendência", "pendências") : "nada pendente" },
    { done: unverified === 0, hint: unverified ? count(unverified, "número não verificado", "números não verificados") : "agenda e atendimento" },
    { done: analysis, hint: analysis ? "textos preenchidos" : !(r.adjustments && hasNextPlan(r)) ? "textos a escrever" : decisor ? "ações anteriores a avaliar" : "decisor a definir" },
    { done: r.status === "ready", hint: r.status !== "ready" ? "aguardando aprovação" : r.meetingAt ? "reunião registrada" : r.sentAt ? "enviado" : "fechado" },
  ];
}
function initialStep(r: MonthlyReport, owners: string[]): StepIndex {
  if (r.status === "ready") return 4;
  const s = stepStates(r, owners);
  if (!s[0].done) return 0;
  if (!s[1].done) return 1;
  if (!s[3].done) return 3;
  return 4;
}

/** `owners`: donos e sócios da conta (`Tenant.ownerNames`), os únicos que podem ser o decisor. */
type EditorProps = { tenantId: string; report: MonthlyReport; sources: MonthlyImportSources; owners: string[]; caseCandidates?: MonthlyCaseCandidate[]; pendencyCenter?: ReactNode;
  /** Relatório v2: o que o validador achou na revisão salva. */
  issues?: MonthlyIssue[] };

/**
 * Guarda a etapa fora do editor: salvar muda a revisão, o editor remonta (a
 * chave inclui `revision`) e a pessoa continua na etapa em que estava.
 */
export function MonthlyCloseWizard(props: EditorProps) {
  const r = props.report;
  const [step, setStep] = useState<StepIndex>(() => initialStep(r, props.owners));
  return <MonthlyRoiEditor key={`${r.month}:${r.status}:${r.revision ?? "new"}`} {...props} step={r.status === "ready" ? 4 : step} onStep={setStep} />;
}

type Check = { current: MonthlyMetrics; quality: MonthlyQuality; limitations: MonthlyLimitation[]; assumptions: MonthlyAssumptions; metricOverrides?: MonthlyOverrides; fresh: boolean };

function MonthlyRoiEditor({ tenantId, report: r, sources, owners, caseCandidates = [], pendencyCenter, issues, step, onStep }: EditorProps & { step: StepIndex; onStep: (step: StepIndex) => void }) {
  const [defaults, setDefaults] = useState<MonthlyAiDraft>({ assumptions: r.assumptions, metricOverrides: r.metricOverrides ?? { current: {}, previous: {} }, adjustments: r.adjustments, nextMonth: r.nextMonth, decisionMaker: r.decisionMaker, highlights: r.highlights ?? "", limitationsNote: r.limitationsNote ?? "", nextActions: r.nextActions ?? [] });
  const c = defaults.assumptions;
  const [aiOpen, setAiOpen] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [agentIds, setAgentIds] = useState(c.agentIds ?? []);
  const suggested = monthlyScheduleSuggestion(sources.agents, agentIds);
  const formRef = useRef<HTMLFormElement>(null);
  const [loaded, setLoaded] = useState(r);
  const [importVersion, setImportVersion] = useState(0);
  const [importedInvestment, setImportedInvestment] = useState<number | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [hoursOrigin, setHoursOrigin] = useState(c.humanHours ? "" : suggested.names.join(", "));
  const [metricOverrides, setMetricOverrides] = useState(r.metricOverrides ?? { current: {}, previous: {} });
  const [timezone, setTimezone] = useState(c.humanHours ? c.timezone : suggested.timezone ?? c.timezone);
  const [hoursConfirmed, setHoursConfirmed] = useState(c.humanHours !== null);
  const [closedDatesText, setClosedDatesText] = useState((c.humanClosedDates ?? []).join("\n"));
  const closedDates = humanClosedDatesFromText(closedDatesText);
  const closedDatesCheck = monthlyAssumptionsSchema.shape.humanClosedDates.safeParse(closedDates);
  const closedDatesError = closedDatesCheck.success ? null : closedDatesCheck.error.issues[0]?.message ?? "Revise os dias sem recepção.";
  const [hours, setHours] = useState<HourRange[][]>(() => Array.from({ length: 7 }, (_, day) => (c.humanHours ?? suggested.hours)?.[day].map((h) => ({ start: minuteLabel(h.start), end: minuteLabel(h.end) })) ?? []));
  const [procedures, setProcedures] = useState(() => c.procedures.map((p, id) => ({ ...p, id })));
  const nextId = useRef(procedures.length);
  const [untyped, setUntyped] = useState(c.countUntypedAsEvaluations);
  const [statuses, setStatuses] = useState(c.completedStatusTypes);
  // Retorno estimado (receita, economia, ROI): opcional, ligado só com as premissas conferidas.
  const [financial, setFinancial] = useState(financialEnabled(c));
  // Controlado: preencher com a IA remonta o formulário, e o caso não passa por ela.
  const [featuredCase, setFeaturedCase] = useState(r.featuredCase ?? "");
  // Decisor × contato operacional: também controlados, pelo mesmo motivo.
  const [ownersText, setOwnersText] = useState(owners.join("\n"));
  const [decisionMaker, setDecisionMaker] = useState(r.decisionMaker);
  const [operationalContact, setOperationalContact] = useState(r.operationalContact ?? "");
  const accountOwners = ownersFromText(ownersText);
  // Só vale como decisor quem está na lista: nome de fora (o campo antigo era livre) vai vazio.
  const chosenOwner = accountOwners.find((name) => samePerson(name, decisionMaker)) ?? "";
  const savedDecisorProblem = decisionMakerProblem(r, owners);
  // Ações do mês anterior: a lista vem do relatório anterior aprovado; aqui só o status e o resultado.
  const [previousActions, setPreviousActions] = useState<PreviousAction[]>(r.previousActions ?? []);
  const setPrevious = (index: number, patch: Partial<PreviousAction>) => setPreviousActions(previousActions.map((item, i) => i === index ? { ...item, ...patch } : item));
  // Fatos do caso do mês: a conversa escolhida e a idade. Duração, dia e período são lidos no servidor.
  const [caseConversation, setCaseConversation] = useState(r.caseFacts?.conversationId ?? "");
  const [caseAge, setCaseAge] = useState(r.caseFacts?.age == null ? "" : String(r.caseFacts.age));
  const chosenCase = caseCandidates.find((candidate) => candidate.conversationId === caseConversation);
  const incidents = monthlyIncidents(r);
  const [noShowStatuses, setNoShowStatuses] = useState(c.noShowStatusTypes ?? []);
  // Relatório v2: papel do decisor e mudanças registradas no agente, fora do alcance da IA.
  const [decisionMakerRole, setDecisionMakerRole] = useState(r.decisionMakerRole ?? "");
  const [agentChanges, setAgentChanges] = useState<ReportedAgentChange[]>(r.agentChanges ?? []);
  const v2 = Boolean(r.data);
  const blocking = blockingIssues(issues ?? []);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ ok: boolean; error?: string; info?: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [check, setCheck] = useState<Check>({ current: r.current, quality: r.quality ?? {}, limitations: r.limitations ?? [], assumptions: r.assumptions, metricOverrides: r.metricOverrides, fresh: false });
  const [aiContext, setAiContext] = useState("");
  const [analysisInfo, setAnalysisInfo] = useState<{ notes: string; provider: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, start] = useTransition();
  const [state, submit, saving] = useActionState(saveMonthlyRoi.bind(null, tenantId, r.month), null);
  useActionToast(state, saving, { entity: "relatório mensal" });
  useActionToast(actionFeedback, false, { entity: "relatório mensal" });
  const confirmNavigation = useUnsavedNavigation();
  const locked = r.status === "ready";
  const pending = busy || saving;
  const states = stepStates(r, owners);
  const act = (fn: () => Promise<{ ok: boolean; error?: string; info?: string }>) => start(async () => {
    try { setActionFeedback(await fn()); } catch { setActionFeedback({ ok: false, error: "Não foi possível salvar. Tente novamente." }); }
  });
  const moneyField = (name: string, label: string, value: number | null) => <Field label={label} htmlFor={`roi-${name}`}><CurrencyInput key={name === "investmentCents" ? `${name}:${importedInvestment}` : name} {...fieldProps(`roi-${name}`)} name={name} defaultValueCents={name === "investmentCents" ? importedInvestment ?? value : value} placeholder="Não informado" /></Field>;
  const numberField = (name: string, label: string, value: number | null, hint?: string) => <Field label={label} htmlFor={`roi-${name}`} hint={hint}><Input {...fieldProps(`roi-${name}`, { hint: Boolean(hint) })} name={name} inputMode="decimal" defaultValue={decimal(value)} placeholder="Não informado" /></Field>;
  const readAssumptions = (form: FormData) => ({
    agentIds, timezone, humanHours: hoursConfirmed ? hours.map((day) => day.map((h) => ({ start: readTime(h.start), end: readTime(h.end) }))) : null,
    humanClosedDates: closedDates,
    attendantMonthlyCents: readNumber(form.get("attendantMonthlyCents"), 100, true), attendantMonthlyHours: readNumber(form.get("attendantMonthlyHours")),
    minutesPerConversation: readNumber(form.get("minutesPerConversation")), secondsPerMessage: readNumber(form.get("secondsPerMessage")),
    investmentCents: readNumber(form.get("investmentCents"), 100, true),
    receptionTargetMinutes: readNumber(form.get("receptionTargetMinutes")),
    procedureVariable: String(form.get("procedureVariable") ?? ""), evaluationTypes: String(form.get("evaluationTypes") ?? "").split("\n").map((v) => v.trim()).filter(Boolean),
    countUntypedAsEvaluations: untyped, completedStatusTypes: statuses, noShowStatusTypes: noShowStatuses.filter((type) => !statuses.includes(type)), financialEnabled: financial,
    procedures: procedures.map((p) => ({ name: String(form.get(`procedure-${p.id}`) ?? ""), ticketCents: readNumber(form.get(`ticket-${p.id}`), 100, true), conversionBps: readNumber(form.get(`conversion-${p.id}`), 100) })),
  });
  const getAiDraft = (): MonthlyAiDraft => {
    if (!formRef.current) throw new Error("Abra a edição do relatório primeiro.");
    const form = new FormData(formRef.current);
    const assumptions = readAssumptions(form);
    assumptions.procedures = assumptions.procedures.filter((p) => p.name.trim() || p.ticketCents !== null || p.conversionBps !== null);
    const parsed = monthlyAiDraftSchema.safeParse({ assumptions, metricOverrides,
      adjustments: String(form.get("adjustments") ?? ""), nextMonth: String(form.get("nextMonth") ?? ""), decisionMaker: String(form.get("decisionMaker") ?? ""),
      highlights: String(form.get("highlights") ?? ""), limitationsNote: String(form.get("limitationsNote") ?? ""), nextActions: readNextActions(form, false) });
    if (!parsed.success) throw new Error(monthlyDraftProblem(parsed.error.issues));
    return parsed.data;
  };
  const applyAi = (basis: MonthlyAiDraft, changes: MonthlyAiChange[]) => {
    const current = getAiDraft();
    if (JSON.stringify(current) !== JSON.stringify(basis)) throw new Error("A revisão mudou desde esta resposta. Envie uma nova pergunta para usar os dados atuais.");
    const next = applyMonthlyAiChanges(current, changes);
    setDefaults(next); setImportedInvestment(null); setMetricOverrides(next.metricOverrides); setDecisionMaker(next.decisionMaker);
    setTimezone(next.assumptions.timezone);
    if (changes.some((change) => change.field === "assumptions.humanHours")) {
      setHoursConfirmed(false); setHoursOrigin("sugestão da IA");
      setHours(Array.from({ length: 7 }, (_, day) => next.assumptions.humanHours?.[day].map((h) => ({ start: minuteLabel(h.start), end: minuteLabel(h.end) })) ?? []));
    }
    setProcedures(next.assumptions.procedures.map((p) => ({ ...p, id: nextId.current++ })));
    setImportVersion((v) => v + 1); setFormVersion((v) => v + 1);
    setImportInfo("Campos preenchidos com a ajuda da IA. Confira os valores e os horários antes de salvar a revisão.");
  };
  /** Recalcula no servidor com as premissas da tela (sem salvar). */
  const loadPreview = async () => {
    const form = new FormData(formRef.current!);
    form.set("assumptions", JSON.stringify(readAssumptions(form)));
    const result = await previewMonthlyRoiImport(tenantId, r.month, form);
    if (!result.ok) { setError(result.error); return null; }
    setLoaded(result.report); setImportVersion((v) => v + 1); setError(null);
    return { form, report: result.report };
  };
  const importData = () => start(async () => {
    if (!formRef.current) return;
    try {
      const done = await loadPreview();
      if (!done) return;
      if (!String(done.form.get("investmentCents") ?? "").trim()) setImportedInvestment(sources.priceCents);
      if (!hoursConfirmed && suggested.hours) {
        setHours(suggested.hours.map((day) => day.map((h) => ({ start: minuteLabel(h.start), end: minuteLabel(h.end) }))));
        setTimezone(suggested.timezone!); setHoursOrigin(suggested.names.join(", "));
      }
      setImportInfo(`Dados carregados para ${agentIds.length ? done.report.agentNames?.join(", ") : "todos os agentes"}. Ajustes manuais mantidos; confira e salve a revisão.${suggested.warning ? ` ${suggested.warning}` : ""}`);
    } catch { setError("Não foi possível importar. Confira os campos e tente novamente."); }
  });
  // Etapa 3: mesmos números que o relatório teria ao salvar, com as correções ainda não salvas.
  const recalculate = () => start(async () => {
    if (!formRef.current) return;
    try {
      const draft = getAiDraft();
      const done = await loadPreview();
      if (!done) return;
      const base = draftAnalysisBase(done.report, draft);
      setCheck({ current: base.current, quality: base.quality, limitations: base.limitations, assumptions: draft.assumptions, metricOverrides: draft.metricOverrides, fresh: true });
    } catch (err) { setError(err instanceof Error && err.name !== "ZodError" ? err.message : "Não foi possível recalcular. Confira os campos e tente novamente."); }
  });
  const generateAnalysis = () => start(async () => {
    try {
      // Capturar antes do await: controles disabled não entram em FormData.
      const current = getAiDraft();
      const form = new FormData();
      form.set("request", JSON.stringify({ draft: current, context: aiContext.trim() }));
      const result = await generateMonthlyRoiAnalysis(tenantId, r.month, form);
      if (!result.ok) { setError(result.error); return; }
      const a = result.analysis;
      setDefaults({ ...current, highlights: a.highlights || current.highlights, limitationsNote: a.limitationsNote || current.limitationsNote,
        adjustments: a.adjustments || current.adjustments, nextActions: a.nextActions.length ? a.nextActions : current.nextActions });
      setImportedInvestment(null); setFormVersion((v) => v + 1); setError(null);
      setAnalysisInfo({ notes: a.notes, provider: a.providerLabel });
    } catch (err) { setError(err instanceof Error && err.name !== "ZodError" ? err.message : "Confira os campos da revisão antes de gerar a análise."); }
  });
  const goTo = (next: number) => { if (next >= 0 && next <= 4) { onStep(next as StepIndex); setError(null); } };
  const pdfHref = `/admin/relatorios/${tenantId}/pdf?mes=${r.month}`;
  const limitations = r.limitations ?? [];
  const unverified = unverifiedMetrics(r);
  const closeProblems = monthlyCloseProblems(r, owners);

  return <Card className="text-ink panel:text-white/85">
    <CardTitle action={<Badge tone={locked ? "success" : "neutral"}>{locked ? "Fechado" : "Rascunho"}</Badge>}>Fechamento do mês</CardTitle>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-xl text-sm text-neutral panel:text-white/60"><p>{locked ? `Relatório disponível para a clínica${r.decisionMaker ? ` · decisor (dono): ${r.decisionMaker}` : ""}${r.operationalContact ? ` · cópia: ${r.operationalContact}` : ""}.` : "Siga as etapas na ordem ou pule para qualquer uma. Nada trava o avanço: o que ficar sem evidência sai como limitação explícita no fechamento."}</p><p className="mt-1">Prazo de entrega: {new Intl.DateTimeFormat("pt-BR", { timeZone: c.timezone }).format(new Date(r.dueAt))}.</p></div>
      {!locked && <Button variant="outline" disabled={pending} onClick={() => setAiOpen(true)}><Sparkles size={15} aria-hidden />Perguntar à I.A</Button>}
    </div>

    {!locked && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-ink/10 p-4 panel:border-white/10">
      <div className="flex items-start gap-3"><Switch checked={financial} onCheckedChange={setFinancial} disabled={pending} label="Incluir retorno estimado no relatório" />
        <div><p className="text-sm font-medium">Retorno estimado · {financial ? "ligado" : "desligado"}</p><p className="mt-1 text-xs text-neutral panel:text-white/60">{financial ? "Mostra parcelas financeiras disponíveis; ROI só com premissas e comparecimentos completos. Confira os valores na etapa 2." : "Receita, economia e ROI ficam fora do painel e do PDF."} Salve a revisão para aplicar.</p></div>
      </div>
      <input type="hidden" name="financialToggle" form="roi-edit-form" value={String(financial)} />
      {step === 4 && <Button type="submit" form="roi-edit-form" variant="outline" size="sm" loading={saving} disabled={pending}>Salvar revisão</Button>}
    </div>}

    <ol className="mt-6 grid gap-2 sm:grid-cols-5" aria-label="Etapas do fechamento">
      {STEPS.map((s, i) => {
        const current = i === step, st = states[i], disabled = locked && i < 4;
        return <li key={s.key} className="min-w-0">
          <button type="button" onClick={() => goTo(i)} disabled={disabled} aria-current={current ? "step" : undefined}
            title={disabled ? "Reabra a revisão para editar esta etapa." : undefined}
            className={cn("flex h-full w-full items-start gap-2 rounded-control border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-iris disabled:cursor-not-allowed disabled:opacity-60",
              current ? "border-iris/60 bg-iris/10" : "border-ink/10 hover:bg-ink/5 panel:border-white/10 panel:hover:bg-white/5")}>
            <span aria-hidden className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
              st.done ? "bg-success/20 text-success" : "bg-ink/10 panel:bg-white/10")}>{st.done ? <Check size={11} /> : i + 1}</span>
            <span className="min-w-0"><span className="block text-sm font-medium">{s.label}</span><span className="mt-0.5 block text-xs text-neutral panel:text-white/55">{st.hint}</span></span>
            {st.done && <span className="sr-only">(concluída)</span>}
          </button>
        </li>;
      })}
    </ol>

    {/* Central de pendências: tem os próprios formulários, então fica fora do formulário da revisão. */}
    {!locked && step === 1 && pendencyCenter && <div className="mt-6">{pendencyCenter}</div>}

    {!locked && <UnsavedForm ref={formRef} id="roi-edit-form" hidden={step === 4} result={state} label="Revisão do relatório mensal" className="mt-6 space-y-6 border-t border-ink/10 pt-6 panel:border-white/10" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        if (!monthlyOverridesSchema.safeParse(metricOverrides).success) throw new Error("Revise os indicadores: contagens devem ser inteiras e positivas ou zero; tempos podem ter decimais.");
        if (procedures.some((p) => !String(form.get(`procedure-${p.id}`) ?? "").trim())) { goTo(1); throw new Error("Dê nome a cada procedimento ou remova a linha vazia."); }
        try { form.set("nextActions", JSON.stringify(readNextActions(form, true))); } catch (err) { goTo(3); throw err; }
        if (agentChanges.some((c) => !c.text.trim())) { goTo(3); throw new Error("Descreva cada mudança no agente ou remova a linha vazia."); }
        form.set("agentChanges", JSON.stringify(agentChanges));
        const assumptions = readAssumptions(form);
        form.set("assumptions", JSON.stringify(assumptions)); setError(null); startTransition(() => submit(form));
      } catch (err) { setError(err instanceof Error ? err.message : "Revise os campos."); }
    }}>
      {r.assumptionsFromMonth && step < 3 && <Alert>Premissas trazidas de {r.assumptionsFromMonth.split("-").reverse().join("/")}. Confira os valores e salve a revisão deste mês.</Alert>}
      <input type="hidden" name="revision" value={r.revision ?? ""} />
      <fieldset key={formVersion} disabled={pending} className="min-w-0 space-y-8">
        {/* 1 · Importar e conferir */}
        <div hidden={step !== 0} className="space-y-8">
          <p className="text-sm text-neutral panel:text-white/60">Os indicadores do mês já vêm carregados da conta. Escolha os agentes, confira a cobertura e corrija só o que os registros não sustentam.</p>
          <MonthlyAgentImport sources={sources} agentIds={agentIds} onChange={setAgentIds} onImport={importData} pending={pending} />
          {importInfo && <Alert>{importInfo}</Alert>}
          {issues && <IssueList issues={issues} />}
          <CoverageCheck report={loaded} />
          <MonthlyMetricFields key={importVersion} report={loaded} value={metricOverrides} onChange={setMetricOverrides} />
        </div>

        {/* 2 · Resolver pendências */}
        <div hidden={step !== 1} className="space-y-8">
          <section className="space-y-4">
            <CardTitle as="h3" hint="A receita considera somente contatos cuja primeira mensagem chegou fora deste expediente.">Horário de atendimento humano</CardTitle>
            <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><Switch checked={hoursConfirmed} onCheckedChange={setHoursConfirmed} disabled={pending} label="Horário humano conferido com a clínica" /><span className="text-sm">Horário conferido com a clínica</span></div><div className="w-full sm:w-64"><SelectMenu label="Fuso da clínica" options={TIMEZONES} value={timezone} onChange={setTimezone} disabled={pending} /></div></div>
            {numberField("receptionTargetMinutes", "Meta de primeira resposta humana (min)", c.receptionTargetMinutes ?? null, "Defina com a clínica. Sem valor, o relatório acompanha 1 hora sem tratar esse prazo como meta acordada.")}
            <input type="hidden" name="humanHours" value={JSON.stringify({ hoursConfirmed, hours })} />
            <p className="text-sm text-neutral panel:text-white/55">Use o expediente da recepção. Adicione um período para cada turno; deixe as pausas fora dos intervalos.</p>
            {hoursOrigin && <p className="text-sm text-neutral panel:text-white/65">Grade importada de {hoursOrigin}. Confira se esses turnos correspondem ao atendimento da equipe humana.</p>}
            {!hoursConfirmed && <Alert tone="warn">Confirme o expediente para separar atendimentos dentro e fora do horário.</Alert>}
            <div className="divide-y divide-ink/10 rounded-control border border-ink/10 panel:divide-white/10 panel:border-white/10">{DAYS.map((day, index) => <div key={day} className="flex flex-wrap items-start gap-3 p-3 sm:p-4">
              <div className="flex w-full shrink-0 items-center gap-3 pt-2 sm:w-36"><Switch label={`Atendimento humano: ${day}`} checked={hours[index].length > 0} disabled={pending} onCheckedChange={(checked) => setHours(hours.map((h, i) => i === index ? checked ? [{ start: "09:00", end: "18:00" }] : [] : h))} /><span className="text-sm font-medium">{day}</span></div>
              <div className="min-w-0 flex-1 space-y-3">{hours[index].length === 0 ? <p className="py-2 text-sm text-neutral panel:text-white/50">Sem atendimento humano</p> : hours[index].map((range, j) => <div key={j} className="flex flex-wrap items-end gap-2">
                {(["start", "end"] as const).map((key) => <Field key={key} htmlFor={`hour-${index}-${j}-${key}`} label={key === "start" ? "Das" : "Até"} className="w-24"><Input {...fieldProps(`hour-${index}-${j}-${key}`)} inputMode="numeric" placeholder="09:00" maxLength={5} value={range[key]} onChange={(e) => setHours(hours.map((h, i) => i === index ? h.map((v, k) => k === j ? { ...v, [key]: e.target.value } : v) : h))} /></Field>)}
                <Button type="button" size="icon" variant="ghost" aria-label={`Remover período ${j + 1} de ${day}`} onClick={() => setHours(hours.map((h, i) => i === index ? h.filter((_, k) => k !== j) : h))}><Trash2 size={15} aria-hidden /></Button>
                {j === hours[index].length - 1 && hours[index].length < 4 && <Button type="button" size="sm" variant="ghost" onClick={() => setHours(hours.map((h, i) => i === index ? [...h, { start: "13:00", end: "18:00" }] : h))}><Plus size={14} aria-hidden />Período</Button>}
              </div>)}</div>
            </div>)}</div>
            <Field label="Feriados e dias sem recepção" htmlFor="roi-humanClosedDates" optional error={closedDatesError}
              hint="Uma data por linha, no formato AAAA-MM-DD. Informe só os dias em que a recepção ficou fechada o dia inteiro, no fuso da clínica.">
              <Textarea {...fieldProps("roi-humanClosedDates", { hint: true, error: closedDatesError })} name="humanClosedDates"
                value={closedDatesText} onChange={(e) => setClosedDatesText(e.target.value)} rows={3} placeholder="2026-09-07" />
            </Field>
            <p className="text-sm text-neutral panel:text-white/55">Essas datas contam como fora do expediente humano neste relatório. Confira com a clínica; as datas bloqueadas da agenda do agente não são importadas como feriados.</p>
          </section>
          <section className="space-y-5 border-t border-ink/10 pt-6 panel:border-white/10">
            <CardTitle as="h3" hint="Agendado ou confirmado nunca é presença.">Agendamentos e comparecimentos</CardTitle>
            <p className="text-sm text-neutral panel:text-white/60">O comparecimento vem da marcação da clínica na Agenda, depois do horário da consulta, ou do status do Clinicorp conferido abaixo. Sem nenhum dos dois, a avaliação fica sem confirmação e a receita, não verificada.</p>
            <div className="grid gap-5 lg:grid-cols-2"><Field label="Variável que identifica o procedimento" htmlFor="roi-procedureVariable" hint="Use o nome configurado em Agentes → Variáveis."><Input {...fieldProps("roi-procedureVariable", { hint: true })} name="procedureVariable" maxLength={60} defaultValue={c.procedureVariable} /></Field><Field label="Tipos de atendimento considerados avaliações" htmlFor="roi-evaluationTypes" hint="Um nome por linha, conforme o agendamento do agente."><Textarea {...fieldProps("roi-evaluationTypes", { hint: true })} name="evaluationTypes" defaultValue={c.evaluationTypes.join("\n")} /></Field></div>
            <div className="flex items-start gap-3"><Switch label="Agendamentos antigos sem tipo conferidos como avaliações" checked={untyped} onCheckedChange={setUntyped} disabled={pending} /><p className="text-sm">Conferi que as marcações antigas do agente sem tipo são avaliações.</p></div><input type="hidden" name="untypedConfirmed" value={String(untyped)} />
            <div><p className="text-sm font-medium">Status que comprovam comparecimento no Clinicorp</p><p className="mt-1 text-sm text-neutral panel:text-white/55">Confira com a clínica. Confirmado e agendado não comprovam presença.</p></div>
            <MonthlyClinicorpStatus report={loaded} />
            {loaded.clinicorpError && <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" loading={busy} disabled={pending} onClick={importData}><RefreshCw size={14} aria-hidden />Consultar Clinicorp novamente</Button>
              <p className="text-sm text-neutral panel:text-white/60">Se a leitura continuar falhando, confira cada avaliação na Agenda do Fechai e marque o comparecimento após a consulta. Salve a revisão para atualizar as limitações.</p>
            </div>}
            {[...new Map([...c.completedStatusTypes.map((type) => ({ type, description: type })), ...loaded.clinicorpStatusTypes].map((s) => [s.type, s])).values()].map((s) => <div key={s.type} className="flex items-center gap-3"><Switch label={`Comparecimento: ${s.description}`} disabled={pending || s.type.toUpperCase() === "CONFIRMED"} checked={statuses.includes(s.type)} onCheckedChange={(checked) => setStatuses(checked ? [...statuses, s.type] : statuses.filter((type) => type !== s.type))} /><span className="text-sm">{s.description}</span></div>)}<input type="hidden" name="completedStatusTypes" value={JSON.stringify(statuses)} />
            {v2 && <><div><p className="text-sm font-medium">Status que comprovam a falta no Clinicorp</p><p className="mt-1 text-sm text-neutral panel:text-white/55">Sem este mapeamento, consulta passada sem presença fica como não verificada, nunca como falta.</p></div>
              {[...new Map([...noShowStatuses.map((type) => ({ type, description: type })), ...loaded.clinicorpStatusTypes].map((s) => [s.type, s])).values()].filter((s) => !statuses.includes(s.type)).map((s) => <div key={s.type} className="flex items-center gap-3"><Switch label={`Falta: ${s.description}`} disabled={pending || s.type.toUpperCase() === "CONFIRMED"} checked={noShowStatuses.includes(s.type)} onCheckedChange={(checked) => setNoShowStatuses(checked ? [...noShowStatuses, s.type] : noShowStatuses.filter((type) => type !== s.type))} /><span className="text-sm">{s.description}</span></div>)}</>}
          </section>
          <section className="space-y-4 border-t border-ink/10 pt-6 panel:border-white/10"><CardTitle as="h3" hint="Opcional. Sem ele, o relatório não mostra horas devolvidas.">Tempo devolvido à equipe</CardTitle><div className="grid items-end gap-5 sm:grid-cols-2">
            {numberField("secondsPerMessage", "Tempo por mensagem (s)", c.secondsPerMessage, "Ler e responder cada mensagem que o agente atendeu, somado aos minutos de áudio ouvidos. Ex.: 30.")}
            {numberField("minutesPerConversation", "Tempo humano por conversa (min)", c.minutesPerConversation, "Usado só enquanto o tempo por mensagem estiver vazio.")}
          </div></section>
          <section className="space-y-4 border-t border-ink/10 pt-6 panel:border-white/10">
            <CardTitle as="h3" hint="O relatório mede atendimento, agendamento e comparecimento. O financeiro da clínica é opcional.">Retorno estimado (opcional)</CardTitle>
            <p className="text-sm text-neutral panel:text-white/60">Use a chave de retorno estimado no topo do assistente. Ligue só com ticket, conversão e custo do atendente conferidos com a clínica.</p>
            {!financial && <Alert>Desligado: o relatório não mostra receita, economia nem ROI, e a falta dessas premissas não é pendência nem limitação. O fechamento segue normalmente.</Alert>}
          </section>
          {/* Desligado, os campos seguem no formulário (ocultos) para o que já foi levantado não se perder. */}
          <section hidden={!financial} className="space-y-4"><CardTitle as="h3" hint="Campos vazios viram limitação enquanto o retorno estimado estiver ligado.">Investimento e equipe</CardTitle><div className="grid items-end gap-5 sm:grid-cols-3">
            {moneyField("investmentCents", "Mensalidade do Fechai (R$)", c.investmentCents)}{moneyField("attendantMonthlyCents", "Custo mensal do atendente (R$)", c.attendantMonthlyCents)}
            {numberField("attendantMonthlyHours", "Carga mensal do atendente (h)", c.attendantMonthlyHours)}
          </div>{r.investmentSource && <p className="text-xs text-neutral panel:text-white/55">Mensalidade carregada de: {r.investmentSource}. Confira o valor cobrado nesta competência antes de salvar.</p>}</section>
          <section hidden={!financial} className="space-y-4 border-t border-ink/10 pt-6 panel:border-white/10"><CardTitle as="h3" hint="Conversão é a porcentagem das avaliações que viram tratamento.">Ticket e conversão por procedimento</CardTitle>
            {procedures.length === 0 && <p className="text-sm text-neutral panel:text-white/55">Adicione os procedimentos para estimar a receita.</p>}
            <div className="space-y-4">{procedures.map((p) => <div key={p.id} className="grid items-end gap-4 rounded-control border border-ink/10 p-4 panel:border-white/10 sm:grid-cols-[1fr_1fr_1fr_auto]">
              {/* Sem `required`: a seção pode estar oculta ao salvar de outra etapa, e o navegador recusaria o envio sem mostrar por quê. */}
              <Field label="Procedimento" htmlFor={`procedure-${p.id}`}><Input {...fieldProps(`procedure-${p.id}`)} name={`procedure-${p.id}`} maxLength={60} defaultValue={p.name} placeholder="Ex.: Implante" /></Field>
              {moneyField(`ticket-${p.id}`, "Ticket médio (R$)", p.ticketCents)}<Field label="Conversão (%)" htmlFor={`conversion-${p.id}`}><Input {...fieldProps(`conversion-${p.id}`)} name={`conversion-${p.id}`} inputMode="decimal" defaultValue={decimal(p.conversionBps, 100)} placeholder="Ex.: 30" /></Field>
              <Button type="button" size="icon" variant="ghost" aria-label={`Remover procedimento ${p.name || "sem nome"}`} onClick={() => setProcedures(procedures.filter((v) => v.id !== p.id))}><Trash2 size={16} aria-hidden /></Button>
            </div>)}</div>
            <Button type="button" size="sm" variant="outline" disabled={procedures.length >= 12} onClick={() => setProcedures([...procedures, { id: nextId.current++, name: "", ticketCents: null, conversionBps: null }])}><Plus size={14} aria-hidden />Adicionar procedimento</Button>
          </section>
        </div>

        {/* 3 · Validar resultados */}
        <div hidden={step !== 2}>{v2
          ? <DataCheck report={loaded} financial={financial} fresh={loaded !== r} onRecalculate={() => start(async () => { try { await loadPreview(); } catch { setError("Não foi possível recalcular. Confira os campos e tente novamente."); } })} pending={pending} />
          : <ResultsCheck report={loaded} check={check} investmentSource={loaded.investmentSource} onRecalculate={recalculate} pending={pending} />}</div>

        {/* 4 · Análise com IA */}
        <div hidden={step !== 3} className="space-y-6">
          <section className="space-y-4 rounded-control border border-ink/10 p-4 panel:border-white/10">
            <div className="flex items-center gap-2 text-sm font-medium"><Sparkles size={16} aria-hidden />Gerar a análise com IA</div>
            <p className="text-sm text-neutral panel:text-white/60">A IA lê só os números agregados, o selo de cada um, as limitações e as alterações registradas no agente neste mês. Ela redige; você confere e salva. Número sem evidência nunca é citado, dinheiro só aparece com o retorno estimado ligado e melhoria sem registro não é inventada.</p>
            <Field label="Contexto para a IA (opcional)" htmlFor="roi-ai-context" hint="O que a Mavellium fez ou combinou com a clínica e o sistema não registra. Não vai para o relatório."><Textarea {...fieldProps("roi-ai-context", { hint: true })} value={aiContext} onChange={(e) => setAiContext(e.target.value)} maxLength={ANALYSIS_CONTEXT_MAX} rows={2} placeholder="Ex.: revisamos o tom das respostas e incluímos os preços de clareamento na base." /></Field>
            <Button type="button" size="sm" loading={busy} disabled={pending} onClick={generateAnalysis}><Sparkles size={14} aria-hidden />Gerar ajustes, próximas ações e o que não saiu como planejado</Button>
            {analysisInfo && <Alert title="Rascunho preenchido">Confira o resumo, as limitações, os ajustes e as ações abaixo e salve a revisão.{analysisInfo.notes && ` ${analysisInfo.notes}`} <span className="opacity-75">IA: {analysisInfo.provider}.</span></Alert>}
          </section>
          <Field label="Resumo do período (opcional)" htmlFor="roi-highlights" hint={`Até ${HIGHLIGHTS_MAX} caracteres. Abre a análise detalhada, depois da página 1.`}><Textarea {...fieldProps("roi-highlights", { hint: true })} name="highlights" maxLength={HIGHLIGHTS_MAX} defaultValue={defaults.highlights} rows={5} /></Field>
          <div className="space-y-3">
            <Field label="O que não saiu como planejado (opcional)" htmlFor="roi-limitationsNote" hint={`Até ${LIMITATIONS_NOTE_MAX} caracteres. A seção aparece sempre: mostra os incidentes comprovados abaixo e este texto. Escreva só o que aconteceu de fato e o sistema não registra; não invente problema para preencher.`}><Textarea {...fieldProps("roi-limitationsNote", { hint: true })} name="limitationsNote" maxLength={LIMITATIONS_NOTE_MAX} defaultValue={defaults.limitationsNote} rows={3} /></Field>
            {incidents.length > 0 && <div><p className="text-sm font-medium">Incidentes comprovados pelos dados (entram sozinhos)</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral panel:text-white/60">{incidents.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            {limitations.length > 0 && <div><p className="text-sm font-medium">Limites dos dados deste mês (entram sozinhos)</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral panel:text-white/60">{limitations.map((l) => <li key={l.key}>{l.text}</li>)}</ul></div>}
            {!incidents.length && !limitations.length && <p className="text-sm text-neutral panel:text-white/55">Sem incidente comprovado na revisão salva. Com o campo em branco, a seção dirá: “{NO_INCIDENT}”</p>}
          </div>
          {previousActions.length > 0 && <section className="space-y-3">
            <CardTitle as="h3" hint="Abrem o bloco “O que ajustamos no agente”. Fechar exige o status e o número que comprova em cada uma.">Ações combinadas no mês anterior</CardTitle>
            <input type="hidden" name="previousActions" value={JSON.stringify(previousActions)} />
            {previousActions.map((item, i) => <div key={item.action} className="space-y-3 rounded-control border border-ink/10 p-3 panel:border-white/10">
              <p className="text-sm font-medium">{item.action}{item.owner && <span className="font-normal text-neutral panel:text-white/55"> · {item.owner}{item.indicator && ` · indicador: ${item.indicator}`}</span>}</p>
              <div className="grid items-end gap-3 md:grid-cols-[14rem_1fr]">
                <SelectMenu label={`Status da ação ${i + 1}`} value={item.status ?? ""} disabled={pending} onChange={(value) => setPrevious(i, { status: (ACTION_STATUSES as readonly string[]).includes(value) ? value as ActionStatus : null })}
                  options={[{ value: "", label: "Como foi?" }, ...ACTION_STATUSES.map((status) => ({ value: status, label: ACTION_STATUS_LABEL[status] }))]} />
                <Field label="O número que comprova" htmlFor={`roi-previous-${i}`}><Input {...fieldProps(`roi-previous-${i}`)} maxLength={ACTION_RESULT_MAX} value={item.result} onChange={(e) => setPrevious(i, { result: e.target.value })} placeholder="Ex.: faltas caíram de 31% para 22%" /></Field>
              </div>
            </div>)}
          </section>}
          <div className="grid gap-5 lg:grid-cols-2"><Field label="O que ajustamos no agente" htmlFor="roi-adjustments" hint="Até 400 caracteres. Registre só melhorias executadas. Se não houve ajustes neste mês, informe isso; a IA não inventa mudanças."><Textarea {...fieldProps("roi-adjustments", { hint: true })} name="adjustments" maxLength={400} defaultValue={defaults.adjustments} rows={4} /></Field></div>
          {v2 && <AgentChangesFields value={agentChanges} onChange={setAgentChanges} disabled={pending} />}
          <NextActionsFields defaults={defaults.nextActions} legacy={defaults.nextMonth} />
          <section className="space-y-4">
            <CardTitle as="h3" hint="O relatório é de quem paga a mensalidade. Quem opera o painel recebe cópia.">Para quem vai o relatório</CardTitle>
            <Field label="Donos e sócios da conta" htmlFor="roi-accountOwners" hint={`Um nome por linha, até ${ACCOUNT_OWNERS_MAX}. Fica na conta e vale para os próximos meses. Só quem decide a mensalidade: recepção e gerência não entram aqui.`}>
              <Textarea {...fieldProps("roi-accountOwners", { hint: true })} value={ownersText} onChange={(e) => setOwnersText(e.target.value)} rows={2} placeholder="Ex.: Dra. Ana Souza" />
            </Field>
            <input type="hidden" name="accountOwners" value={JSON.stringify(accountOwners)} />
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Decisor (dono)</p>
                <SelectMenu label="Decisor (dono)" name="decisionMaker" value={chosenOwner} onChange={setDecisionMaker} disabled={pending || accountOwners.length === 0}
                  options={[{ value: "", label: accountOwners.length ? "Escolha um dono ou sócio" : "Informe os donos e sócios acima" }, ...accountOwners.map((name) => ({ value: name, label: name }))]} />
                <p className="text-xs text-neutral panel:text-white/55">Recebe o relatório e a reunião de 30 min.</p>
                {v2 && <><SelectMenu label="Papel do decisor" options={[{ value: "", label: "Papel não informado" }, { value: "owner", label: "Dono" }, { value: "partner", label: "Sócio" }]} value={decisionMakerRole} onChange={setDecisionMakerRole} disabled={pending} /><input type="hidden" name="decisionMakerRole" value={decisionMakerRole} /></>}
              </div>
              <Field label="Contato operacional (recepção)" htmlFor="roi-operationalContact" hint="Opcional. Recebe cópia do relatório; não substitui o decisor.">
                <Input {...fieldProps("roi-operationalContact", { hint: true })} name="operationalContact" maxLength={PERSON_NAME_MAX} value={operationalContact} onChange={(e) => setOperationalContact(e.target.value)} placeholder="Quem usa o painel no dia a dia" />
              </Field>
            </div>
            {decisionMaker.trim() && !chosenOwner && <Alert tone="warn" title="Decisor a corrigir">“{decisionMaker.trim()}” não está entre os donos e sócios da conta. Se é quem opera o painel, informe como contato operacional e escolha o dono ou sócio como decisor.</Alert>}
            {chosenOwner && samePerson(chosenOwner, operationalContact) && <Alert tone="warn">O decisor e o contato operacional são a mesma pessoa. O decisor é o dono ou sócio; a recepção recebe cópia.</Alert>}
          </section>
          <Field label="Caso do mês (opcional)" htmlFor="roi-featuredCase" hint={`Até ${FEATURED_CASE_MAX} caracteres. Escrito por você, nunca pela IA. Pode ser de quem não agendou: o valor está no tempo e na paciência que o agente absorveu. Só o perfil genérico, como "paciente de 74 anos", com dia da semana e período: sem nome, telefone, e-mail ou data exata, que são recusados ao salvar.`}>
            <Textarea {...fieldProps("roi-featuredCase", { hint: true })} name="featuredCase" maxLength={FEATURED_CASE_MAX} value={featuredCase} onChange={(e) => setFeaturedCase(e.target.value)} rows={3}
              placeholder="Ex.: Uma paciente de 76 anos mandou dois áudios num sábado à noite; o agente ouviu tudo, respondeu no ritmo dela e entendeu que ela não quer agendar agora." />
          </Field>
          {/* O formulário só diz qual conversa e a idade: duração dos áudios, dia e período são lidos no servidor. */}
          <input type="hidden" name="caseConversationId" value={caseConversation} />
          <input type="hidden" name="caseAge" value={caseConversation ? caseAge : ""} />
          {(caseCandidates.length > 0 || caseConversation) && <div className="space-y-3 rounded-control border border-ink/10 p-4 panel:border-white/10">
            <div><p className="text-sm font-medium">Fatos do caso: escolha a conversa</p>
              <p className="mt-1 text-xs text-neutral panel:text-white/55">O relatório mostra a idade, a duração de cada áudio, o dia da semana e o período da conversa escolhida. Nunca o nome, o telefone ou a data. Para abrir, use “Entrar como” na conta do cliente e leia a conversa antes de escrever.</p></div>
            <ul className="space-y-2">{caseCandidates.map((candidate) => {
              const selected = candidate.conversationId === caseConversation;
              return <li key={candidate.conversationId} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-control border p-2 text-sm", selected ? "border-iris/60 bg-iris/10" : "border-transparent")}>
                <span className="tabular-nums">{new Intl.DateTimeFormat("pt-BR", { timeZone: c.timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(candidate.firstAt))} · {WEEKDAY_LABEL[candidate.weekday]} {PERIOD_LABEL[candidate.period]} · {candidate.audios.length} {candidate.audios.length === 1 ? "áudio longo" : "áudios longos"}: {candidate.audios.map((s) => formatDuration(s)).join(", ")} · {candidate.scheduled ? "agendou" : "não agendou"}</span>
                <span className="flex items-center gap-3">
                  <a href={`/conversas?id=${candidate.conversationId}`} target="_blank" rel="noreferrer" className="rounded-sm text-iris underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-iris">Abrir conversa</a>
                  <Button type="button" size="sm" variant={selected ? "outline" : "ghost"} aria-pressed={selected} disabled={pending} onClick={() => setCaseConversation(selected ? "" : candidate.conversationId)}>{selected ? "Tirar do caso" : "Usar no caso"}</Button>
                </span>
              </li>;
            })}</ul>
            {caseConversation && <div className="grid items-end gap-4 sm:grid-cols-[10rem_1fr]">
              <Field label="Idade (anos)" htmlFor="roi-caseAge" hint="Como o contato disse. Em branco, não aparece."><Input {...fieldProps("roi-caseAge", { hint: true })} inputMode="numeric" maxLength={3} value={caseAge} onChange={(e) => setCaseAge(e.target.value.replace(/\D/g, ""))} placeholder="Ex.: 76" /></Field>
              <p className="text-sm text-neutral panel:text-white/65">{chosenCase
                ? <>Vai ao relatório: <span className="text-ink panel:text-white/90">{caseFactItems({ conversationId: "", age: caseAge ? Number(caseAge) : null, audioSeconds: chosenCase.audios, weekday: chosenCase.weekday, period: chosenCase.period, scheduled: chosenCase.scheduled }).join(" · ")}</span></>
                : r.caseFacts ? <>Fatos salvos: <span className="text-ink panel:text-white/90">{caseFactItems(r.caseFacts).join(" · ")}</span>. A conversa saiu da lista de sugestões; ao salvar, os fatos são lidos dela de novo.</> : null}
                {" "}<button type="button" className="rounded-sm text-iris underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-iris" onClick={() => setCaseConversation("")}>Remover os fatos</button></p>
            </div>}
          </div>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-5 panel:border-white/10">
          <Button type="button" variant="ghost" size="sm" disabled={step === 0} onClick={() => goTo(step - 1)}><ArrowLeft size={14} aria-hidden />Voltar</Button>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" loading={saving}><Check size={15} aria-hidden />Salvar revisão</Button>
            <Button type="button" onClick={() => goTo(step + 1)}>Próxima etapa<ArrowRight size={14} aria-hidden /></Button>
          </div>
        </div>
      </fieldset><FormFeedback error={error} />
    </UnsavedForm>}

    {/* 5 · Aprovar e entregar */}
    {step === 4 && <div className="mt-6 space-y-5 border-t border-ink/10 pt-6 panel:border-white/10">
      {!locked && <p className="text-sm text-neutral panel:text-white/60">O fechamento usa a revisão <strong>salva</strong>. Salve antes de aprovar: os números, as premissas, os textos e as limitações ficam congelados para a entrega.</p>}
      {!locked && closeProblems.length > 0 && <Alert tone="warn" title="Complete a revisão na etapa 4">
        <p>A cobertura parcial permite entregar números incompletos. O destinatário e o plano do relatório precisam estar revisados e salvos.</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">{closeProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => goTo(3)}>Completar análise e destinatário</Button>
      </Alert>}
      {!locked && blocking.length > 0 && <Alert tone="danger" title="Não dá para fechar ainda"><ul className="list-disc space-y-1 pl-4">{blocking.map((i) => <li key={i.key + i.metric}>{i.message} {i.action}</li>)}</ul></Alert>}
      {limitations.length > 0 ? <Alert tone="warn" title={locked ? "Fechado com cobertura parcial" : `${count(limitations.length, "limitação", "limitações")} neste fechamento`}>
        <p>{v2 ? "Os números afetados saem com o selo de parcial ou não verificado." : unverified.length ? `Sairão como não verificados: ${unverified.join(", ")}.` : "Nenhum valor fica sem cálculo, mas a cobertura dos registros é parcial."} Nada é estimado no lugar do que falta.</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">{limitations.map((l) => <li key={l.key}>{l.text}</li>)}</ul>
        {!locked && <div className="mt-3 flex items-start gap-3"><Switch checked={acknowledged} onCheckedChange={setAcknowledged} disabled={pending} label="Limitações revisadas" /><p className="text-sm">Revisei as limitações. Fecho com cobertura parcial, e elas vão explícitas no painel e no PDF.</p></div>}
      </Alert> : r.limitations && <Alert tone="success">Cobertura completa: todos os números têm evidência nos registros.</Alert>}
      {!locked && <ul className="space-y-1 text-sm">{[
        [!r.partial, r.partial ? "O mês ainda está em andamento: o fechamento abre no mês seguinte." : "Mês encerrado."],
        [Boolean(r.revision), r.revision ? "Revisão salva." : "Salve a revisão."],
        [!savedDecisorProblem, savedDecisorProblem ? `${savedDecisorProblem} Corrija na etapa 4.` : `Decisor (dono): ${r.decisionMaker}${r.operationalContact ? ` · cópia para o contato operacional: ${r.operationalContact}` : ""}.`],
        [Boolean((r.adjustments || r.agentChanges?.length) && hasNextPlan(r)), (r.adjustments || r.agentChanges?.length) && hasNextPlan(r) ? "Ajustes e próximas ações preenchidos." : "Preencha ajustes e as próximas ações na etapa 4."],
        [!previousActionsProblem(r.previousActions), previousActionsProblem(r.previousActions) ?? (r.previousActions?.length ? "Ações do mês anterior avaliadas, com o número que comprova." : "Sem ações combinadas no relatório anterior para avaliar.")],
        [true, incidents.length || limitations.length || r.limitationsNote ? "\"O que não saiu como planejado\": só o que os dados comprovam e o texto da revisão." : `"O que não saiu como planejado" dirá: ${NO_INCIDENT}`],
      ].map(([ok, label]) => <li key={String(label)} className="flex items-center gap-2"><span aria-hidden className={ok ? "text-success" : "text-warn"}>{ok ? "✓" : "•"}</span>{label}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" aria-expanded={preview} aria-controls="roi-pdf-preview" onClick={() => setPreview(!preview)}><Eye size={14} aria-hidden />{preview ? "Fechar prévia" : "Visualizar PDF"}</Button>
        <ButtonLink href={pdfHref} variant="outline" size="sm"><Download size={14} aria-hidden />Baixar PDF{locked ? "" : " · rascunho"}</ButtonLink>
        {!locked ? <Button size="sm" loading={busy} disabled={pending || r.partial || closeProblems.length > 0 || blocking.length > 0 || (limitations.length > 0 && !acknowledged)}
          onClick={() => confirmNavigation(() => act(() => finalizeMonthlyRoi(tenantId, r.month, acknowledged ? limitationFingerprint(limitations) : [])))}>{limitations.length ? "Aprovar com cobertura parcial" : "Aprovar e fechar"}</Button> : <>
          <Button size="sm" disabled={pending || Boolean(r.sentAt)} loading={busy} onClick={() => act(() => recordMonthlyDelivery(tenantId, r.month, "sent"))}>{r.sentAt ? "Envio registrado" : "Registrar envio ao decisor"}</Button><Button size="sm" variant="outline" disabled={pending || !r.sentAt || Boolean(r.meetingAt)} onClick={() => act(() => recordMonthlyDelivery(tenantId, r.month, "meeting"))}>{r.meetingAt ? "Reunião registrada" : "Registrar reunião com o decisor"}</Button>{!r.sentAt && <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => reopenMonthlyRoi(tenantId, r.month))}>Reabrir revisão</Button>}
        </>}
      </div>
      {locked && !r.sentAt && savedDecisorProblem && <Alert tone="warn" title="Decisor a corrigir antes do envio">{savedDecisorProblem} Reabra a revisão e escolha o dono ou sócio.</Alert>}
      {preview && <div id="roi-pdf-preview" className="overflow-hidden rounded-control border border-ink/10 panel:border-white/10">
        <iframe src={`${pdfHref}&ver=1`} title={`Prévia do PDF de ${r.label}`} className="h-[80vh] w-full bg-white" />
      </div>}
      <p className="text-xs text-neutral panel:text-white/55">A Mavellium envia o PDF e apresenta os resultados. Registre o envio e a reunião depois que acontecerem.</p>
      {!locked && <Button type="button" variant="ghost" size="sm" onClick={() => goTo(3)}><ArrowLeft size={14} aria-hidden />Voltar</Button>}
    </div>}
    {!locked && <MonthlyRoiAiAssistant open={aiOpen} onClose={() => setAiOpen(false)} tenantId={tenantId} month={r.month} getDraft={getAiDraft} onApply={applyAi} />}
  </Card>;
}

/**
 * Até três linhas fixas (ação, responsável, indicador). Linha toda vazia é
 * ignorada; linha começada exige as três partes. `strict` só no salvar: a IA
 * pode ler um rascunho incompleto.
 */
function readNextActions(form: FormData, strict: boolean): MonthlyNextAction[] {
  const rows: MonthlyNextAction[] = [];
  for (let i = 0; i < NEXT_ACTIONS_MAX; i++) {
    const get = (k: string) => String(form.get(`nextAction-${i}-${k}`) ?? "").trim();
    const row = { action: get("action"), owner: get("owner"), indicator: get("indicator"), reason: get("reason") };
    if (!row.action && !row.owner && !row.indicator) continue;
    if (!row.action || !row.owner || !row.indicator) { if (strict) throw new Error(`Complete a ação ${i + 1}: ação, responsável e indicador.`); continue; }
    rows.push(row);
  }
  return rows;
}

function NextActionsFields({ defaults, legacy }: { defaults: MonthlyNextAction[]; legacy: string }) {
  return <section className="space-y-3">
    <CardTitle as="h3" hint="Vão depois dos resultados e problemas: três prioridades, cada uma com quem faz e como o próximo relatório acompanha.">Próximas ações</CardTitle>
    {/* O texto antigo segue salvo para os relatórios de antes; aqui ele vira referência. */}
    <input type="hidden" name="nextMonth" value={legacy} />
    {legacy && !defaults.length && <Alert title="Plano antigo, em texto livre">{legacy}</Alert>}
    {Array.from({ length: NEXT_ACTIONS_MAX }, (_, i) => <div key={i} className="grid items-end gap-3 rounded-control border border-ink/10 p-3 panel:border-white/10 md:grid-cols-[2fr_1fr_1.4fr]">
      <Field label={`Ação ${i + 1}`} htmlFor={`roi-action-${i}`}><Input {...fieldProps(`roi-action-${i}`)} name={`nextAction-${i}-action`} maxLength={120} defaultValue={defaults[i]?.action ?? ""} placeholder={i === 0 ? "Ex.: Confirmar os comparecimentos na agenda" : ""} /></Field>
      <Field label="Responsável" htmlFor={`roi-owner-${i}`}><Input {...fieldProps(`roi-owner-${i}`)} name={`nextAction-${i}-owner`} maxLength={60} defaultValue={defaults[i]?.owner ?? ""} placeholder={i === 0 ? "Ex.: Recepção" : ""} /></Field>
      <Field label="Indicador" htmlFor={`roi-indicator-${i}`}><Input {...fieldProps(`roi-indicator-${i}`)} name={`nextAction-${i}-indicator`} maxLength={100} defaultValue={defaults[i]?.indicator ?? ""} placeholder={i === 0 ? "Ex.: Comparecimentos confirmados" : ""} /></Field>
      <Field className="md:col-span-3" label="Problema ou resultado que motiva a ação" htmlFor={`roi-reason-${i}`} optional><Input {...fieldProps(`roi-reason-${i}`)} name={`nextAction-${i}-reason`} maxLength={200} defaultValue={defaults[i]?.reason ?? ""} placeholder="Ex.: Comparecimentos ainda sem confirmação no Clinicorp" /></Field>
    </div>)}
  </section>;
}

/** Etapa 1: o que os registros não cobrem, antes de conferir os números. */
function CoverageCheck({ report }: { report: MonthlyReport }) {
  const coverage = coverageOf(report.limitations);
  return <section className="space-y-3">
    <CardTitle as="h3" hint="Cobertura parcial não impede o fechamento: vira limitação explícita.">Cobertura dos dados</CardTitle>
    {coverage.length ? <Alert tone="warn" title={count(coverage.length, "aviso de cobertura", "avisos de cobertura")}>
      <ul className="mt-1 list-disc space-y-1 pl-4">{coverage.map((l) => <li key={l.key}>{l.text} <span className="opacity-75">Afeta: {l.affects.join(", ")}.</span></li>)}</ul>
    </Alert> : <Alert tone="success">Cobertura completa: os registros do mês têm o dado que classifica cada número.</Alert>}
  </section>;
}

/**
 * Etapa 3: os números da página 1 (agenda primeiro) com o selo e o motivo de
 * cada um. Receita, economia e ROI só aparecem com o retorno estimado ligado.
 */
function ResultsCheck({ report, check, investmentSource, onRecalculate, pending }: { report: MonthlyReport; check: Check; investmentSource?: string; onRecalculate: () => void; pending: boolean }) {
  const a = check.current, c = check.assumptions, q = check.quality;
  const exec = executiveSummary({ ...report, current: check.current, assumptions: c, quality: q, limitations: check.limitations });
  const financial = financialEnabled(c);
  const money = (v: number | null) => v === null ? "Não calculado" : formatBRL(v);
  const costPerHour = c.attendantMonthlyCents !== null && c.attendantMonthlyHours ? Math.round(c.attendantMonthlyCents / c.attendantMonthlyHours) : null;
  const reasons = (metric: QualityKey) => q[metric]?.reasons ?? [];
  const pendingReasons = (metric: QualityKey) => q[metric]?.status === "pending" ? q[metric]!.reasons : [];
  const anchors = exec.kpis.map((kpi) => ({ metric: kpi.key, label: kpi.label, value: kpi.value, lines: [kpi.hint, ...reasons(kpi.key)] }));
  const rows: { metric: QualityKey; label: string; value: string; lines: string[] }[] = [
    { metric: "revenue", label: "Receita estimada", value: money(a.revenueCents), lines: [
      `${a.attended.outside} ${a.attended.outside === 1 ? "avaliação realizada" : "avaliações realizadas"} de contatos que chegaram fora do expediente${c.humanHours ? "" : " (expediente não conferido)"}.`,
      ...a.procedures.filter((p) => p.attendedOutside > 0).map((p) => {
        const premise = c.procedures.find((x) => normalizeLabel(x.name) === normalizeLabel(p.name));
        return premise?.ticketCents != null && premise.conversionBps != null
          ? `${p.name}: ${p.attendedOutside} × ${(premise.conversionBps / 100).toLocaleString("pt-BR")}% × ${formatBRL(premise.ticketCents)} = ${formatBRL(p.revenueCents ?? 0)}`
          : `${p.name}: ${p.attendedOutside} realizadas, sem ticket ou conversão.`;
      }),
      ...pendingReasons("revenue"),
    ] },
    { metric: "savings", label: "Economia estimada", value: money(a.savingsCents), lines: [
      `Horas devolvidas: ${hoursPremise({ current: a, assumptions: c, metricOverrides: check.metricOverrides })}${a.assumedHours === null ? "" : ` = ${formatDuration(a.assumedHours * 3600)}`}.`,
      `Custo/hora do atendente: ${costPerHour === null ? "não informado" : `${formatBRL(c.attendantMonthlyCents!)} ÷ ${c.attendantMonthlyHours} h = ${formatBRL(costPerHour)}`}.`,
      ...pendingReasons("savings"),
    ] },
    { metric: "investment", label: "Investimento mensal", value: money(a.investmentCents), lines: [investmentSource ? `${investmentSource}, a conferir nesta competência.` : "Mensalidade informada na revisão.", ...pendingReasons("investment")] },
    { metric: "roi", label: "ROI do mês", value: a.roiPercent === null ? "Não calculado" : `${a.roiPercent.toLocaleString("pt-BR")}%`, lines: [
      a.roiPercent !== null && a.revenueCents !== null && a.savingsCents !== null && a.investmentCents
        ? `(${formatBRL(a.revenueCents)} + ${formatBRL(a.savingsCents)} − ${formatBRL(a.investmentCents)}) ÷ ${formatBRL(a.investmentCents)}`
        : "(receita + economia − investimento) ÷ investimento: precisa dos três.",
    ] },
  ];
  const grid = (items: typeof rows) => <div className="grid gap-4 lg:grid-cols-2">{items.map((row) => <div key={row.metric} className="rounded-control border border-ink/10 p-4 panel:border-white/10">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{row.label}</p><QualityBadge all quality={q[row.metric]} /></div>
    <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{row.value}</p>
    <ul className="mt-2 space-y-1 text-xs leading-relaxed text-neutral panel:text-white/60">{row.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
  </div>)}</div>;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><CardTitle as="h3" hint="São os quatro números da página 1. A âncora do relatório é a agenda: avaliações agendadas e realizadas.">Validar os resultados</CardTitle>
        <p className="text-sm text-neutral panel:text-white/60">{check.fresh ? "Recalculado agora com os dados da tela, ainda não salvos." : "Calculado com a revisão salva. Recalcule depois de mudar premissas ou indicadores."}</p></div>
      <Button type="button" size="sm" variant="outline" loading={pending} onClick={onRecalculate}><RefreshCw size={14} aria-hidden />Recalcular com os dados da tela</Button>
    </div>
    {grid(anchors)}
    {financial ? <><CardTitle as="h3" hint="Estimativas: somam só o que tem evidência nos registros. O bloco só vai ao relatório com os três valores calculados.">Retorno estimado</CardTitle>{grid(rows)}
      {!exec.financial && <Alert tone="warn">O retorno estimado está ligado, mas ainda não dá para calcular os três valores. Enquanto isso, o bloco não aparece no painel nem no PDF.</Alert>}</>
      : <Alert>Retorno estimado desligado: receita, economia e ROI não aparecem no painel nem no PDF, e a falta de ticket, conversão ou custo não é pendência. Para incluir, ative na etapa 2.</Alert>}
    {check.limitations.length > 0 && <p className="text-sm text-neutral panel:text-white/60">{count(check.limitations.length, "limitação segue", "limitações seguem")} nesta revisão. Dá para fechar assim: o que não tem evidência vai como não verificado.</p>}
  </section>;
}

const SEVERITY_LABEL = { blocking: "Impede o fechamento", warning: "Aviso" } as const;

/** Etapa 1 (relatório v2): o que o validador achou na revisão salva. */
function IssueList({ issues }: { issues: MonthlyIssue[] }) {
  return <section className="space-y-3">
    <CardTitle as="h3" hint="Bloqueio é número que não fecha ou decisor errado. Aviso não impede fechar: o número sai com o selo que tem.">Validação dos números</CardTitle>
    {issues.length ? <ul className="divide-y divide-ink/10 rounded-control border border-ink/10 panel:divide-white/10 panel:border-white/10">{issues.map((i) => <li key={i.key + i.metric} className="flex flex-wrap items-start gap-3 p-3 text-sm">
      <Badge tone={i.severity === "blocking" ? "danger" : "warn"}>{SEVERITY_LABEL[i.severity]}</Badge>
      <div className="min-w-0 flex-1"><p><span className="font-medium">{i.metric}:</span> {i.message}</p><p className="mt-0.5 text-neutral panel:text-white/60">{i.action}</p></div>
    </li>)}</ul> : <Alert tone="success">Os números fecham entre si e nenhum aviso foi encontrado.</Alert>}
  </section>;
}

/** Etapa 3 (relatório v2): os números do motor, com o selo de cada um, e o estado do retorno estimado. */
function DataCheck({ report, financial, fresh, onRecalculate, pending }: { report: MonthlyReport; financial: boolean; fresh: boolean; onRecalculate: () => void; pending: boolean }) {
  const d = report.data;
  if (!d) return null;
  const cell = (m: Metric, format: (v: number) => string = formatCount) => <span className="tabular-nums">{m.value === null ? "Sem fonte" : format(m.value)}{STATUS_SEAL[m.status] && <Badge tone="warn">{STATUS_SEAL[m.status]}</Badge>}</span>;
  const s = d.service, a = d.schedule, er = financial ? d.estimatedReturn : null;
  const rows: [string, ReactNode][] = [
    ["Contatos atendidos", cell(s.contacts.total)], ["Só pelo agente", cell(s.aiOnly)], ["Passadas para a recepção", cell(s.transferred)],
    ["1ª resposta do agente (mediana)", cell(s.agentFirstResponseSeconds, formatSpan)], ["1ª resposta da recepção (mediana)", cell(s.reception.firstResponseSeconds, formatSpan)],
    ["Disponibilidade do agente", cell(s.availabilityPercent, (v) => `${v.toLocaleString("pt-BR")}%`)],
    ["Tempo devolvido", cell(s.time.totalSeconds, formatSpan)], ["Qualificados", cell(a.qualified.total)],
    ["Avaliações agendadas", cell(a.cohort.total.total)], ["Compareceram", cell(a.cohort.attended.total)], ["Faltaram", cell(a.cohort.no_show.total)],
    ["Aguardando consulta", cell(a.cohort.upcoming.total)], ["Comparecimento não verificado", cell(a.cohort.unverified.total)],
    ["Perguntas sem resposta", cell(d.unanswered)], ["Contatos que informaram a cidade", cell(d.leads.withCity)],
  ];
  return <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><CardTitle as="h3" hint="Todos saem do motor: nenhum número é digitado ou recalculado na tela.">Validar os resultados</CardTitle>
        <p className="text-sm text-neutral panel:text-white/60">{fresh ? "Recalculado agora com os dados da tela, ainda não salvos." : "Calculado com a revisão salva. Recalcule depois de mudar expediente, status ou premissas."}</p></div>
      <Button type="button" size="sm" variant="outline" loading={pending} onClick={onRecalculate}><RefreshCw size={14} aria-hidden />Recalcular com os dados da tela</Button>
    </div>
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">{rows.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 border-b border-ink/10 py-1.5 panel:border-white/10"><dt className="text-neutral panel:text-white/60">{label}</dt><dd className="flex items-center gap-2 font-medium">{value}</dd></div>)}</dl>
    <div className="rounded-control border border-ink/10 p-4 panel:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Retorno estimado (bloco opcional)</p><Badge tone={er ? "success" : "neutral"}>{er ? "Aparece no relatório" : "Não aparece"}</Badge></div>
      {!financial ? <p className="mt-2 text-sm text-neutral panel:text-white/60">Desligado na revisão: salve para retirar receita, economia e ROI do painel e do PDF.</p>
        : er ? <p className="mt-2 text-sm text-neutral panel:text-white/60">{formatReais(er.revenueCents)} em tratamentos potenciais + {formatReais(er.savingsCents)} de tempo devolvido − {formatReais(er.investmentCents)} de investimento = {formatReais(er.netCents)} ({er.multiple.toLocaleString("pt-BR")}x). Receita só de quem chegou com a recepção fechada.</p>
        : <><p className="mt-2 text-sm text-neutral panel:text-white/60">Sem estes dados o bloco some do painel e do PDF, sem “pendente” nem zero:</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral panel:text-white/60">{d.estimatedReturnMissing.map((m) => <li key={m}>{m}</li>)}</ul></>}
    </div>
  </section>;
}

/** Etapa 4 (relatório v2): as mudanças do mês, uma por linha, com tipo e data. */
function AgentChangesFields({ value, onChange, disabled }: { value: ReportedAgentChange[]; onChange: (next: ReportedAgentChange[]) => void; disabled: boolean }) {
  const set = (i: number, patch: Partial<ReportedAgentChange>) => onChange(value.map((c, n) => n === i ? { ...c, ...patch } : c));
  return <section className="space-y-3">
    <CardTitle as="h3" hint="O que foi incluído na base, virou regra ou foi corrigido neste mês. Só o que foi feito de fato e conferido: o documento inclui somente linhas com data e finalidade.">Mudanças no agente</CardTitle>
    {value.length === 0 && <p className="text-sm text-neutral panel:text-white/55">Nenhuma mudança detalhada registrada. Texto genérico não vai para o documento do cliente.</p>}
    {value.map((change, i) => <div key={i} className="grid items-end gap-3 rounded-control border border-ink/10 p-3 panel:border-white/10 md:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_9rem_auto]">
      <SelectMenu label={`Tipo da mudança ${i + 1}`} options={AGENT_CHANGE_KINDS.map((kind) => ({ value: kind, label: AGENT_CHANGE_LABELS[kind] }))} value={change.kind} onChange={(kind) => set(i, { kind: kind as AgentChangeKind })} disabled={disabled} />
      <Field label="O que mudou" htmlFor={`roi-change-${i}`}><Input {...fieldProps(`roi-change-${i}`)} maxLength={200} value={change.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="Ex.: Onde estacionar e como chegar a pé do centro." /></Field>
      <Field label="Finalidade" htmlFor={`roi-change-purpose-${i}`}><Input {...fieldProps(`roi-change-purpose-${i}`)} maxLength={200} value={change.purpose ?? ""} onChange={(e) => set(i, { purpose: e.target.value })} placeholder="Ex.: Esclarecer acesso à clínica" /></Field>
      <Field label="Data" htmlFor={`roi-change-date-${i}`}><Input {...fieldProps(`roi-change-date-${i}`)} type="date" value={change.date ?? ""} onChange={(e) => set(i, { date: e.target.value || null })} /></Field>
      <Button type="button" size="icon" variant="ghost" aria-label={`Remover mudança ${i + 1}`} onClick={() => onChange(value.filter((_, n) => n !== i))}><Trash2 size={16} aria-hidden /></Button>
    </div>)}
    <Button type="button" size="sm" variant="outline" disabled={disabled || value.length >= AGENT_CHANGES_MAX} onClick={() => onChange([...value, { kind: "added", text: "", date: null }])}><Plus size={14} aria-hidden />Adicionar mudança</Button>
  </section>;
}
