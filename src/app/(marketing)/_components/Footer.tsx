import Link from "next/link";
import { Mail } from "lucide-react";
import { ORGANIZATION, SOCIAL_PROFILES } from "@/lib/seo";

// URLs de redes sociais — adapte conforme seus perfis oficiais
const REDES_SOCIAIS = [
  {
    nome: "WhatsApp",
    href: "https://wa.me/5514991779502?text=Olá!%20Estava%20navegando%20no%20site%20do%20fechai%20e%20gostaria%20de%20tirar%20algumas%20dúvidas.",
    icon: "whatsapp",
  },
  { nome: "LinkedIn", href: "https://linkedin.com/company/fechai", icon: "linkedin" },
  { nome: "Instagram", href: "https://instagram.com/fechai", icon: "instagram" },
];

/**
 * Rodapé institucional.
 *
 * Além de navegação, ele carrega peso de SEO: é o link interno mais estável do
 * site (aparece em toda página), descreve a entidade "fechai" em texto — o que
 * ajuda tanto o Google quanto motores de resposta a associar a marca à
 * categoria — e usa microdados para reforçar o mesmo que o JSON-LD afirma.
 */

const PRODUTO = [
  { href: "/#como-funciona", label: "Como funciona" },
  { href: "/#acoes", label: "O que o agente faz" },
  { href: "/#planos", label: "Planos e preços" },
  { href: "/#faq", label: "Perguntas frequentes" },
];

const CONTA = [
  { href: "/cadastro", label: "Criar conta grátis" },
  { href: "/login", label: "Entrar" },
  { href: "/afiliados", label: "Programa de afiliados" },
];

const LEGAL = [
  { href: "/privacidade", label: "Política de privacidade" },
  { href: "/termos", label: "Termos de uso" },
];

function ColunaLinks({
  titulo,
  links,
}: {
  titulo: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <div>
      <h3 className="font-mono text-micro uppercase tracking-[0.2em] text-white/40">{titulo}</h3>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="rounded-control text-sm text-white/65 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-iris"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IconeSocial({ tipo }: { tipo: string }) {
  switch (tipo) {
    case "whatsapp":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91c0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.42a8.23 8.23 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23c-1.48 0-2.93-.39-4.19-1.15l-.3-.17l-3.12.82l.83-3.04l-.2-.32a8.2 8.2 0 0 1-1.26-4.38c.01-4.54 3.7-8.24 8.25-8.24M8.53 7.33c-.16 0-.43.06-.66.31c-.22.25-.87.86-.87 2.07c0 1.22.89 2.39 1 2.56c.14.17 1.76 2.67 4.25 3.73c.59.27 1.05.42 1.41.53c.59.19 1.13.16 1.56.1c.48-.07 1.46-.6 1.67-1.18s.21-1.07.15-1.18c-.07-.1-.23-.16-.48-.27c-.25-.14-1.47-.74-1.69-.82c-.23-.08-.37-.12-.56.12c-.16.25-.64.81-.78.97c-.15.17-.29.19-.53.07c-.26-.13-1.06-.39-2-1.23c-.74-.66-1.23-1.47-1.38-1.72c-.12-.24-.01-.39.11-.5c.11-.11.27-.29.37-.44c.13-.14.17-.25.25-.41c.08-.17.04-.31-.02-.43c-.06-.11-.56-1.35-.77-1.84c-.2-.48-.4-.42-.56-.43c-.14 0-.3-.01-.47-.01" />
        </svg>
      );
    case "linkedin":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93zM6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37z" />
        </svg>
      );
    case "instagram":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4zm9.65 1.5a1.25 1.25 0 0 1 1.25 1.25A1.25 1.25 0 0 1 17.25 8A1.25 1.25 0 0 1 16 6.75a1.25 1.25 0 0 1 1.25-1.25M12 7a5 5 0 0 1 5 5a5 5 0 0 1-5 5a5 5 0 0 1-5-5a5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3a3 3 0 0 0 3 3a3 3 0 0 0 3-3a3 3 0 0 0-3-3" />
        </svg>
      );
    default:
      return null;
  }
}

export function Footer() {
  const ano = new Date().getFullYear();

  return (
    <footer
      className="border-t border-white/10 bg-ink px-4 pb-10 pt-16"
      itemScope
      itemType="https://schema.org/Organization"
    >
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          {/* Marca + descrição da entidade */}
          <div className="max-w-sm">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-iris"
              aria-label="fechai — página inicial"
            >
              {/* Check estático da marca — o rodapé é server component de
                  propósito (rastreável sem JS), então nada de TypingToCheck. */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-signal"
                aria-hidden
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span className="font-display text-lg font-bold text-white" itemProp="name">
                fechai<span className="text-signal">.</span>
              </span>
            </Link>
            <p className="mt-4 leading-relaxed text-sm text-white/55" itemProp="description">
              O fechai é a plataforma brasileira que coloca um agente de IA para atender, qualificar
              e agendar pelo WhatsApp do seu negócio — 24 horas por dia, sem você precisar
              programar.
            </p>

            <div className="mt-6">
              <a
                href={`mailto:${ORGANIZATION.email}`}
                className="inline-flex items-center gap-2 rounded-control text-sm text-white/55 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-iris"
              >
                <Mail size={15} aria-hidden />
                <span itemProp="email">{ORGANIZATION.email}</span>
              </a>
            </div>
          </div>

          <ColunaLinks titulo="Produto" links={PRODUTO} />
          <ColunaLinks titulo="Conta" links={CONTA} />
          <ColunaLinks titulo="Legal" links={LEGAL} />

          {/* Redes sociais */}
          <div>
            <h3 className="font-mono text-micro uppercase tracking-[0.2em] text-white/40">
              Conecte-se
            </h3>
            <ul className="mt-4 space-y-2.5">
              {REDES_SOCIAIS.map((rede) => (
                <li key={rede.href}>
                  <a
                    href={rede.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-2.5 rounded-control text-sm text-white/65 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-iris group"
                  >
                    <span className="text-white/50 group-hover:text-signal transition-colors">
                      <IconeSocial tipo={rede.icon} />
                    </span>
                    {rede.nome}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/35">
            © {ano} fechai · agente de whatsapp com ia
          </p>
          <p className="text-sm text-white/50">
            Powered by{" "}
            <a
              href="https://www.mavellium.com.br/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-white/70 hover:text-white transition-colors"
            >
              Mavellium
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
