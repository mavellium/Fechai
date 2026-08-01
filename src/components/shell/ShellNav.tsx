"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Building2, Cpu, Home, MessageCircle, MessagesSquare, Settings, Star, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Os `NAV` que alimentam este componente nascem em `layout.tsx` (Server
 * Component). Componentes de ícone do lucide-react não são serializáveis
 * pela fronteira server→client, então o layout manda só o nome (string) e o
 * componente é resolvido aqui, que já é client.
 */
const ICONS = {
  Home,
  Bot,
  MessageCircle,
  MessagesSquare,
  BarChart3,
  Settings,
  Building2,
  Cpu,
  Star,
  Users,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

/**
 * Navegação lateral dos painéis (dashboard e admin) — link ativo com barra
 * signal. `collapsed` é usado só pela sidebar desktop (`Sidebar.tsx`); a
 * gaveta mobile sempre passa o padrão (labels visíveis).
 */
export function ShellNav({
  items,
  onNavigate,
  collapsed,
}: {
  items: NavItem[];
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Seções do painel" className="space-y-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              "relative flex items-center gap-2.5 rounded-control px-3 py-2 font-mono text-micro uppercase tracking-[0.15em] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
              // /60 é o piso de contraste do branco sobre `ink` para texto
              // pequeno (o /45 anterior ficava em ~3.9:1, abaixo do AA).
              active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white",
              collapsed && "justify-center px-0",
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-signal"
              />
            )}
            <Icon size={16} className="shrink-0" aria-hidden />
            <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
