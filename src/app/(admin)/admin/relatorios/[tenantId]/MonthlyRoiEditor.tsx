"use client";
import { useActionState, useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectMenu } from "@/components/ui/select-menu";
import { Card, CardTitle } from "@/components/ui/card";
import { FormFeedback } from "@/components/ui/alert";
import { TIMEZONES } from "@/modules/scheduling/time";
import type { MonthlyReport } from "@/modules/reports/monthly";
import { saveMonthlyRoi, finalizeMonthlyRoi, reopenMonthlyRoi, recordMonthlyDelivery } from "./actions";

const decimal = (v: number | null, scale = 1) => v === null ? "" : String(v / scale).replace(".", ",");
function readNumber(value: FormDataEntryValue | null, scale = 1): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) throw new Error("Use valores numéricos, sem separador de milhar.");
  const result = Number(text.replace(",", ".")) * scale;
  return scale === 100 ? Math.round(result) : result;
}
function humanHours(form: FormData) {
  if (form.get("hoursConfirmed") !== "on") return null;
  return Array.from({ length: 7 }, (_, i) => {
    const text = String(form.get(`day-${i}`) ?? "").trim();
    if (!text) return [];
    return text.split(",").map((value) => {
      const match = /^\s*(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})\s*$/.exec(value);
      if (!match) throw new Error("Use HH:mm-HH:mm, separando intervalos com vírgula.");
      const [, ah, am, bh, bm] = match.map(Number);
      if (ah > 23 || am > 59 || bh > 24 || bm > 59 || (bh === 24 && bm !== 0)) throw new Error("Revise as horas do expediente.");
      return { start: ah * 60 + am, end: bh * 60 + bm };
    });
  });
}
export function MonthlyRoiEditor({ tenantId, report: r }: { tenantId: string; report: MonthlyReport }) {
  const c = r.assumptions;
  const [timezone, setTimezone] = useState(c.timezone);
  const [procedures, setProcedures] = useState(c.procedures.map((p) => p.name));
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ ok: boolean; error?: string; info?: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, start] = useTransition();
  const [state, submit, saving] = useActionState(saveMonthlyRoi.bind(null, tenantId, r.month), null);
  const locked = r.status === "ready";
  const pending = busy || saving;
  const time = (v: number) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  const act = (fn: () => Promise<{ ok: boolean; error?: string; info?: string }>) => start(async () => {
    try { setActionFeedback(await fn()); } catch { setActionFeedback({ ok: false, error: "Não foi possível salvar. Tente novamente." }); }
  });
  return <Card>
    <CardTitle>Revisão mensal · Mavellium</CardTitle>
    <p className="mb-4 text-sm text-neutral panel:text-white/55">Preencha os números levantados com a clínica (P-78). Campos vazios ficam pendentes. O fechamento congela esta competência; o envio e a reunião são registrados depois que acontecerem.</p>
    {r.assumptionsFromMonth && <p className="mb-4 text-sm text-warn">Premissas copiadas de {r.assumptionsFromMonth} para facilitar a preparação. Confira e salve a revisão deste mês antes de fechar.</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        const assumptions = { timezone, humanHours: humanHours(form),
          attendantMonthlyCents: readNumber(form.get("attendantMonthlyCents"), 100),
          attendantMonthlyHours: readNumber(form.get("attendantMonthlyHours")),
          minutesPerConversation: readNumber(form.get("minutesPerConversation")),
          investmentCents: readNumber(form.get("investmentCents"), 100),
          procedureVariable: String(form.get("procedureVariable") ?? ""),
          evaluationTypes: String(form.get("evaluationTypes") ?? "").split("\n").map((v) => v.trim()).filter(Boolean),
          countUntypedAsEvaluations: form.get("countUntypedAsEvaluations") === "on",
          completedStatusTypes: form.getAll("completedStatusTypes").map(String),
          procedures: procedures.map((_, i) => ({ name: String(form.get(`procedure-${i}`) ?? ""),
            ticketCents: readNumber(form.get(`ticket-${i}`), 100), conversionBps: readNumber(form.get(`conversion-${i}`), 100) })),
        };
        form.set("assumptions", JSON.stringify(assumptions));
        setError(null);
        start(() => submit(form));
      } catch (err) { setError(err instanceof Error ? err.message : "Revise os campos."); }
    }} className="space-y-5">
      <fieldset disabled={locked || pending} className="space-y-5 disabled:opacity-65">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Mensalidade / investimento (R$)<Input name="investmentCents" inputMode="decimal" defaultValue={decimal(c.investmentCents, 100)} /></label>
          <label className="text-sm">Custo mensal do atendente (R$)<Input name="attendantMonthlyCents" inputMode="decimal" defaultValue={decimal(c.attendantMonthlyCents, 100)} /></label>
          <label className="text-sm">Carga mensal do atendente (horas)<Input name="attendantMonthlyHours" inputMode="decimal" defaultValue={decimal(c.attendantMonthlyHours)} /></label>
          <label className="text-sm">Minutos humanos por conversa (estimativa)<Input name="minutesPerConversation" inputMode="decimal" defaultValue={decimal(c.minutesPerConversation)} /></label>
        </div>
        <div className="max-w-sm"><p id="monthly-zone" className="mb-1 text-sm">Fuso da clínica</p><SelectMenu label="Fuso da clínica" labelledBy="monthly-zone" options={TIMEZONES} value={timezone} onChange={setTimezone} disabled={locked || pending} /></div>
        <div><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hoursConfirmed" defaultChecked={c.humanHours !== null} />Horário humano levantado e conferido</label>
          <p className="my-2 text-xs text-neutral panel:text-white/55">Ex.: 08:00-12:00,13:00-18:00. Dia vazio = fechado, quando o horário está conferido. Use o expediente do atendente, que pode ser diferente da agenda de consultas.</p>
          <div className="grid gap-3 sm:grid-cols-4">{["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((day, i) => <label key={day} className="text-sm">{day}<Input name={`day-${i}`} defaultValue={c.humanHours?.[i].map((h) => `${time(h.start)}-${time(h.end)}`).join(",") ?? ""} placeholder="Fechado" /></label>)}</div>
        </div>
        <div><p className="mb-2 text-sm font-medium">Ticket e conversão avaliação → tratamento por procedimento</p>
          <div className="space-y-3">{procedures.map((_, i) => <div key={i} className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs">Procedimento<Input name={`procedure-${i}`} maxLength={60} defaultValue={c.procedures[i]?.name ?? ""} required /></label>
            <label className="text-xs">Ticket médio (R$)<Input name={`ticket-${i}`} inputMode="decimal" defaultValue={decimal(c.procedures[i]?.ticketCents ?? null, 100)} /></label>
            <label className="text-xs">Conversão (%)<Input name={`conversion-${i}`} inputMode="decimal" defaultValue={decimal(c.procedures[i]?.conversionBps ?? null, 100)} /></label>
          </div>)}</div>
          <div className="mt-3 flex gap-2"><Button type="button" size="sm" variant="outline" disabled={procedures.length >= 12} onClick={() => setProcedures([...procedures, ""])}>Adicionar procedimento</Button>{procedures.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setProcedures(procedures.slice(0, -1))}>Remover último</Button>}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Variável da conversa com o procedimento<Input name="procedureVariable" maxLength={60} defaultValue={c.procedureVariable} /><span className="text-xs text-neutral panel:text-white/55">Nome da chave em Agentes → Variáveis. Os valores precisam corresponder aos procedimentos acima.</span></label>
          <label className="text-sm">Tipos de atendimento que são avaliações<Textarea name="evaluationTypes" defaultValue={c.evaluationTypes.join("\n")} /><span className="text-xs text-neutral panel:text-white/55">Um nome exato por linha, conforme a ação Agendar horário.</span></label>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="countUntypedAsEvaluations" defaultChecked={c.countUntypedAsEvaluations} />Conferi que os agendamentos antigos sem tipo, criados pelo agente, são avaliações. Essa confirmação vale só para esta competência.</label>
        <div><p className="mb-2 text-sm font-medium">Status do Clinicorp que comprovam avaliação realizada</p>
          <p className="mb-2 text-xs text-neutral panel:text-white/55">Selecione após conferir com a clínica. “Confirmado” e “agendado” não comprovam comparecimento.</p>
          {[...new Map([...c.completedStatusTypes.map((type) => ({ type, description: `${type} (salvo)` })), ...r.clinicorpStatusTypes].map((s) => [s.type, s])).values()].map((s) => <label key={s.type} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" name="completedStatusTypes" value={s.type} disabled={s.type.toUpperCase() === "CONFIRMED"} defaultChecked={c.completedStatusTypes.includes(s.type)} />{s.description} · {s.type}</label>)}
          {r.clinicorpStatusTypes.length === 0 && <p className="text-sm text-warn">Conecte o Clinicorp para conferir os status. Sem integração, apenas consultas marcadas como realizadas na agenda local comprovam comparecimento.</p>}
        </div>
        <label className="block text-sm">Decisor que recebe o relatório<Input name="decisionMaker" maxLength={100} defaultValue={r.decisionMaker} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">O que ajustamos no agente (até 400 caracteres)<Textarea name="adjustments" maxLength={400} defaultValue={r.adjustments} /></label>
          <label className="text-sm">Próximo mês (até 400 caracteres)<Textarea name="nextMonth" maxLength={400} defaultValue={r.nextMonth} /></label>
        </div>
        <Button type="submit" loading={saving}>Salvar revisão deste mês</Button>
      </fieldset>
      <FormFeedback error={error ?? state?.error} info={state?.info} />
    </form>
    <div className="mt-6 space-y-3 border-t border-ink/10 pt-5 panel:border-white/10">
      {!locked && !r.current.trackingComplete && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />Revisei o aviso de cobertura parcial: os eventos históricos ausentes serão apresentados como não medidos.</label>}
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={`/admin/relatorios/${tenantId}/pdf?mes=${r.month}`} variant="outline">Exportar PDF de 1 página{locked ? "" : " · rascunho"}</ButtonLink>
        {!locked ? <Button loading={busy} disabled={pending || r.partial} onClick={() => act(() => finalizeMonthlyRoi(tenantId, r.month, acknowledged))}>Fechar para entrega</Button>
          : <><Button disabled={pending || Boolean(r.sentAt)} loading={busy} onClick={() => act(() => recordMonthlyDelivery(tenantId, r.month, "sent"))}>{r.sentAt ? "Envio registrado" : "Já enviei ao decisor"}</Button><Button variant="outline" disabled={pending || !r.sentAt || Boolean(r.meetingAt)} onClick={() => act(() => recordMonthlyDelivery(tenantId, r.month, "meeting"))}>{r.meetingAt ? "Reunião registrada" : "Reunião realizada"}</Button>{!r.sentAt && <Button variant="ghost" disabled={pending} onClick={() => act(() => reopenMonthlyRoi(tenantId, r.month))}>Reabrir revisão</Button>}</>}
      </div>
      <FormFeedback error={actionFeedback?.error} info={actionFeedback?.info} />
      <p className="text-xs text-neutral panel:text-white/55">O envio é feito pela Mavellium com o PDF exportado. Estes botões registram a entrega e a apresentação; não enviam mensagens automaticamente.</p>
    </div>
  </Card>;
}
