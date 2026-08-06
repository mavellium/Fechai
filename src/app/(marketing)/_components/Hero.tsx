import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroChat } from "./HeroChat";
import { Parallax } from "./Parallax";

export function Hero() {
  return (
    <section
      className="relative overflow-hidden bg-ink px-4 pb-20 pt-14 md:pb-28 md:pt-20"
      aria-labelledby="hero-titulo"
    >
      {/* atmosfera: brilho iris fora de eixo + grade técnica sutil */}
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

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-signal">
            fechai · Agente de IA para WhatsApp
          </p>
          {/*
            O H1 serve a dois leitores ao mesmo tempo: a pessoa, que vê a frase
            curta de impacto, e o buscador/LLM, que precisa de marca +
            categoria. A parte visual fica em <span aria-hidden> e a versão
            completa em sr-only — um H1 só, sem encher a tela de palavra-chave.
          */}
          <h1 id="hero-titulo" className="mt-5">
            <span className="sr-only">
              fechai — agente de IA que atende, qualifica e vende pelo WhatsApp do seu negócio, 24
              horas por dia
            </span>
            <span
              aria-hidden
              className="font-display block text-[2.6rem] font-bold leading-[0.98] tracking-tight text-white sm:text-6xl lg:text-7xl"
            >
              Enquanto você
              <br />
              dorme, ele{" "}
              <span className="relative inline-block text-signal">
                vende
                <svg
                  aria-hidden
                  viewBox="0 0 120 12"
                  className="absolute -bottom-2 left-0 w-full"
                  preserveAspectRatio="none"
                >
                  <path d="M2 9 C 30 3, 90 3, 118 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-signal/60" />
                </svg>
              </span>
              .
            </span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-white/60">
            O <strong className="font-semibold text-white/80">fechai</strong> é um agente de IA que
            atende o WhatsApp do seu negócio. Você define a persona, o que ele sabe e o que pode
            fazer. Ele responde cada lead na hora — de madrugada, no feriado, no meio da sua
            reunião.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <Link href="/cadastro">
              <Button size="lg" variant="cta" className="h-13 px-7 text-base shadow-[0_12px_32px_-10px_rgba(255,107,74,0.6)]">
                Criar minha conta grátis
              </Button>
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/40">
              sem cartão · pronto em minutos
            </p>
          </div>
        </div>

        <Parallax speed={-28}>
          <HeroChat />
        </Parallax>
      </div>
    </section>
  );
}
