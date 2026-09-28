"use client";
import { startTransition, useActionState, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Download, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
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
import { TIMEZONES } from "@/modules/scheduling/time";
import { minuteLabel } from "@/modules/scheduling/weekly-availability";
import type { MonthlyReport } from "@/modules/reports/monthly";
import { monthlyOverridesSchema } from "@/modules/reports/monthly-overrides";
import { MonthlyMetricFields } from "./MonthlyMetricFields";
import { MonthlyAgentImport } from "./MonthlyAgentImport";
import { MonthlyClinicorpStatus } from "./MonthlyClinicorpStatus";
import { MonthlyRoiAiAssistant } from "./MonthlyRoiAiAssistant";
import { monthlyAiDraftSchema, applyMonthlyAiChanges, type MonthlyAiDraft, type MonthlyAiChange } from "@/modules/reports/monthly-ai";
import { monthlyScheduleSuggestion, type MonthlyImportSources } from "@/modules/reports/monthly-import";
import { saveMonthlyRoi, finalizeMonthlyRoi, reopenMonthlyRoi, recordMonthlyDelivery, previewMonthlyRoiImport } from "./actions";

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

export function MonthlyRoiEditor({ tenantId, report: r, sources }: { tenantId: string; report: MonthlyReport; sources: MonthlyImportSources }) {
  const [defaults, setDefaults] = useState<MonthlyAiDraft>({ assumptions: r.assumptions, metricOverrides: r.metricOverrides ?? { current: {}, previous: {} }, adjustments: r.adjustments, nextMonth: r.nextMonth, decisionMaker: r.decisionMaker });
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
  const [open, setOpen] = useState(true);
  const [metricOverrides, setMetricOverrides] = useState(r.metricOverrides ?? { current: {}, previous: {} });
  const [timezone, setTimezone] = useState(c.humanHours ? c.timezone : suggested.timezone ?? c.timezone);
  const [hoursConfirmed, setHoursConfirmed] = useState(c.humanHours !== null);
  const [hours, setHours] = useState<HourRange[][]>(() => Array.from({ length: 7 }, (_, day) => (c.humanHours ?? suggested.hours)?.[day].map((h) => ({ start: minuteLabel(h.start), end: minuteLabel(h.end) })) ?? []));
  const [procedures, setProcedures] = useState(() => c.procedures.map((p, id) => ({ ...p, id })));
  const nextId = useRef(procedures.length);
  const [untyped, setUntyped] = useState(c.countUntypedAsEvaluations);
  const [statuses, setStatuses] = useState(c.completedStatusTypes);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ ok: boolean; error?: string; info?: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, start] = useTransition();
  const [state, submit, saving] = useActionState(saveMonthlyRoi.bind(null, tenantId, r.month), null);
  const confirmNavigation = useUnsavedNavigation();
  const locked = r.status === "ready";
  const pending = busy || saving;
  const act = (fn: () => Promise<{ ok: boolean; error?: string; info?: string }>) => start(async () => {
    try { setActionFeedback(await fn()); } catch { setActionFeedback({ ok: false, error: "Não foi possível salvar. Tente novamente." }); }
  });
  const moneyField = (name: string, label: string, value: number | null) => <Field label={label} htmlFor={`roi-${name}`}><CurrencyInput key={name === "investmentCents" ? `${name}:${importedInvestment}` : name} {...fieldProps(`roi-${name}`)} name={name} defaultValueCents={name === "investmentCents" ? importedInvestment ?? value : value} placeholder="Não informado" /></Field>;
  const numberField = (name: string, label: string, value: number | null, hint?: string) => <Field label={label} htmlFor={`roi-${name}`} hint={hint}><Input {...fieldProps(`roi-${name}`, { hint: Boolean(hint) })} name={name} inputMode="decimal" defaultValue={decimal(value)} placeholder="Não informado" /></Field>;
  const readAssumptions = (form: FormData) => ({
    agentIds, timezone, humanHours: hoursConfirmed ? hours.map((day) => day.map((h) => ({ start: readTime(h.start), end: readTime(h.end) }))) : null,
    attendantMonthlyCents: readNumber(form.get("attendantMonthlyCents"), 100, true), attendantMonthlyHours: readNumber(form.get("attendantMonthlyHours")),
    minutesPerConversation: readNumber(form.get("minutesPerConversation")), investmentCents: readNumber(form.get("investmentCents"), 100, true),
    procedureVariable: String(form.get("procedureVariable") ?? ""), evaluationTypes: String(form.get("evaluationTypes") ?? "").split("\n").map((v) => v.trim()).filter(Boolean),
    countUntypedAsEvaluations: untyped, completedStatusTypes: statuses,
    procedures: procedures.map((p) => ({ name: String(form.get(`procedure-${p.id}`) ?? ""), ticketCents: readNumber(form.get(`ticket-${p.id}`), 100, true), conversionBps: readNumber(form.get(`conversion-${p.id}`), 100) })),
  });
  const getAiDraft = (): MonthlyAiDraft => {
    if (!formRef.current) throw new Error("Abra a edição do relatório primeiro.");
    const form = new FormData(formRef.current);
    const assumptions = readAssumptions(form);
    assumptions.procedures = assumptions.procedures.filter((p) => p.name.trim() || p.ticketCents !== null || p.conversionBps !== null);
    return monthlyAiDraftSchema.parse({ assumptions, metricOverrides,
      adjustments: String(form.get("adjustments") ?? ""), nextMonth: String(form.get("nextMonth") ?? ""), decisionMaker: String(form.get("decisionMaker") ?? "") });
  };
  const applyAi = (basis: MonthlyAiDraft, changes: MonthlyAiChange[]) => {
    const current = getAiDraft();
    if (JSON.stringify(current) !== JSON.stringify(basis)) throw new Error("A revisão mudou desde esta resposta. Envie uma nova pergunta para usar os dados atuais.");
    const next = applyMonthlyAiChanges(current, changes);
    setDefaults(next); setImportedInvestment(null); setMetricOverrides(next.metricOverrides);
    setTimezone(next.assumptions.timezone);
    if (changes.some((change) => change.field === "assumptions.humanHours")) {
      setHoursConfirmed(false); setHoursOrigin("sugestão da IA");
      setHours(Array.from({ length: 7 }, (_, day) => next.assumptions.humanHours?.[day].map((h) => ({ start: minuteLabel(h.start), end: minuteLabel(h.end) })) ?? []));
    }
    setProcedures(next.assumptions.procedures.map((p) => ({ ...p, id: nextId.current++ })));
    setImportVersion((v) => v + 1); setFormVersion((v) => v + 1); setOpen(true);
    setImportInfo("Campos preenchidos com a ajuda da IA. Confira os valores e os horários antes de salvar a revisão.");
  };
  const importData = () => start(async () => {
    if (!formRef.current) return;
    try {
      const form = new FormData(formRef.current);
      form.set("assumptions", JSON.stringify(readAssumptions(form)));
      const result = await previewMonthlyRoiImport(tenantId, r.month, form);
      if (!result.ok) { setError(result.error); return; }
      setLoaded(result.report); setImportVersion((v) => v + 1); setError(null);
      if (!String(form.get("investmentCents") ?? "").trim()) setImportedInvestment(sources.priceCents);
      if (!hoursConfirmed && suggested.hours) {
        setHours(suggested.hours.map((day) => day.map((h) => ({ start: minuteLabel(h.start), end: minuteLabel(h.end) }))));
        setTimezone(suggested.timezone!); setHoursOrigin(suggested.names.join(", "));
      }
      setImportInfo(`Dados carregados para ${agentIds.length ? result.report.agentNames?.join(", ") : "todos os agentes"}. Ajustes manuais mantidos; confira e salve a revisão.${suggested.warning ? ` ${suggested.warning}` : ""}`);
    } catch { setError("Não foi possível importar. Confira os campos e tente novamente."); }
  });

  return <Card className="text-ink panel:text-white/85">
    <CardTitle action={<Badge tone={locked ? "success" : "neutral"}>{locked ? "Fechado" : "Rascunho"}</Badge>}>Preparação e entrega</CardTitle>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-xl text-sm text-neutral panel:text-white/60"><p>{locked ? `Relatório disponível para a clínica${r.decisionMaker ? ` · decisor: ${r.decisionMaker}` : ""}.` : "Os indicadores e as premissas desta competência já estão carregados. Confira os dados e registre os ajustes antes de fechar."}</p><p className="mt-1">Prazo de entrega: {new Intl.DateTimeFormat("pt-BR", { timeZone: c.timezone }).format(new Date(r.dueAt))}.</p></div>
      {!locked && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending} onClick={() => { setOpen(true); setAiOpen(true); }}><Sparkles size={15} aria-hidden />Fazer com I.A</Button><Button variant="outline" disabled={pending} aria-expanded={open} aria-controls="roi-edit-form" onClick={() => setOpen(!open)}><Pencil size={15} aria-hidden />{open ? "Recolher edição" : "Editar dados e revisão"}<ChevronDown size={15} aria-hidden className={open ? "rotate-180" : ""} /></Button></div>}
    </div>
    {!locked && <UnsavedForm ref={formRef} id="roi-edit-form" hidden={!open} result={state} label="Revisão do relatório mensal" className="mt-6 space-y-6 border-t border-ink/10 pt-6 panel:border-white/10" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        if (!monthlyOverridesSchema.safeParse(metricOverrides).success) throw new Error("Revise os indicadores: contagens devem ser inteiras e positivas ou zero; tempos podem ter decimais.");
        const assumptions = readAssumptions(form);
        form.set("assumptions", JSON.stringify(assumptions)); setError(null); startTransition(() => submit(form));
      } catch (err) { setError(err instanceof Error ? err.message : "Revise os campos."); }
    }}>
      {r.assumptionsFromMonth && <Alert>Premissas trazidas de {r.assumptionsFromMonth.split("-").reverse().join("/")}. Confira os valores e salve a revisão deste mês.</Alert>}
      <input type="hidden" name="revision" value={r.revision ?? ""} />
      <fieldset key={formVersion} disabled={pending} className="min-w-0 space-y-8">
        <MonthlyAgentImport sources={sources} agentIds={agentIds} onChange={setAgentIds} onImport={importData} pending={pending} />
        {importInfo && <Alert>{importInfo}</Alert>}
        <MonthlyMetricFields key={importVersion} report={loaded} value={metricOverrides} onChange={setMetricOverrides} />
        <section className="space-y-4"><CardTitle as="h3" hint="Campos vazios ficam pendentes até serem levantados com a clínica.">Investimento e equipe</CardTitle><div className="grid items-end gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {moneyField("investmentCents", "Mensalidade do Fechai (R$)", c.investmentCents)}{moneyField("attendantMonthlyCents", "Custo mensal do atendente (R$)", c.attendantMonthlyCents)}
          {numberField("attendantMonthlyHours", "Carga mensal do atendente (h)", c.attendantMonthlyHours)}{numberField("minutesPerConversation", "Tempo humano por conversa (min)", c.minutesPerConversation, "Estimativa usada para calcular a economia.")}
        </div>{r.investmentSource && <p className="text-xs text-neutral panel:text-white/55">Mensalidade carregada de: {r.investmentSource}. Confira o valor cobrado nesta competência antes de salvar.</p>}</section>
        <section className="space-y-4 border-t border-ink/10 pt-6 panel:border-white/10">
          <CardTitle as="h3" hint="A receita considera somente contatos cuja primeira mensagem chegou fora deste expediente.">Horário de atendimento humano</CardTitle>
          <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><Switch checked={hoursConfirmed} onCheckedChange={setHoursConfirmed} disabled={pending} label="Horário humano conferido com a clínica" /><span className="text-sm">Horário conferido com a clínica</span></div><div className="w-full sm:w-64"><SelectMenu label="Fuso da clínica" options={TIMEZONES} value={timezone} onChange={setTimezone} disabled={pending} /></div></div>
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
        </section>
        <section className="space-y-4 border-t border-ink/10 pt-6 panel:border-white/10"><CardTitle as="h3" hint="Conversão é a porcentagem das avaliações que viram tratamento.">Ticket e conversão por procedimento</CardTitle>
          {procedures.length === 0 && <p className="text-sm text-neutral panel:text-white/55">Adicione os procedimentos para estimar a receita.</p>}
          <div className="space-y-4">{procedures.map((p) => <div key={p.id} className="grid items-end gap-4 rounded-control border border-ink/10 p-4 panel:border-white/10 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Field label="Procedimento" htmlFor={`procedure-${p.id}`}><Input {...fieldProps(`procedure-${p.id}`)} name={`procedure-${p.id}`} maxLength={60} defaultValue={p.name} required placeholder="Ex.: Implante" /></Field>
            {moneyField(`ticket-${p.id}`, "Ticket médio (R$)", p.ticketCents)}<Field label="Conversão (%)" htmlFor={`conversion-${p.id}`}><Input {...fieldProps(`conversion-${p.id}`)} name={`conversion-${p.id}`} inputMode="decimal" defaultValue={decimal(p.conversionBps, 100)} placeholder="Ex.: 30" /></Field>
            <Button type="button" size="icon" variant="ghost" aria-label={`Remover procedimento ${p.name || "sem nome"}`} onClick={() => setProcedures(procedures.filter((v) => v.id !== p.id))}><Trash2 size={16} aria-hidden /></Button>
          </div>)}</div>
          <Button type="button" size="sm" variant="outline" disabled={procedures.length >= 12} onClick={() => setProcedures([...procedures, { id: nextId.current++, name: "", ticketCents: null, conversionBps: null }])}><Plus size={14} aria-hidden />Adicionar procedimento</Button>
        </section>
        <section className="space-y-4 border-t border-ink/10 pt-6 panel:border-white/10"><CardTitle as="h3">Revisão para o decisor</CardTitle>
          <Field label="Nome do decisor" htmlFor="roi-decisionMaker"><Input {...fieldProps("roi-decisionMaker")} name="decisionMaker" maxLength={100} defaultValue={defaults.decisionMaker} placeholder="Quem recebe e acompanha o resultado" /></Field>
          <div className="grid gap-5 lg:grid-cols-2"><Field label="O que ajustamos no agente" htmlFor="roi-adjustments" hint="Até 400 caracteres. Cite os ajustes feitos neste mês."><Textarea {...fieldProps("roi-adjustments", { hint: true })} name="adjustments" maxLength={400} defaultValue={defaults.adjustments} rows={4} /></Field><Field label="Próximo mês" htmlFor="roi-nextMonth" hint="Até 400 caracteres. Descreva as próximas ações."><Textarea {...fieldProps("roi-nextMonth", { hint: true })} name="nextMonth" maxLength={400} defaultValue={defaults.nextMonth} rows={4} /></Field></div>
        </section>
        <details className="rounded-control border border-ink/10 p-4 panel:border-white/10"><summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-iris">Critérios de classificação e Clinicorp</summary><div className="mt-5 space-y-5">
          <div className="grid gap-5 lg:grid-cols-2"><Field label="Variável que identifica o procedimento" htmlFor="roi-procedureVariable" hint="Use o nome configurado em Agentes → Variáveis."><Input {...fieldProps("roi-procedureVariable", { hint: true })} name="procedureVariable" maxLength={60} defaultValue={c.procedureVariable} /></Field><Field label="Tipos de atendimento considerados avaliações" htmlFor="roi-evaluationTypes" hint="Um nome por linha, conforme o agendamento do agente."><Textarea {...fieldProps("roi-evaluationTypes", { hint: true })} name="evaluationTypes" defaultValue={c.evaluationTypes.join("\n")} /></Field></div>
          <div className="flex items-start gap-3"><Switch label="Agendamentos antigos sem tipo conferidos como avaliações" checked={untyped} onCheckedChange={setUntyped} disabled={pending} /><p className="text-sm">Conferi que as marcações antigas do agente sem tipo são avaliações.</p></div><input type="hidden" name="untypedConfirmed" value={String(untyped)} />
          <div><p className="text-sm font-medium">Status que comprovam comparecimento no Clinicorp</p><p className="mt-1 text-sm text-neutral panel:text-white/55">Confira com a clínica. Confirmado e agendado não comprovam presença.</p></div>
          <MonthlyClinicorpStatus report={loaded} />
          {[...new Map([...c.completedStatusTypes.map((type) => ({ type, description: type })), ...loaded.clinicorpStatusTypes].map((s) => [s.type, s])).values()].map((s) => <div key={s.type} className="flex items-center gap-3"><Switch label={`Comparecimento: ${s.description}`} disabled={pending || s.type.toUpperCase() === "CONFIRMED"} checked={statuses.includes(s.type)} onCheckedChange={(checked) => setStatuses(checked ? [...statuses, s.type] : statuses.filter((type) => type !== s.type))} /><span className="text-sm">{s.description}</span></div>)}<input type="hidden" name="completedStatusTypes" value={JSON.stringify(statuses)} />
        </div></details>
        <Button type="submit" loading={saving}><Check size={15} aria-hidden />Salvar revisão</Button>
      </fieldset><FormFeedback error={error ?? state?.error} info={state?.info} />
    </UnsavedForm>}
    <div className="mt-5 space-y-4 border-t border-ink/10 pt-5 panel:border-white/10">
      {!locked && !r.current.trackingComplete && <div className="flex items-start gap-3"><Switch checked={acknowledged} onCheckedChange={setAcknowledged} disabled={pending} label="Cobertura parcial revisada" /><p className="text-sm text-neutral panel:text-white/65">Revisei a cobertura parcial. Os eventos históricos ausentes aparecerão como não medidos.</p></div>}
      <div className="flex flex-wrap items-center gap-3"><ButtonLink href={`/admin/relatorios/${tenantId}/pdf?mes=${r.month}`} variant="outline" size="sm"><Download size={14} aria-hidden />PDF de 1 página{locked ? "" : " · rascunho"}</ButtonLink>
        {!locked ? <Button size="sm" loading={busy} disabled={pending || r.partial} onClick={() => confirmNavigation(() => act(() => finalizeMonthlyRoi(tenantId, r.month, acknowledged)))}>Fechar para entrega</Button> : <>
          <Button size="sm" disabled={pending || Boolean(r.sentAt)} loading={busy} onClick={() => act(() => recordMonthlyDelivery(tenantId, r.month, "sent"))}>{r.sentAt ? "Envio registrado" : "Registrar envio ao decisor"}</Button><Button size="sm" variant="outline" disabled={pending || !r.sentAt || Boolean(r.meetingAt)} onClick={() => act(() => recordMonthlyDelivery(tenantId, r.month, "meeting"))}>{r.meetingAt ? "Reunião registrada" : "Registrar reunião"}</Button>{!r.sentAt && <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => reopenMonthlyRoi(tenantId, r.month))}>Reabrir revisão</Button>}
        </>}
      </div>{r.partial && !locked && <p className="text-xs text-neutral panel:text-white/55">O fechamento fica disponível após o fim do mês.</p>}<FormFeedback error={actionFeedback?.error} info={actionFeedback?.info} /><p className="text-xs text-neutral panel:text-white/55">A Mavellium envia o PDF e apresenta os resultados. Registre o envio e a reunião após acontecerem.</p>
    </div>
    {!locked && <MonthlyRoiAiAssistant open={aiOpen} onClose={() => setAiOpen(false)} tenantId={tenantId} month={r.month} getDraft={getAiDraft} onApply={applyAi} />}
  </Card>;
}
