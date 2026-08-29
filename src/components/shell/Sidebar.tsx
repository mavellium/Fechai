"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShellNav, type NavItem } from "./ShellNav";
import { UsageNav } from "./UsageNav";

const STORAGE_KEY = "fechai:sidebar-collapsed";
const PREF_EVENT = "fechai:sidebar-collapsed-change";

/**
 * `localStorage` só existe no browser — não dá para ler durante o render no
 * servidor. `useSyncExternalStore` (em vez de `useEffect` + `setState`, que
 * dispara `react-hooks/set-state-in-effect`) resolve isso nativamente: usa
 * `getServerSnapshot` na hidratação e troca para o valor real do client logo
 * em seguida, sem descompasso.
 */
function subscribe(callback: () => void) {
  window.addEventListener(PREF_EVENT, callback);
  return () => window.removeEventListener(PREF_EVENT, callback);
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function getServerSnapshot() {
  return false;
}

function setCollapsedPreference(value: boolean) {
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  window.dispatchEvent(new Event(PREF_EVENT));
}

/** Sidebar desktop dos painéis, com botão de minimizar/maximizar. */
export function Sidebar({
  navItems,
  brandHref,
  brandSubtitle,
  footerLabel,
  usage,
}: {
  navItems: NavItem[];
  brandHref: string;
  brandSubtitle: string;
  footerLabel: string;
  /** Uso de conversas do mês; sem ele, o indicador não aparece. */
  usage?: {
    used: number;
    limit: number;
    perConversationCap: number;
    perConversationUsed: number;
    unlimitedTrial?: boolean;
  } | null;
}) {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 flex-col overflow-y-auto border-r border-white/10 transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className={cn("pb-6 pt-6", collapsed ? "px-0 text-center" : "px-6")}>
        <Link
          href={brandHref}
          className="rounded-sm font-display text-lg font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        >
          f<span className={collapsed ? "sr-only" : undefined}>echai</span>
          <span className="text-signal">.</span>
        </Link>
        {!collapsed && (
          <p className="mt-1 truncate font-mono text-micro uppercase tracking-[0.2em] text-white/55">
            {brandSubtitle}
          </p>
        )}
      </div>

      <div className="flex-1 px-3">
        <ShellNav items={navItems} collapsed={collapsed} />
      </div>

      {usage && (
        <div className={cn("pb-4", collapsed ? "px-2" : "px-3")}>
          <UsageNav
            used={usage.used}
            limit={usage.limit}
            perConversationCap={usage.perConversationCap}
            perConversationUsed={usage.perConversationUsed}
            unlimitedTrial={usage.unlimitedTrial}
            collapsed={collapsed}
          />
        </div>
      )}

      <div className={cn("border-t border-white/10 py-4", collapsed ? "px-2" : "px-6")}>
        {!collapsed && (
          <p className="truncate font-mono text-micro uppercase tracking-[0.2em] text-white/55">
            {footerLabel}
          </p>
        )}
        <button
          type="button"
          onClick={() => setCollapsedPreference(!collapsed)}
          aria-label={collapsed ? "Maximizar menu" : "Minimizar menu"}
          title={collapsed ? "Maximizar menu" : "Minimizar menu"}
          className={cn(
            "mt-3 flex w-full items-center gap-2 rounded-control px-2 py-2 font-mono text-micro uppercase tracking-[0.15em] text-white/60 transition-colors hover:bg-white/5 hover:text-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} className="shrink-0" aria-hidden />
          ) : (
            <PanelLeftClose size={16} className="shrink-0" aria-hidden />
          )}
          <span className={collapsed ? "sr-only" : undefined}>Minimizar</span>
        </button>
      </div>
    </aside>
  );
}
