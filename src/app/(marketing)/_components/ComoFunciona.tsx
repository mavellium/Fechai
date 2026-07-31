const PASSOS = [
  {
    n: "01",
    title: "Crie a conta e a persona",
    desc: "Perguntas guiadas montam o comportamento do agente — tom de voz, o que oferecer, o que evitar. Sem escrever prompt.",
  },
  {
    n: "02",
    title: "Ensine o que ele sabe",
    desc: "Suba um PDF ou cole o texto com preços, horários e regras. Ele responde só com base nisso — não inventa.",
  },
  {
    n: "03",
    title: "Ligue as ações permitidas",
    desc: "Agendar, registrar lead, marcar quente, follow-up, transferir pra você. Cada uma é um interruptor.",
  },
  {
    n: "04",
    title: "Conecte e deixe rodar",
    desc: "QR code no WhatsApp, snippet no site. Cada mensagem atendida na hora, tudo visível no seu painel.",
  },
];

export function ComoFunciona() {
  return (
    <section id="como-funciona" className="border-t border-ink/10 bg-paper px-4 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="reveal flex items-baseline justify-between gap-4">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Como funciona
          </h2>
          <p className="hidden font-mono text-[11px] uppercase tracking-[0.25em] text-neutral sm:block">
            do zero ao ar em minutos
          </p>
        </div>

        <div className="mt-12">
          {PASSOS.map((p) => (
            <div
              key={p.n}
              className="reveal group grid gap-2 border-t border-ink/10 py-8 transition-colors hover:bg-white sm:grid-cols-[80px_1fr_1.2fr] sm:gap-8 sm:px-4"
            >
              <span className="font-mono text-sm text-signal">{p.n}</span>
              <h3 className="font-display text-xl font-semibold text-ink">{p.title}</h3>
              <p className="max-w-prose leading-relaxed text-neutral">{p.desc}</p>
            </div>
          ))}
          <div className="border-t border-ink/10" />
        </div>
      </div>
    </section>
  );
}
