export function Problema() {
  return (
    <section className="bg-paper px-4 py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[auto_1fr] md:gap-16">
        <p className="reveal font-mono text-[11px] uppercase tracking-[0.3em] text-neutral md:pt-3 md:[writing-mode:vertical-rl]">
          o problema
        </p>
        <div>
          <h2 className="reveal font-display max-w-3xl text-3xl font-bold leading-[1.08] tracking-tight text-ink sm:text-5xl">
            Lead que espera,{" "}
            <span className="text-iris">esfria</span>. E ele manda mensagem justamente quando você
            não pode responder.
          </h2>
          <div className="reveal mt-10 grid max-w-2xl gap-8 sm:grid-cols-2">
            <div className="border-l-2 border-signal pl-5">
              <p className="leading-relaxed text-neutral">
                A mensagem chega às 21h47. A resposta sai às 10h do dia seguinte — e ele já fechou
                com quem respondeu primeiro.
              </p>
            </div>
            <div className="border-l-2 border-ink/15 pl-5">
              <p className="leading-relaxed text-neutral">
                Contratar alguém só pra responder não fecha a conta. Responder você mesmo, o dia
                inteiro, também não.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
