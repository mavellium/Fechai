"use client";
import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { UnsavedChangesProvider, UnsavedForm, useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RulesForm } from "../(dashboard)/agentes/RulesForm";
import { KnowledgeManager } from "../(dashboard)/agentes/KnowledgeManager";
import { AgentHeader } from "../(dashboard)/agentes/[id]/AgentHeader";
import { AppointmentReminders } from "../(dashboard)/agenda/AppointmentReminders";

function Fixture() {
  const guard = useUnsavedNavigation();
  const [tab, setTab] = useState("form");
  const [name, setName] = useState("Nome inicial");
  const [mode, setMode] = useState("success");
  const [result, action, pending] = useActionState(async (_: {ok: boolean} | null, data: FormData) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { ok: data.get("mode") === "success" };
  }, null);
  const form = useRef<HTMLFormElement>(null);
  return <main data-surface="dark" className="mx-auto min-h-screen max-w-4xl space-y-6 bg-ink p-8 text-white">
    <h1>Verificação local de UX</h1>
    <nav className="flex flex-wrap gap-3">{["form", "rules", "files", "name", "reminders", "other"].map((key) => <Button key={key} onClick={() => guard(() => setTab(key))}>{key}</Button>)}</nav>
    <Link href="/ux-review-temp?next=1">Link de navegação</Link>
    {tab === "form" && <UnsavedForm ref={form} label="Teste" action={action} result={result} className="space-y-4">
      <label htmlFor="review-field">Campo de teste</label><Input id="review-field" name="text" defaultValue="Original" />
      <label><input type="checkbox" name="check" />Opção de teste</label>
      <input type="hidden" name="mode" value={mode} />
      <Button type="button" onClick={() => setMode(mode === "success" ? "fail" : "success")}>Resultado: {mode}</Button>
      <Button type="submit" loading={pending}>Salvar teste</Button>
      <p role="status">{pending ? "Salvando" : result ? result.ok ? "Salvo" : "Falha simulada" : "Pronto"}</p>
    </UnsavedForm>}
    {tab === "rules" && <RulesForm agentId="fixture" initial={"Responder com clareza\nConfirmar o horário"} />}
    {tab === "files" && <KnowledgeManager agentId="fixture" documents={[]} />}
    {tab === "name" && <><AgentHeader agent={{id:"fixture",name,isPrimary:true,enabled:true}} canDelete={false} /><Button onClick={() => setName("Nome atualizado")}>Simular nome salvo pela persona</Button></>}
    {tab === "reminders" && <AppointmentReminders id="fixture" title="Consulta de teste" override={null} agentReminders={[{minutesBefore:60,template:"Olá, {{nome}}"}]} location="Clínica" sentCount={0} />}
    {tab === "other" && <p>Outra aba</p>}
  </main>;
}
export default function Review() { return <UnsavedChangesProvider><Fixture /></UnsavedChangesProvider>; }
