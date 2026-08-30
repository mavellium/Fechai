import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CTAAfiliados() {
  return (
    <section className="relative overflow-hidden bg-ink px-4 py-24 md:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal/15 blur-[130px]"
      />
      <div className="reveal relative mx-auto max-w-3xl text-center">
        <h2 className="font-display text-4xl font-bold leading-[1.02] tracking-tight text-white sm:text-6xl">
          A indicação que você
          <br />
          já faz de graça.
        </h2>
        <p className="mt-6 text-white/55">
          Leva dois minutos para criar a conta e gerar seu primeiro link. Sem custo, sem meta.
        </p>
        <Link href="/cadastro?tipo=afiliado" className="mt-9 inline-block">
          <Button
            size="lg"
            variant="cta"
            className="h-13 px-8 text-base shadow-[0_16px_40px_-12px_rgba(255,107,74,0.7)]"
          >
            Criar minha conta de afiliado
          </Button>
        </Link>
        <p className="mt-6 text-sm text-white/40">
          Já tem conta no fechai?{" "}
          <Link
            href="/afiliado"
            className="rounded-sm text-white/70 underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          >
            ative o programa no seu painel
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
