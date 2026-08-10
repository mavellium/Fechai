"use client";

import Link from "next/link";
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Indicador de uso das duas cotas na navegação: a cota da conta (X/Y conversas
 * com barra) e o teto por conversa (limite × 3, respostas da IA). Leva a
 * /configuracoes, onde as duas aparecem separadas. Reusado pela sidebar desktop
 * (com `collapsed`) e pela gaveta mobile.
 *
 * Cores pela proximidade da cota da conta — o mesmo critério do HealthStrip:
 * neutral até 80%, warn depois disso, danger no limite.
 */
export function UsageNav({
  used,
  limit,
  perConversationCap,
  perConversationUsed,
  collapsed,
  onNavigate,
}: {
  used: number;
  limit: number;
  /** Teto de respostas da IA por conversa/mês (limite × 3). */
  perConversationCap: number;
  /** Uso real do teto: respostas da conversa mais ativa neste mês. */
  perConversationUsed: number;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const atLimit = used >= limit;
  const warning = used >= limit * 0.8;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const label = `${used.toLocaleString("pt-BR")}/${limit.toLocaleString("pt-BR")} conversas`;
  const capLabel = `${perConversationUsed.toLocaleString("pt-BR")}/${perConversationCap.toLocaleString("pt-BR")} respostas/conversa`;

  const tone = atLimit
    ? "text-danger"
    : warning
      ? "text-warn"
      : "text-white/60";

  const fill = atLimit ? "bg-danger" : warning ? "bg-warn" : "bg-iris";

  return (
    <Link
      href="/configuracoes"
      onClick={onNavigate}
      title={
        collapsed
          ? `Uso: ${label} · ${capLabel} — ver em Configurações`
          : `${label} · ${capLabel}`
      }
      aria-label={`Uso da conta: ${label} · ${capLabel}`}
      className={cn(
        "flex items-center gap-2.5 rounded-control px-3 py-2 font-mono text-micro uppercase tracking-[0.15em] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
        "hover:bg-white/5",
        collapsed && "justify-center px-0",
      )}
    >
      <Gauge size={16} className={cn("shrink-0", tone)} aria-hidden />

      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate", tone)}>{label}</span>
          <span
            aria-hidden
            className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-white/10"
          >
            <span className={cn("block h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
          </span>
          <span className="mt-1 block truncate text-white/40">{capLabel}</span>
        </span>
      )}
    </Link>
  );
}
