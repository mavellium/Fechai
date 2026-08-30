"use client";

import { useActionState, useState } from "react";
import { Briefcase, Check, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updateAccountRoles } from "./actions";

type Result = { ok: boolean; error?: string; info?: string };

/**
 * Escolha dos papéis da conta (usar o produto · ser afiliado).
 *
 * O estado é controlado no cliente só para poder avisar ANTES do envio quando
 * a pessoa desmarca as duas — a Server Action recusa de qualquer jeito (ela é
 * a autoridade), mas descobrir o erro depois do clique é pior.
 */
export function RolesForm({
  usesProduct,
  isAffiliate,
}: {
  usesProduct: boolean;
  isAffiliate: boolean;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(
    updateAccountRoles,
    null,
  );
  const [produto, setProduto] = useState(usesProduct);
  const [afiliado, setAfiliado] = useState(isAffiliate);

  const nenhum = !produto && !afiliado;
  const mudou = produto !== usesProduct || afiliado !== isAffiliate;

  return (
    <form action={action} className="space-y-3">
      <RoleCheck
        name="usesProduct"
        icon={Briefcase}
        titulo="Usar no meu negócio"
        desc="Agentes, conversas, WhatsApp e agenda."
        checked={produto}
        onToggle={() => setProduto((v) => !v)}
      />
      <RoleCheck
        name="isAffiliate"
        icon={HandCoins}
        titulo="Ser afiliado"
        desc="Gerar links de indicação e receber comissão."
        checked={afiliado}
        onToggle={() => setAfiliado((v) => !v)}
      />

      {nenhum && (
        <p role="alert" className="text-sm text-danger">
          Escolha pelo menos uma opção — sua conta precisa de ao menos um uso.
        </p>
      )}

      {/* Sair do programa preocupa: dizer o que NÃO se perde evita o medo de
          clicar (e o chamado de suporte que vem junto). */}
      {isAffiliate && !afiliado && (
        <p className="text-sm leading-relaxed text-white/60">
          Você sai do programa, mas nada é apagado: seu código, indicações e comissões continuam
          salvos. Ao reativar, você volta com o mesmo link.
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" variant="outline" size="sm" loading={pending} disabled={nenhum || !mudou}>
          Salvar
        </Button>
        {state?.info && (
          <p role="status" className="text-sm text-success">
            {state.info}
          </p>
        )}
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

function RoleCheck({
  name,
  icon: Icon,
  titulo,
  desc,
  checked,
  onToggle,
}: {
  name: string;
  icon: typeof Briefcase;
  titulo: string;
  desc: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-control border p-3 text-sm transition-colors",
        "focus-within:ring-2 focus-within:ring-iris focus-within:ring-offset-2 focus-within:ring-offset-ink",
        checked ? "border-iris bg-iris/10" : "border-white/15 hover:border-white/30",
      )}
    >
      {/* Checkbox real (sr-only, não `hidden`): teclado e leitor de tela
          funcionam, e o valor entra no FormData sozinho. */}
      <input type="checkbox" name={name} checked={checked} onChange={onToggle} className="sr-only" />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
          checked ? "border-iris bg-iris text-white" : "border-white/30",
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-white/90">
          <Icon size={14} className={checked ? "text-iris" : "text-white/50"} />
          {titulo}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-white/55">{desc}</span>
      </span>
    </label>
  );
}
