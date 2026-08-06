"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

export type StepTab = {
  key: string;
  label: string;
  content: React.ReactNode;
};

/**
 * Sub-navegação dentro de um passo do wizard de agente. Mais discreta que o
 * stepper principal (sublinhado, não pílula) para não competir com ele.
 *
 * Todo painel fica sempre montado no DOM — a troca de aba só aplica `hidden`
 * no inativo. Necessário para o Persona: os grupos continuam dentro de UM
 * `<form>` só, com um botão salvar só; se a aba trocasse por desmontagem
 * condicional, os campos das abas não-ativas sairiam do `FormData` no submit
 * e a persona seria salva incompleta sem nenhum aviso.
 */
export function StepTabs({ tabs }: { tabs: StepTab[] }) {
  const [active, setActive] = useState(0);
  const groupId = useId();

  return (
    <div>
      <div role="tablist" aria-label="Seções" className="mb-6 flex flex-wrap gap-2 border-b border-white/10">
        {tabs.map((t, i) => {
          const on = i === active;
          const tabId = `${groupId}-tab-${t.key}`;
          const panelId = `${groupId}-panel-${t.key}`;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={tabId}
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(i)}
              className={cn(
                "-mb-px rounded-t-control border-b-2 px-3 py-2 font-mono text-micro uppercase tracking-[0.15em] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                on ? "border-iris text-white" : "border-transparent text-white/50 hover:text-white/80",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tabs.map((t, i) => {
        const tabId = `${groupId}-tab-${t.key}`;
        const panelId = `${groupId}-panel-${t.key}`;
        return (
          <div key={t.key} id={panelId} role="tabpanel" aria-labelledby={tabId} hidden={i !== active}>
            {t.content}
          </div>
        );
      })}
    </div>
  );
}
