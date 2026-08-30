"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleHelp, HandCoins, Layers, LogIn, Menu, UserPlus, Workflow, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS: { href: string; id: string | null; label: string; icon: typeof Workflow }[] = [
  { href: "#como-funciona", id: "como-funciona", label: "Como funciona", icon: Workflow },
  { href: "#acoes", id: "acoes", label: "Ações", icon: Zap },
  { href: "#planos", id: "planos", label: "Planos", icon: Layers },
  { href: "#faq", id: "faq", label: "FAQ", icon: CircleHelp },
  // Rota de verdade, não âncora: o scrollspy só observa as seções da home, e
  // um id inexistente nunca acende — por isso `id: null`.
  { href: "/afiliados", id: null, label: "Afiliados", icon: HandCoins },
];

export function Navbar() {
  const [active, setActive] = useState<string | null>(null);
  const menuRef = useRef<HTMLDialogElement>(null);

  // Scrollspy: acende o link da seção visível (IntersectionObserver, scroll nativo).
  useEffect(() => {
    const sections = LINKS.map((l) => (l.id ? document.getElementById(l.id) : null)).filter(
      (el): el is HTMLElement => Boolean(el),
    );
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="rounded-sm font-display text-lg font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        >
          fechai<span className="text-signal">.</span>
        </Link>
        <nav className="hidden gap-7 md:flex">
          {LINKS.map((l) => {
            // Âncora da própria home continua <a> (scroll nativo); rota de
            // verdade usa <Link> para navegar sem recarregar a página.
            const Tag = l.id ? "a" : Link;
            const on = Boolean(l.id) && active === l.id;
            return (
              <Tag
                key={l.href}
                href={l.href}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "relative -mx-1 inline-flex items-center gap-1.5 rounded-sm px-1 font-mono text-micro uppercase tracking-[0.15em] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
                  on ? "text-white" : "text-white/60 hover:text-white",
                )}
              >
                <l.icon size={14} aria-hidden />
                {l.label}
                <span
                  className={cn(
                    "absolute -bottom-[15px] left-0 h-px w-full bg-signal transition-opacity duration-300",
                    on ? "opacity-100" : "opacity-0",
                  )}
                />
              </Tag>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden items-center gap-1.5 rounded-sm text-sm text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink md:inline-flex"
          >
            <LogIn size={14} aria-hidden />
            Entrar
          </Link>
          <Link href="/cadastro" className="hidden md:block">
            <Button
              size="sm"
              variant="outline"
              className="border-white/25 bg-transparent text-white hover:bg-white/10"
            >
              <UserPlus size={14} aria-hidden />
              Criar conta
            </Button>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 md:hidden"
            aria-label="Abrir menu"
            onClick={() => menuRef.current?.showModal()}
          >
            <Menu size={20} aria-hidden />
          </Button>
        </div>
      </div>

      <dialog
        ref={menuRef}
        aria-label="Menu de navegação"
        className="m-0 ml-auto h-full max-h-none w-72 max-w-[85vw] border-l border-white/10 bg-ink p-0 backdrop:bg-ink/70 md:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 pt-5 pb-5">
            <Link
              href="/"
              className="rounded-sm font-display text-lg font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              onClick={() => menuRef.current?.close()}
            >
              fechai<span className="text-signal">.</span>
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10"
              aria-label="Fechar menu"
              onClick={() => menuRef.current?.close()}
            >
              <X size={20} aria-hidden />
            </Button>
          </div>

          <nav className="flex flex-col gap-1 px-3" aria-label="Seções da página">
            {LINKS.map((l) => {
              const Tag = l.id ? "a" : Link;
              const on = Boolean(l.id) && active === l.id;
              return (
                <Tag
                  key={l.href}
                  href={l.href}
                  aria-current={on ? "true" : undefined}
                  onClick={() => menuRef.current?.close()}
                  className={cn(
                    "flex items-center gap-2.5 rounded-control px-3 py-3 font-mono text-micro uppercase tracking-[0.15em] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
                    on ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <l.icon size={16} aria-hidden />
                  {l.label}
                </Tag>
              );
            })}
          </nav>

          <div className="mt-auto flex flex-col gap-3 border-t border-white/10 px-5 py-5">
            <Link
              href="/login"
              onClick={() => menuRef.current?.close()}
              className="inline-flex items-center justify-center gap-1.5 rounded-sm text-sm text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              <LogIn size={14} aria-hidden />
              Entrar
            </Link>
            <Link href="/cadastro" onClick={() => menuRef.current?.close()}>
              <Button
                variant="outline"
                className="w-full border-white/25 bg-transparent text-white hover:bg-white/10"
              >
                <UserPlus size={14} aria-hidden />
                Criar conta
              </Button>
            </Link>
          </div>
        </div>
      </dialog>
    </header>
  );
}
