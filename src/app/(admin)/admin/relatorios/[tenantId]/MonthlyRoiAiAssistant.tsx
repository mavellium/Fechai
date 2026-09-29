"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Send, Sparkles, Trash2 } from "lucide-react";
import { SidePanel } from "@/components/ui/side-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldProps } from "@/components/ui/field";
import { Alert, FormFeedback } from "@/components/ui/alert";
import { describeMonthlyAiChange, type MonthlyAiDraft, type MonthlyAiChange } from "@/modules/reports/monthly-ai";
import type { MonthlyAiChatMessage } from "@/modules/reports/monthly-ai-chat";
import { assistMonthlyRoi, clearMonthlyRoiAiChat, loadMonthlyRoiAiChat } from "./ai-actions";

type Message = MonthlyAiChatMessage;
const stamp = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
export function MonthlyRoiAiAssistant({ open, onClose, tenantId, month, getDraft, onApply }: {
  open: boolean; onClose: () => void; tenantId: string; month: string;
  getDraft: () => MonthlyAiDraft;
  onApply: (basis: MonthlyAiDraft, changes: MonthlyAiChange[]) => void;
}) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  // Só a resposta recém-chegada tem a revisão em que se baseou; a carregada do histórico usa a revisão atual ao preencher.
  const [basis, setBasis] = useState<MonthlyAiDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [applied, setApplied] = useState(false);
  const running = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || running.current) return;
    let alive = true;
    setLoading(true);
    loadMonthlyRoiAiChat(tenantId, month).then((saved) => { if (alive && !running.current) { setMessages(saved); setBasis(null); setApplied(false); setProvider(saved.findLast((m) => m.provider)?.provider ?? null); } })
      .catch(() => { if (alive) setError("Não foi possível carregar o histórico da conversa."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, tenantId, month]);
  useEffect(() => { if (open && messages.length) end.current?.scrollIntoView({ block: "nearest" }); }, [open, messages.length, pending]);
  const send = async (text: string) => {
    if (running.current || !text.trim()) return;
    running.current = true; setPending(true); setError(null);
    try {
      const draft = getDraft();
      const form = new FormData();
      form.set("request", JSON.stringify({ draft, question: text.trim(), history: messages.slice(-10).map(({ role, content }) => ({ role, content })) }));
      const result = await assistMonthlyRoi(tenantId, month, form);
      if (!result.ok) { setError(result.error); return; }
      const at = new Date().toISOString();
      setMessages((prev) => [...prev, { role: "user" as const, content: text.trim(), at }, { role: "assistant" as const, content: result.response.reply, at, provider: result.response.providerLabel, ...(result.response.changes.length ? { changes: result.response.changes } : {}) }]);
      setProvider(result.response.providerLabel); setBasis(draft); setApplied(false); setQuestion("");
    } catch (err) {
      setError(err instanceof Error && err.name !== "ZodError" ? err.message : "Confira os campos da revisão antes de consultar a IA.");
    } finally { running.current = false; setPending(false); }
  };
  const clear = async () => {
    if (running.current || !messages.length || !window.confirm("Apagar o histórico desta conversa? Essa ação não pode ser desfeita.")) return;
    running.current = true; setPending(true); setError(null);
    try {
      const result = await clearMonthlyRoiAiChat(tenantId, month);
      if (!result.ok) { setError("Não foi possível apagar o histórico."); return; }
      setMessages([]); setBasis(null); setApplied(false);
    } catch { setError("Não foi possível apagar o histórico."); }
    finally { running.current = false; setPending(false); }
  };
  const last = messages.at(-1);
  const suggestion = last?.role === "assistant" && last.changes?.length ? last.changes : null;
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
      <div role="log" aria-label="Conversa com a IA do relatório" aria-live="polite" className="space-y-3">{messages.map((message, index) => <div key={index} className={`rounded-control border border-white/10 p-3 ${message.role === "user" ? "bg-white/5" : ""}`}><p className="mb-2 text-xs font-medium text-white/55">{message.role === "user" ? "Você" : "Assistente"}{stamp(message.at) && ` · ${stamp(message.at)}`}</p><p className="whitespace-pre-wrap break-words text-sm text-white/85">{message.content}</p></div>)}{loading && !messages.length && <p role="status" className="text-sm text-white/60">Carregando o histórico…</p>}{pending && <p role="status" className="text-sm text-white/60">A IA está conferindo a revisão…</p>}</div>
      {messages.length > 0 && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void clear()}><Trash2 size={14} aria-hidden />Apagar histórico</Button>}
      <FormFeedback error={error} />
      {suggestion && <section className="space-y-3 rounded-control border border-white/15 p-4" aria-label="Preenchimentos sugeridos pela IA"><h3 className="text-sm font-semibold">Campos sugeridos</h3><ul className="space-y-4">{suggestion.map((change) => {
        const field = describeMonthlyAiChange(change);
        return <li key={change.field}><p className="text-xs text-white/55">{field.label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{field.value}</p><p className="mt-1 text-xs text-white/55">{change.reason}</p></li>;
      })}</ul>{applied ? <Alert>Campos preenchidos. Confira a revisão e clique em Salvar revisão.</Alert> : <><p className="text-xs text-white/55">Ao preencher, apenas os campos listados são atualizados. Confira os valores antes de salvar.</p><Button type="button" size="sm" disabled={pending} onClick={() => {
        try { onApply(basis ?? getDraft(), suggestion); setApplied(true); setError(null); }
        catch (err) { setError(err instanceof Error && err.name !== "ZodError" ? err.message : "Não foi possível preencher. Confira os valores sugeridos."); }
      }}><Check size={14} aria-hidden />Preencher no relatório</Button></>}</section>}
      <div ref={end} />
    </div>
  </SidePanel>;
}
