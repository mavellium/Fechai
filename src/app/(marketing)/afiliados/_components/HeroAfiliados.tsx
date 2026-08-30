import Link from "next/link";
import { PLANS } from "@/modules/billing/plans";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  bpsToPercentLabel,
  commissionOf,
  DEFAULT_COMMISSION_BPS,
  MAX_COMMISSION_BPS,
} from "@/modules/affiliates/config";

/**
 * Hero do programa de afiliados.
 *
 * A promessa é diferente da home: lá se vende o agente, aqui se vende a RENDA.
 * Por isso a faixa de comissão (5% a 20%, recorrente) aparece antes de
 * qualquer adjetivo — é o que a pessoa veio saber, e esconder atrás de
 * "potencialize seus ganhos" só faria ela rolar a página procurando.
 */
export function HeroAfiliados() {
  const inicial = bpsToPercentLabel(DEFAULT_COMMISSION_BPS);
  const maximo = bpsToPercentLabel(MAX_COMMISSION_BPS);

  return (
    <section
      className="relative overflow-hidden bg-ink px-4 pb-20 pt-14 md:pb-28 md:pt-20"
      aria-labelledby="afiliados-titulo"
    >
      {/* mesma atmosfera da home: brilho fora de eixo + grade técnica */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-iris/25 blur-[140px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-56 -left-24 h-[420px] w-[420px] rounded-full bg-signal/10 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-signal">
            programa de afiliados · fechai
          </p>

          <h1 id="afiliados-titulo" className="mt-5">
            <span className="sr-only">
              Programa de afiliados do fechai: ganhe de {inicial} a {maximo} de comissão
              recorrente todos os meses por cada assinatura que você indicar — o percentual sobe
              conforme o número de vendas.
            </span>
            <span
              aria-hidden
              className="font-display block text-[2.6rem] font-bold leading-[0.98] tracking-tight text-white sm:text-6xl lg:text-[4.2rem]"
            >
              Indique uma vez.
              <br />
              Receba{" "}
              <span className="relative inline-block text-signal">
                todo mês
                <svg
                  aria-hidden
                  viewBox="0 0 120 12"
                  className="absolute -bottom-2 left-0 w-full"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M2 9 C 30 3, 90 3, 118 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className="text-signal/60"
                  />
                </svg>
              </span>
              .
            </span>
          </h1>

          <p className="mt-7 max-w-md text-lg leading-relaxed text-white/60">
            Você ganha <strong className="font-semibold text-white/90">comissão recorrente</strong>{" "}
            de cada assinatura que indicar — não só na primeira compra, mas em{" "}
            <strong className="font-semibold text-white/90">todo mês</strong> que o cliente
            continuar pagando. Começa em {inicial} e chega a{" "}
            <strong className="font-semibold text-white/90">{maximo}</strong> conforme você vende.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/cadastro?tipo=afiliado">
              <Button
                size="lg"
                variant="cta"
                className="h-13 w-full px-8 text-base shadow-[0_16px_40px_-12px_rgba(255,107,74,0.7)] sm:w-auto"
              >
                Quero ser afiliado
              </Button>
            </Link>
            <a
              href="#quanto-ganha"
              className="rounded-sm px-2 py-2 text-center text-sm text-white/55 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              Ver quanto dá para ganhar
            </a>
          </div>

          <p className="mt-5 font-mono text-micro uppercase tracking-[0.15em] text-white/35">
            grátis para entrar · sem meta mínima · pagamento via pix
          </p>
        </div>

        {/* Prova visual do argumento central: a mesma indicação pagando mês a mês. */}
        <RecorrenciaVisual />
      </div>
    </section>
  );
}

/**
 * Ilustra o que "recorrente" significa em dinheiro: uma única indicação do
 * plano Pro rendendo a mesma comissão em meses consecutivos, com o acumulado
 * crescendo. É o conceito mais difícil de vender em texto e o mais fácil de
 * entender numa coluna de valores repetidos.
 *
 * Usa a faixa de ENTRADA (5%), não o teto: é o que a pessoa que está lendo vai
 * ganhar de fato na primeira venda. Prometer o número do topo aqui seria vender
 * um valor que ela não vai ver no primeiro mês.
 */
function RecorrenciaVisual() {
  const plano = PLANS.find((p) => p.highlight) ?? PLANS[1];
  const porMes = commissionOf(plano.priceCents, DEFAULT_COMMISSION_BPS);
  const meses = [1, 2, 3, 4].map((n) => ({
    mes: `Mês ${n}`,
    valor: formatBRL(porMes),
    acumulado: formatBRL(porMes * n),
  }));

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur md:p-7">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">
          1 indicação · plano {plano.name.toLowerCase()}
        </p>
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-signal">
          {bpsToPercentLabel(DEFAULT_COMMISSION_BPS)}
        </p>
      </div>

      <ul className="mt-6 space-y-px">
        {meses.map((m, i) => (
          <li
            key={m.mes}
            className="flex items-center justify-between gap-4 rounded-control px-3 py-3"
            style={{ background: `rgba(255,255,255,${0.03 + i * 0.015})` }}
          >
            <span className="font-mono text-xs uppercase tracking-[0.15em] text-white/40">
              {m.mes}
            </span>
            <span className="font-mono text-sm tabular-nums text-white/70">+{m.valor}</span>
            <span className="font-display text-base font-semibold tabular-nums text-white">
              {m.acumulado}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-6 border-t border-white/10 pt-5 text-sm leading-relaxed text-white/50">
        Uma indicação feita hoje continua pagando no ano que vem. E esse valor{" "}
        <strong className="font-semibold text-white/80">sobe até {bpsToPercentLabel(MAX_COMMISSION_BPS)}</strong>{" "}
        conforme sua carteira cresce — sem precisar renegociar nada.
      </p>
    </div>
  );
}
