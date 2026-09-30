"use client";
import { useActionState, useState } from "react";
import { Mail, MessageCircle, Send } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldProps } from "@/components/ui/field";
import { useActionToast, useSaveFeedback } from "@/components/ui/toast";
import {
  buildPendencyRequest, requestableRows, whatsappNumber, PENDENCY_ANSWER_MAX, PENDENCY_ASSIGNEE_MAX,
  PENDENCY_OWNERS, PENDENCY_STATUS_LABELS, type PendencyOwner, type PendencyRow, type PendencyStatus,
} from "@/modules/reports/monthly-pendencies";
import { saveMonthlyPendency, recordMonthlyPendencyRequest } from "./pendency-actions";

type Contact = { name: string | null; email: string | null; phone: string | null };
type Via = "whatsapp" | "email" | "copy";
const VIA_LABELS: Record<Via, string> = { whatsapp: "WhatsApp", email: "e-mail", copy: "texto copiado" };
const STATUS_TONE: Record<PendencyStatus, "success" | "iris" | "neutral" | "warn"> = {
  confirmed: "success", answered: "iris", requested: "neutral", data: "warn", confirm: "warn", check: "warn",
};

/**
 * Central de pendências do fechamento: o que falta, de quem, o que cada falta
 * afeta e uma solicitação só para a clínica. Registrar aqui não muda número:
 * a resposta é aplicada na revisão, que recalcula ao salvar.
 */
export function MonthlyPendencyCenter({ tenantId, month, clinicName, monthLabel, dueAt, now, timezone, rows, contact }: {
  tenantId: string; month: string; clinicName: string; monthLabel: string; dueAt: string;
  /** Do servidor: prazo e texto da solicitação não mudam entre render e hidratação. */
  now: string; timezone: string; rows: PendencyRow[]; contact: Contact;
}) {
  const due = new Date(dueAt);
  const format = (at: string, withTime = false) => new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(new Date(at));
  const pending = rows.filter((r) => r.status !== "confirmed");
  const answered = rows.filter((r) => r.status === "answered").length;
  const daysLeft = Math.ceil((due.getTime() - new Date(now).getTime()) / 86_400_000);
  const owners = (Object.keys(PENDENCY_OWNERS) as PendencyOwner[]).map((owner) => ({ owner, items: rows.filter((r) => r.owner === owner) })).filter((g) => g.items.length);

  return <Card className="text-ink panel:text-white/85" aria-labelledby="pendency-center-title">
    <CardTitle hintLabel="Central de pendências" hint="Calculada a partir da revisão salva: o que falta, de quem, e quais números cada falta segura. Registrar uma resposta não muda o relatório; aplique o dado na revisão e salve para recalcular.">
      <span id="pendency-center-title">Central de pendências</span>
    </CardTitle>
    <p className="-mt-2 mb-5 text-sm text-neutral panel:text-white/60">Fechamento de {monthLabel} · {clinicName}</p>
    <div className="grid gap-4 sm:grid-cols-3">
      <Stat compact label="Confirmado" value={String(rows.length - pending.length)} hint={`de ${rows.length} áreas`} />
      <Stat compact label="Áreas pendentes" value={String(pending.length)} hint={answered ? `${answered} com resposta a aplicar` : pending.length ? "travam o fechamento" : "pronto para fechar"} />
      <Stat compact label="Prazo de entrega" value={format(dueAt)} hint={daysLeft < 0 ? "prazo vencido" : daysLeft === 0 ? "vence hoje" : `faltam ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"}`} />
    </div>
    <div className="mt-6 space-y-6">
      {owners.map(({ owner, items }) => {
        const open = items.filter((r) => r.status !== "confirmed").length;
        return <section key={owner} aria-labelledby={`pendency-owner-${owner}`}>
          <h3 id={`pendency-owner-${owner}`} className="font-mono text-micro uppercase tracking-[0.2em] text-neutral panel:text-white/55">
            {PENDENCY_OWNERS[owner]} · {open ? `${open} ${open === 1 ? "pendente" : "pendentes"}` : "em dia"}
          </h3>
          <ul className="mt-2 divide-y divide-ink/10 border-t border-ink/10 panel:divide-white/10 panel:border-white/10">
            {items.map((row) => <PendencyItem key={row.topic} tenantId={tenantId} month={month} row={row} format={format} />)}
          </ul>
        </section>;
      })}
    </div>
    <PendencyRequest tenantId={tenantId} month={month} clinicName={clinicName} monthLabel={monthLabel} due={due} now={new Date(now)} timezone={timezone} rows={rows} contact={contact} />
  </Card>;
}

