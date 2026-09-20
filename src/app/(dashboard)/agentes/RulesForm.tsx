"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Ban, Check, Copy, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useUnsavedChanges } from "@/components/ui/unsaved-changes";
import { saveRules, type Result } from "./actions";

type Rule = { id: string; text: string };
const serialize = (rules: Rule[]) => rules.map((rule) => rule.text).join("\n");
const normalize = (text: string) => text.trim().replace(/[\r\n]+/g, " ");

export function RulesForm({ agentId, initial }: { agentId: string; initial: string }) {
  const [state, setState] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const [rules, setRules] = useState<Rule[]>(() => initial.split("\n").map((text, index) => ({ id: `initial-${index}`, text: text.trim() })).filter((rule) => rule.text));
  const [saved, setSaved] = useState(() => serialize(rules));
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [removed, setRemoved] = useState<{ rule: Rule; index: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const editingDirty = editing !== null && editing.text !== rules.find((r) => r.id === editing.id)?.text;
  useUnsavedChanges(pending || serialize(rules) !== saved || Boolean(draft) || editingDirty, "Regras", rootRef, save);

  function applyEdit(current = rules): Rule[] | null {
    if (!editing) return current;
    const text = normalize(editing.text);
    if (!text) { setState({ ok: false, error: "A regra não pode ficar vazia." }); editRef.current?.focus(); return null; }
    return current.map((rule) => rule.id === editing.id ? { ...rule, text } : rule);
  }

  function addRule() {
    const text = normalize(draft);
    if (!text) return;
    const current = applyEdit();
    if (!current) return;
    setRules([...current, { id: crypto.randomUUID(), text }]);
    setDraft(""); setEditing(null); setState(null);
  }

  function edit(rule: Rule, duplicate = false) {
    const current = applyEdit();
    if (!current) return;
    if (duplicate) {
      const copy = { id: crypto.randomUUID(), text: current.find((r) => r.id === rule.id)!.text };
      const index = current.findIndex((r) => r.id === rule.id);
      setRules([...current.slice(0, index + 1), copy, ...current.slice(index + 1)]);
      setEditing(copy);
    } else { setRules(current); setEditing(current.find((r) => r.id === rule.id)!); }
    setState(null);
  }

  function move(index: number, direction: -1 | 1) {
    const current = applyEdit();
    if (!current) return;
    const next = [...current];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setRules(next); setEditing(null); setState(null);
  }

  function save() {
    if (pending) return;
    const current = applyEdit();
    if (!current) return;
    const text = normalize(draft);
    const next = text ? [...current, { id: crypto.randomUUID(), text }] : current;
    setRules(next); setDraft(""); setEditing(null);
    const snapshot = serialize(next);
    const formData = new FormData();
    formData.set("agentId", agentId);
    formData.set("rules", snapshot);
    startTransition(async () => {
      try {
        const res = await saveRules(null, formData);
        setState(res);
        if (res.ok) { setSaved(snapshot); setRemoved(null); }
      } catch { setState({ ok: false, error: "Não foi possível salvar. Suas regras continuam aqui; tente novamente." }); }
    });
  }

  return <div ref={rootRef} className="space-y-6">
    <fieldset disabled={pending} className="min-w-0 space-y-5">
      <Field label="Nova regra" htmlFor={inputId} hint="Ex: não prometer desconto fora da tabela, não dar diagnóstico médico.">
        <div className="flex flex-wrap gap-2">
          <Input {...fieldProps(inputId, { hint: true })} className="min-w-0 flex-1" value={draft}
            onChange={(e) => { setDraft(e.target.value); setState(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRule(); } }}
            placeholder="Não prometer desconto fora da tabela" />
          <Button type="button" variant="outline" onClick={addRule} disabled={!draft.trim()}><Plus size={15} aria-hidden />Adicionar</Button>
        </div>
      </Field>
      {rules.length === 0 ? <EmptyState icon={Ban} title="Nenhuma regra definida" description="Adicione o que o agente nunca deve fazer ou prometer." /> :
        <ol className="space-y-2">
          {rules.map((rule, index) => <li key={rule.id} className="space-y-2 rounded-surface border border-white/10 p-3">
            <div className="flex items-start gap-3">
              <span className="pt-2 text-xs text-white/45">{index + 1}.</span>
              {editing?.id === rule.id ? <div className="flex min-w-0 flex-1 gap-1">
                <Input ref={editRef} autoFocus aria-label={`Texto da regra ${index + 1}`} value={editing.text}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); const next = applyEdit(); if (next) { setRules(next); setEditing(null); } }
                    if (e.key === "Escape") setEditing(null);
                  }} />
                <Button type="button" size="icon" variant="ghost" aria-label="Concluir edição da regra" title="Concluir edição"
                  onClick={() => { const next = applyEdit(); if (next) { setRules(next); setEditing(null); } }}><Check size={16} aria-hidden /></Button>
                <Button type="button" size="icon" variant="ghost" aria-label="Cancelar edição da regra" title="Cancelar edição" onClick={() => setEditing(null)}><X size={16} aria-hidden /></Button>
              </div> : <p className="min-w-0 flex-1 whitespace-pre-wrap break-words py-2 text-sm text-white/85">{rule.text}</p>}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => edit(rule)} disabled={editing?.id === rule.id} aria-label={`Editar regra ${index + 1}`}><Pencil size={14} aria-hidden />Editar</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => edit(rule, true)} aria-label={`Duplicar regra ${index + 1}`}><Copy size={14} aria-hidden />Duplicar</Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Mover regra ${index + 1} para cima`} title="Mover para cima"><ArrowUp size={15} aria-hidden /></Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => move(index, 1)} disabled={index === rules.length - 1} aria-label={`Mover regra ${index + 1} para baixo`} title="Mover para baixo"><ArrowDown size={15} aria-hidden /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover regra ${index + 1}`} title="Remover regra" className="text-white/60 hover:text-danger"
                onClick={() => { setRemoved({ rule, index }); setRules((current) => current.filter((r) => r.id !== rule.id)); if (editing?.id === rule.id) setEditing(null); setState(null); }}><Trash2 size={15} aria-hidden /></Button>
            </div>
          </li>)}
        </ol>}
      {removed && <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/65">
        <span>Regra removida.</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => {
          setRules((current) => [...current.slice(0, removed.index), removed.rule, ...current.slice(removed.index)]); setRemoved(null);
        }}><Undo2 size={14} aria-hidden />Desfazer</Button>
      </div>}
    </fieldset>
    <FormFeedback error={state?.error} info={state?.info} />
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" onClick={save} loading={pending} loadingLabel="Salvando regras">Salvar regras</Button>
      <p className="text-xs text-white/50">As alterações só valem para o agente depois de salvar.</p>
    </div>
  </div>;
}
