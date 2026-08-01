"use client";

import { useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Busca de contatos por nome ou telefone — mesmo padrão da tela de conversas. */
export function ContatoSearch({ q }: { q: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();

  function go(term: string) {
    const params = new URLSearchParams();
    if (term) params.set("q", term);
    router.push(`/contatos?${params}`);
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(ref.current?.value.trim() ?? "");
      }}
      className="relative"
    >
      <label htmlFor={id} className="sr-only">
        Buscar contato por nome ou telefone
      </label>
      <Search
        size={15}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
      />
      <Input
        id={id}
        ref={ref}
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Buscar nome ou telefone"
        autoComplete="off"
        className="pl-9 pr-9"
      />
      {q && (
        <button
          type="button"
          onClick={() => {
            if (ref.current) ref.current.value = "";
            go("");
          }}
          aria-label="Limpar busca"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-control p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </form>
  );
}
