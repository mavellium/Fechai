"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { filtersToHref, type LogFilterValues } from "./filter-url";

/**
 * Espera depois da última tecla antes de consultar o banco. Mesmo intervalo da
 * busca de contas, pelo mesmo motivo — e aqui pesa mais: a tabela de auditoria
 * só cresce, e cada tecla viraria uma varredura nela.
 */
const DEBOUNCE_MS = 350;

/**
 * Busca da trilha: filtra sozinha enquanto se digita.
 *
 * Procura em e-mail de quem agiu, nome da conta, rótulo do alvo e IP — os
 * quatro jeitos de chegar num evento quando se sabe só uma ponta ("o que a
 * Acme fez ontem", "quem entrou desse IP").
 */
export function LogsSearch({ values }: { values: LogFilterValues }) {
  const router = useRouter();
  const [text, setText] = useState(values.q);

  /**
   * O campo é state próprio (as teclas aparecem antes da navegação), mas a URL
   * também muda por fora: voltar no histórico, ou um link com `?q=`. Ajuste
   * durante a renderização, e não um efeito que copia `values.q` — o efeito
   * dispararia também na navegação do próprio debounce e sobrescreveria o que
   * a pessoa digitou nos milissegundos seguintes.
   */
  const [lastQ, setLastQ] = useState(values.q);
  if (values.q !== lastQ) {
    setLastQ(values.q);
    setText(values.q);
  }

  useEffect(() => {
    // Já é o que está na URL: nada a navegar. Cobre a montagem e o instante em
    // que a navegação do debounce chega.
    if (text === values.q) return;

    const id = setTimeout(() => {
      router.push(filtersToHref({ ...values, q: text }));
    }, DEBOUNCE_MS);

    // Cada tecla cancela o disparo anterior: só a última pausa vira consulta.
    return () => clearTimeout(id);
  }, [text, values, router]);

  return (
    <Field label="Buscar evento" htmlFor="busca-log" className="w-full max-w-xs">
      <div className="relative">
        <Search
          size={15}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral panel:text-white/45"
        />
        <Input
          {...fieldProps("busca-log")}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="E-mail, conta, alvo ou IP"
          className="pl-9"
        />
      </div>
    </Field>
  );
}
