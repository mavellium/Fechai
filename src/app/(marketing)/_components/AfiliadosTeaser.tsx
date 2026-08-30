import Link from "next/link";
import { ArrowRight, HandCoins } from "lucide-react";
import { bpsToPercentLabel, DEFAULT_COMMISSION_BPS, MAX_COMMISSION_BPS } from "@/modules/affiliates/config";

/**
 * Chamada do programa de afiliados na home.
 *
 * Fica logo depois dos Planos de propósito: quem acabou de ler os preços tem
 * o número fresco na cabeça, e é nesse instante que "uma fatia disso, todo mês"
 * significa alguma coisa. É uma faixa, não uma seção cheia — a home vende o
 * agente; a página de afiliados é que vende o programa.
 */
export function AfiliadosTeaser() {
  const inicial = bpsToPercentLabel(DEFAULT_COMMISSION_BPS);
  const maximo = bpsToPercentLabel(MAX_COMMISSION_BPS);

  return (
    <section
      className="border-t border-ink/10 bg-white px-4 py-16 md:py-20"
      aria-labelledby="afiliados-teaser-titulo"
    >
      <div className="reveal mx-auto flex max-w-6xl flex-col gap-8 rounded-xl border border-neutral/20 bg-paper p-8 md:flex-row md:items-center md:justify-between md:p-10">
        <div className="max-w-xl">
          <p className="flex items-center gap-2 font-mono text-micro uppercase tracking-[0.25em] text-neutral">
            <HandCoins size={14} className="text-iris" aria-hidden />
            programa de afiliados
          </p>
          <h2
            id="afiliados-teaser-titulo"
            className="font-display mt-4 text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl"
          >
            Indique o fechai e ganhe até {maximo} todo mês.
          </h2>
          <p className="mt-3 max-w-prose leading-relaxed text-neutral">
            A comissão é recorrente: você recebe enquanto o cliente indicado continuar assinando —
            não só na primeira compra. Começa em {inicial} e sobe conforme você vende. Entrar é
            grátis e não tem meta mínima.
          </p>
        </div>

        <Link
          href="/afiliados"
          className="inline-flex shrink-0 items-center gap-2 rounded-control border border-ink/15 bg-white px-5 py-3 text-sm font-medium text-ink transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2"
        >
          Conhecer o programa
          <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
