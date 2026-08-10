"use client";

import { useId, useState, useTransition } from "react";
import { Ban, Plus, X } from "lucide-react";
import { Alert, FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveRules, type Result } from "./actions";

function parseRules(raw: string): string[] {
  return raw
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Vive dentro da aba "Regras" do passo Personalidade, que por sua vez está
 * dentro do `<form>` da persona (ver PersonaForm) — por isso não renderiza
 * `<form>` próprio (HTML não aceita form aninhado). Salva chamando a action
 * direto via transition, no mesmo padrão do `remove()` de KnowledgeManager.
 */
export function RulesForm({ agentId, initial }: { agentId: string; initial: string }) {
  const [state, setState] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const [rules, setRules] = useState<string[]>(() => parseRules(initial));
  const [draft, setDraft] = useState("");
  const inputId = useId();

  function addRule() {
    const value = draft.trim();
    if (!value || rules.includes(value)) {
      setDraft("");
      return;
    }
    setRules((prev) => [...prev, value]);
    setDraft("");
  }

  function save() {
    const formData = new FormData();
    formData.set("agentId", agentId);
    formData.set("rules", rules.join("\n"));
    startTransition(async () => {
      const res = await saveRules(null, formData);
      setState(res);
    });
  }

  return (
    <div className="space-y-6">
      <Alert tone="info">
        Cada regra é um limite direto: algo que o agente nunca deve fazer, prometer ou dizer. Fatos
        que mudam (preço, horário, cardápio) vão na{" "}
        <strong className="font-medium">Base de conhecimento</strong>, não aqui.
      </Alert>

      <Field
        label="Nova regra"
        htmlFor={inputId}
        hint="Ex: não prometer desconto fora da tabela, não dar diagnóstico médico."
      >
        <div className="flex gap-2">
          <Input
            {...fieldProps(inputId, { hint: true })}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addRule();
              }
            }}
            placeholder="Não prometer desconto fora da tabela"
          />
          <Button type="button" variant="outline" onClick={addRule}>
            <Plus size={15} aria-hidden />
            Adicionar
          </Button>
        </div>
      </Field>

      {rules.length === 0 ? (
        <EmptyState
          icon={Ban}
          title="Nenhuma regra definida"
          description="O agente segue só a persona e a base de conhecimento. Adicione o que ele nunca deve fazer ou prometer."
        />
      ) : (
        <ul className="space-y-2">
          {rules.map((rule, i) => (
            <li
              key={`${rule}-${i}`}
              className="flex items-center justify-between gap-3 rounded-surface border border-white/10 p-3"
            >
              <span className="min-w-0 text-sm text-white/85">{rule}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover regra: ${rule}`}
                onClick={() => setRules((prev) => prev.filter((_, idx) => idx !== i))}
                className="shrink-0 text-white/60 hover:text-danger"
              >
                <X size={16} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="button" onClick={save} loading={pending} loadingLabel="Salvando regras">
        Salvar regras
      </Button>
    </div>
  );
}
