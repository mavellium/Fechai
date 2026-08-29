import type { Metadata } from "next";
import Link from "next/link";
import { HeroChat } from "../(marketing)/_components/HeroChat";
import { FadeIn } from "@/components/ui/FadeIn";

/**
 * As telas de auth são client components, que não podem exportar `metadata` —
 * por isso o title/description delas vive aqui, no layout (server component).
 * Ficam indexáveis de propósito: "criar conta fechai" é consulta de marca.
 */
export const metadata: Metadata = {
  title: "Criar conta ou entrar",
  description:
    "Crie sua conta no fechai e coloque um agente de IA para atender o WhatsApp do seu negócio. Plano grátis, sem cartão de crédito.",
  alternates: { canonical: "/cadastro" },
};

/**
 * Tela de conversão: sem navegação completa, um único caminho (completar o form).
 * Desktop: split — form à esquerda (paper), demo ao vivo do produto à direita (ink).
 * Mobile: só o form, com o wordmark no topo.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // O bloqueio de quem já tem sessão mora no layout de `(guest)`: /login,
  // /cadastro e /esqueci-senha redirecionam, mas /redefinir-senha não pode —
  // o link do e-mail costuma ser aberto com a sessão antiga ainda de pé.
  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-[1fr_1.05fr]">
      {/* Coluna do formulário */}
      <div className="flex flex-col px-4 py-8 sm:px-10">
        <Link href="/" className="font-display w-fit text-lg font-bold text-ink">
          fechai<span className="text-signal">.</span>
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          {/* `max-w-md` (e não `sm`): o cadastro virou um wizard com pares de
              campos lado a lado — em 384px eles ficavam espremidos demais. */}
          <FadeIn className="w-full max-w-md">{children}</FadeIn>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral">
          atendimento com ia · 24/7
        </p>
      </div>

      {/* Painel demo (desktop): o produto funcionando, ao vivo */}
      <div className="relative hidden items-center justify-center overflow-hidden bg-ink p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full bg-iris/25 blur-[130px]"
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
        <div className="relative w-full max-w-[380px]">
          <HeroChat />
          <p className="mt-6 text-center text-sm leading-relaxed text-white/55">
            É isso que o agente vai fazer pelos seus leads enquanto você termina este cadastro:
            responder na hora e fechar o próximo passo.
          </p>
        </div>
      </div>
    </div>
  );
}