function PendencyItem({ tenantId, month, row, format }: { tenantId: string; month: string; row: PendencyRow; format: (at: string, withTime?: boolean) => string }) {
  const [state, submit, saving] = useActionState(saveMonthlyPendency.bind(null, tenantId, month, row.topic), null);
  useActionToast(state, saving, { entity: "pendência", gender: "f" });
  const open = row.status !== "confirmed";
  const id = `pendency-${row.topic}`;
  return <li className="py-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-medium text-ink panel:text-white">{row.title}</p>
        <p className="mt-0.5 text-sm text-neutral panel:text-white/60">Responsável: {row.ownerLabel}{row.assignee ? ` · ${row.assignee}` : ""}</p>
      </div>
      <Badge tone={STATUS_TONE[row.status]}>{PENDENCY_STATUS_LABELS[row.status]}</Badge>
    </div>
    {open && <>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-sm">{row.details.map((d) => <li key={d}>{d}</li>)}</ul>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral panel:text-white/55">Afeta:{row.affects.map((a) => <Badge key={a} tone="neutral">{a}</Badge>)}</p>
    </>}
    {(row.requestedAt || row.answeredAt) && <p className="mt-2 text-xs text-neutral panel:text-white/55">
      {row.requestedAt && `Solicitado em ${format(row.requestedAt, true)}${row.requestedVia ? ` · ${VIA_LABELS[row.requestedVia as Via] ?? row.requestedVia}` : ""}`}
      {row.requestedAt && row.answeredAt && " · "}
      {row.answeredAt && `Resposta registrada em ${format(row.answeredAt, true)}`}
    </p>}
    {row.answer && !open && <p className="mt-2 whitespace-pre-wrap border-l-2 border-ink/15 pl-3 text-sm text-neutral panel:border-white/20 panel:text-white/65">{row.answer}</p>}
    {open && <details className="group mt-3" open={row.status === "answered" || undefined}>
      <summary className="cursor-pointer rounded-sm text-sm font-medium text-iris outline-none focus-visible:ring-2 focus-visible:ring-iris panel:text-white/80">
        {row.status === "answered" ? "Ver resposta registrada" : row.askedFromClinic ? "Atribuir e registrar resposta" : "Atribuir e anotar"}
      </summary>
      <form action={submit} className="mt-4 space-y-4">
        <Field label={row.askedFromClinic ? "Quem responde na clínica" : "Quem cuida na Mavellium"} htmlFor={`${id}-assignee`} optional hint={row.askedFromClinic ? `Vazio, a solicitação vai para a área (${row.ownerLabel}).` : undefined}>
          <Input {...fieldProps(`${id}-assignee`, { hint: row.askedFromClinic })} name="assignee" maxLength={PENDENCY_ASSIGNEE_MAX} defaultValue={row.assignee} placeholder={row.askedFromClinic ? "Ex.: Ana, da recepção" : "Ex.: Marcio"} />
        </Field>
        <Field label={row.askedFromClinic ? "Resposta da clínica" : "Anotação"} htmlFor={`${id}-answer`} optional hint="Registrar não muda o relatório: aplique o dado na revisão abaixo e salve para recalcular.">
          <Textarea {...fieldProps(`${id}-answer`, { hint: true })} name="answer" maxLength={PENDENCY_ANSWER_MAX} defaultValue={row.answer} rows={3} />
        </Field>
        <Button type="submit" size="sm" variant="outline" loading={saving}>Salvar pendência</Button>
      </form>
    </details>}
  </li>;
}

function PendencyRequest({ tenantId, month, clinicName, monthLabel, due, now, timezone, rows, contact }: {
  tenantId: string; month: string; clinicName: string; monthLabel: string; due: Date; now: Date; timezone: string; rows: PendencyRow[]; contact: Contact;
}) {
  const [via, setVia] = useState<Via | null>(null);
  const save = useSaveFeedback({ entity: "solicitação", gender: "f" });
  const requestable = requestableRows(rows);
  const pending = rows.filter((r) => r.status !== "confirmed");
  const base = { rows, clinicName, contactName: contact.name, monthLabel, dueAt: due, now, timezone };
  const text = buildPendencyRequest({ ...base, format: "whatsapp" });
  const phone = whatsappNumber(contact.phone);
  const subject = `Relatório de ${monthLabel}: informações pendentes`;
  const link = buttonVariants({ variant: "outline", size: "sm" });

  return <section aria-labelledby="pendency-request-title" className="mt-6 border-t border-ink/10 pt-6 panel:border-white/10">
    <CardTitle as="h3" hintLabel="Solicitação consolidada" hint="Uma mensagem só, agrupada por área, com o que falta de cada uma. Não leva nome nem telefone de paciente. Nada é enviado sozinho: abra no WhatsApp ou no e-mail, envie e registre o envio.">
      <span id="pendency-request-title">Solicitação consolidada para a clínica</span>
    </CardTitle>
    {!pending.length ? <Alert tone="success">Tudo confirmado. A revisão pode ser fechada para entrega.</Alert>
      : !requestable.length ? <Alert>Nada a pedir à clínica: o que falta é da Mavellium ({pending.map((r) => r.title).join(", ")}).</Alert>
      : <>
        <p className="mb-3 text-sm text-neutral panel:text-white/60">
          Para: {contact.name || "responsável da conta"}{contact.phone ? ` · ${contact.phone}` : ""}{contact.email ? ` · ${contact.email}` : ""}
          {" · "}{requestable.length} {requestable.length === 1 ? "pendência" : "pendências"}
        </p>
        <Textarea readOnly value={text} rows={Math.min(18, text.split("\n").length + 1)} aria-label="Texto da solicitação" className="font-sans text-sm" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {phone
            ? <a className={link} href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => setVia("whatsapp")}><MessageCircle size={14} aria-hidden />Abrir no WhatsApp</a>
            : <span className="text-xs text-neutral panel:text-white/55">Sem telefone válido no cadastro do responsável para abrir o WhatsApp.</span>}
          {contact.email && <a className={link} href={`mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildPendencyRequest({ ...base, format: "email" }))}`} onClick={() => setVia("email")}><Mail size={14} aria-hidden />Abrir no e-mail</a>}
          <span onClickCapture={() => setVia("copy")}><CopyButton value={text} label="Copiar texto" /></span>
          <Button size="sm" loading={save.saving} onClick={() => void save.run(() => recordMonthlyPendencyRequest(tenantId, month, requestable.map((r) => r.topic), via ?? "copy"))}>
            <Send size={14} aria-hidden />Registrar envio{via && via !== "copy" ? ` por ${VIA_LABELS[via]}` : ""}
          </Button>
        </div>
        <p className="mt-2 text-xs text-neutral panel:text-white/55">Registre só depois de enviar: as pendências passam para “Aguardando clínica”. As que são da Mavellium ficam fora da mensagem.</p>
      </>}
  </section>;
}
