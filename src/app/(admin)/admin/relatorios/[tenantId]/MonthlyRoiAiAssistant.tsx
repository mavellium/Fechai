"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Send, Sparkles } from "lucide-react";
import { SidePanel } from "@/components/ui/side-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldProps } from "@/components/ui/field";
import { Alert, FormFeedback } from "@/components/ui/alert";
import { describeMonthlyAiChange, type MonthlyAiDraft, type MonthlyAiResponse, type MonthlyAiChange } from "@/modules/reports/monthly-ai";
import { assistMonthlyRoi } from "./ai-actions";

type Message = { role: "user" | "assistant"; content: string };
export function MonthlyRoiAiAssistant({ open, onClose, tenantId, month, getDraft, onApply }: {
  open: boolean; onClose: () => void; tenantId: string; month: string;
  getDraft: () => MonthlyAiDraft;
  onApply: (basis: MonthlyAiDraft, changes: MonthlyAiChange[]) => void;
}) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposal, setProposal] = useState<{ basis: MonthlyAiDraft; response: MonthlyAiResponse } | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [applied, setApplied] = useState(false);
  const running = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && messages.length) end.current?.scrollIntoView({ block: "nearest" }); }, [open, messages.length, pending]);
  const send = async (text: string) => {
    if (running.current || !text.trim()) return;
    running.current = true; setPending(true); setError(null);
    try {
      const basis = getDraft();
      const form = new FormData();
      form.set("request", JSON.stringify({ draft: basis, question: text.trim(), history: messages.slice(-10) }));
      const result = await assistMonthlyRoi(tenantId, month, form);
      if (!result.ok) { setError(result.error); return; }
      setMessages([...messages, { role: "user", content: text.trim() }, { role: "assistant", content: result.response.reply }].slice(-12) as Message[]);
      setProvider(result.response.providerLabel); setProposal({ basis, response: result.response }); setApplied(false); setQuestion("");
    } catch (err) {
      setError(err instanceof Error && err.name !== "ZodError" ? err.message : "Confira os campos da revisão antes de consultar a IA.");
    } finally { running.current = false; setPending(false); }
  };
  return <SidePanel open={open} onClose={onClose} title="Fazer com I.A" subtitle={`Relatório de ${month.split("-").reverse().join("/")}`} footer={
    <form onSubmit={(event) => { event.preventDefault(); void send(question); }} className="space-y-3">
      <Field label="Pergunte ou informe os dados da clínica" htmlFor="roi-ai-question"><Textarea {...fieldProps("roi-ai-question")} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} rows={3} disabled={pending} placeholder="Ex.: custo do atendente R$ 2.500, carga de 160 h por mês. Preencha esses campos e me explique a economia." /></Field>
      <div className="flex items-center justify-between gap-3"><p className="text-xs text-white/55">{provider ? `IA: ${provider}` : "Usa a IA configurada em Admin → IA."}</p><Button type="submit" size="sm" loading={pending} disabled={!question.trim()}><Send size={14} aria-hidden />Enviar</Button></div>
    </form>
  }>
    <div className="space-y-5">
      <div className="space-y-3"><div className="flex items-center gap-2 text-sm font-medium"><Sparkles size={16} aria-hidden />Ajuda para preparar o relatório</div><p className="text-sm text-white/65">Pergunte o que cada campo significa ou informe os valores levantados com a clínica. A IA usa os indicadores e a revisão atual para sugerir preenchimentos.</p>
        <div className="flex flex-wrap gap-2">{[
          ["O que falta?", "O que falta preencher neste relatório e quais dados preciso pedir à clínica?"],
          ["Como calcular o ROI?", "Explique como é calculado o ROI deste relatório e o que significa cada premissa."],
          ["Sugerir próximo mês", "Sugira e preencha o texto de Próximo mês usando os indicadores e as pendências disponíveis."],
        ].map(([label, prompt]) => <Button key={label} type="button" variant="outline" size="sm" disabled={pending} onClick={() => void send(prompt)}>{label}</Button>)}</div>
      </div>
      <div role="log" aria-label="Conversa com a IA do relatório" aria-live="polite" className="space-y-3">{messages.map((message, index) => <div key={index} className={`rounded-control border border-white/10 p-3 ${message.role === "user" ? "bg-white/5" : ""}`}><p className="mb-2 text-xs font-medium text-white/55">{message.role === "user" ? "Você" : "Assistente"}</p><p className="whitespace-pre-wrap break-words text-sm text-white/85">{message.content}</p></div>)}{pending && <p role="status" className="text-sm text-white/60">A IA está conferindo a revisão…</p>}</div>
      <FormFeedback error={error} />
      {proposal && proposal.response.changes.length > 0 && <section className="space-y-3 rounded-control border border-white/15 p-4" aria-label="Preenchimentos sugeridos pela IA"><h3 className="text-sm font-semibold">Campos sugeridos</h3><ul className="space-y-4">{proposal.response.changes.map((change) => {
        const field = describeMonthlyAiChange(change);
        return <li key={change.field}><p className="text-xs text-white/55">{field.label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{field.value}</p><p className="mt-1 text-xs text-white/55">{change.reason}</p></li>;
      })}</ul>{applied ? <Alert>Campos preenchidos. Confira a revisão e clique em Salvar revisão.</Alert> : <><p className="text-xs text-white/55">Ao preencher, apenas os campos listados são atualizados. Confira os valores antes de salvar.</p><Button type="button" size="sm" disabled={pending} onClick={() => {
        try { onApply(proposal.basis, proposal.response.changes); setApplied(true); setError(null); }
        catch (err) { setError(err instanceof Error && err.name !== "ZodError" ? err.message : "Não foi possível preencher. Confira os valores sugeridos."); }
      }}><Check size={14} aria-hidden />Preencher no relatório</Button></>}</section>}
      <div ref={end} />
    </div>
  </SidePanel>;
}
