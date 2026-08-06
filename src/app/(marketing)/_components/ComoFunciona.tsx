import { PASSOS } from "./content";

export function ComoFunciona() {
  return (
    <section
      id="como-funciona"
      className="border-t border-ink/10 bg-paper px-4 py-20 md:py-28"
      aria-labelledby="como-funciona-titulo"
    >
      <div className="mx-auto max-w-6xl">
        <div className="reveal flex items-baseline justify-between gap-4">
          <h2
            id="como-funciona-titulo"
            className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl"
          >
            Como funciona o fechai
          </h2>
          <p className="hidden font-mono text-micro uppercase tracking-[0.25em] text-neutral sm:block">
            do zero ao ar em minutos
          </p>
        </div>

        {/* Resposta direta em uma frase: é o trecho que motores de IA citam. */}
        <p className="reveal mt-5 max-w-prose leading-relaxed text-neutral">
          Colocar o fechai para atender leva quatro passos e alguns minutos: você cria a persona do
          agente, ensina o que ele sabe sobre o seu negócio, escolhe o que ele pode fazer e conecta
          o WhatsApp.
        </p>

        <ol className="mt-12">
          {PASSOS.map((p) => (
            <li
              key={p.n}
              className="reveal grid gap-2 border-t border-ink/10 py-8 transition-colors hover:bg-white sm:grid-cols-[80px_1fr_1.2fr] sm:gap-8 sm:px-4"
            >
              <span className="font-mono text-sm text-signal" aria-hidden>
                {p.n}
              </span>
              <h3 className="font-display text-xl font-semibold text-ink">{p.title}</h3>
              <p className="max-w-prose leading-relaxed text-neutral">{p.desc}</p>
            </li>
          ))}
        </ol>
        <div className="border-t border-ink/10" />
      </div>
    </section>
  );
}
