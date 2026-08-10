import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stopImpersonation } from "@/app/(admin)/actions";

/**
 * Aviso fixo no topo do dashboard enquanto o superadmin vê o painel de outra
 * conta. Ações do painel (conversas, agente, limite) atuam na conta
 * personificada; o único caminho de volta é este botão.
 */
export function ImpersonationBanner({ email }: { email: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-signal/30 bg-signal/15 px-4 py-2 md:px-6">
      <p className="flex min-w-0 items-center gap-2 text-xs font-medium text-white/85">
        <Eye size={14} aria-hidden className="shrink-0 text-signal" />
        <span className="truncate">
          Você está vendo o painel como <span className="font-semibold text-white">{email}</span>
        </span>
      </p>
      <form action={stopImpersonation}>
        <Button variant="outline" size="sm" type="submit">
          Voltar ao admin
        </Button>
      </form>
    </div>
  );
}
