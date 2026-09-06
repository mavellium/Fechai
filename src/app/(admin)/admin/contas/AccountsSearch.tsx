"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { filtersToHref, type TenantFilterValues } from "./filter-url";

/**
 * Espera depois da última tecla antes de consultar o banco.
 *
 * 350ms é o intervalo em que quem digita normal ("starter" = 7 teclas) gera UMA
 * consulta em vez de sete. Mais curto e cada tecla vira um SELECT; mais longo e
 * a lista parece travada depois de a pessoa parar de digitar.
 */
const DEBOUNCE_MS = 350;

/**
 * Busca da lista de contas: filtra sozinha enquanto se digita.
 *
 * Era um `<form method="get">` com botão "Buscar" — funcionava, mas cobrava um
 * clique (ou a adivinhação do Enter) por consulta. Agora o botão sai e a
 * digitação decide, com um atraso para não transformar cada tecla numa consulta
 * ao banco.
 *
 * Sem o `<form>`, os filtros ativos deixam de precisar de campos ocultos para
 * sobreviver ao envio: o endereço é montado inteiro por `filtersToHref`, a
 * partir do que já está valendo.
 */
export function AccountsSearch({
  values,
  defaultLimit,
}: {
  values: TenantFilterValues;
  defaultLimit: number;
}) {
  const router = useRouter();
  const [text, setText] = useState(values.q);

  /**
   * O campo é state próprio (as teclas aparecem antes da navegação), mas a URL
   * também muda por fora: voltar no histórico, ou um link com `?q=`. Quando
   * isso acontece, o campo tem de acompanhar.
   *
   * Ajuste durante a renderização, comparando com o `q` anterior — e não um
   * efeito que copia `values.q` a cada mudança. O efeito também dispararia
   * quando a navegação é a MINHA (a que o debounce acabou de fazer), e aí
   * sobrescreveria o que a pessoa digitou nos milissegundos seguintes,
   * fazendo o campo "voltar no tempo" no meio de uma palavra.
   */
  const [lastQ, setLastQ] = useState(values.q);
  if (values.q !== lastQ) {
    setLastQ(values.q);
    setText(values.q);
  }

  useEffect(() => {
    // Já é o que está na URL: nada a navegar. Cobre a montagem e o instante em
    // que a navegação do debounce chega — sem isto, seria um push repetido.
    if (text === values.q) return;

    const id = setTimeout(() => {
      router.push(filtersToHref({ ...values, q: text }, defaultLimit));
    }, DEBOUNCE_MS);

    // Cada tecla cancela o disparo anterior: só a última pausa vira consulta.
    return () => clearTimeout(id);
  }, [text, values, router, defaultLimit]);

  return (
    <Field label="Buscar conta" htmlFor="busca-tenant" className="w-full max-w-xs">
      <div className="relative">
        <Search
          size={15}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral panel:text-white/45"
        />
        <Input
          {...fieldProps("busca-tenant")}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nome do tenant"
          className="pl-9"
        />
      </div>
    </Field>
  );
}
