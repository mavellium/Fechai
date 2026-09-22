import { allVariableDefinitions, type ConversationVariables as Values, type VariableDefinition } from "@/modules/agent-engine/variable-definitions";

export function ConversationVariables({ definitions, values }: { definitions: VariableDefinition[]; values: Values }) {
  const rows = allVariableDefinitions(definitions);
  return <details className="rounded-control border border-white/10 bg-white/[0.03]">
    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
      Variáveis <span className="ml-1 text-xs text-white/45">({rows.length})</span>
    </summary>
    <dl className="max-h-[min(50vh,24rem)] overflow-y-auto border-t border-white/10 px-3 py-1">
      {rows.map((row) => <div key={row.key} className="border-b border-white/5 py-2 last:border-b-0">
        <dt className="font-mono text-xs text-iris">{`{{${row.key}}}`}</dt>
        <dd className="mt-0.5 break-words text-sm text-white/80">{values[row.key] || <span className="text-white/45">não informado</span>}</dd>
        <p className="mt-0.5 text-xs text-white/45">{row.description}</p>
      </div>)}
    </dl>
  </details>;
}
