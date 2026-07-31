import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Parallax } from "./Parallax";

export function CTAFinal() {
  return (
    <section className="relative overflow-hidden bg-ink px-4 py-24 md:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal/15 blur-[130px]"
      />
      <div className="reveal relative mx-auto max-w-3xl text-center">
        <Parallax speed={24}>
          <h2 className="font-display text-4xl font-bold leading-[1.02] tracking-tight text-white sm:text-6xl">
            O próximo lead não vai
            <br />
            esperar você acordar.
          </h2>
        </Parallax>
        <p className="mt-5 text-white/55">
          Configure hoje, em minutos. Sem cartão de crédito no plano grátis.
        </p>
        <Link href="/cadastro" className="mt-9 inline-block">
          <Button size="lg" variant="cta" className="h-13 px-8 text-base shadow-[0_16px_40px_-12px_rgba(255,107,74,0.7)]">
            Criar minha conta grátis
          </Button>
        </Link>
      </div>
    </section>
  );
}
