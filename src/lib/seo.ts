/**
 * Fonte única de verdade de SEO/GEO.
 *
 * Tudo que o Google (e os motores de resposta de IA — ChatGPT, Perplexity,
 * AI Overviews) precisam saber sobre o produto sai daqui: canonical, sitemap,
 * robots, Open Graph e JSON-LD. Nada de URL hard-coded espalhada em componente.
 *
 * O domínio vem de NEXT_PUBLIC_SITE_URL para não travar o canonical no código —
 * trocar de domínio deve ser mudar uma env var, não caçar strings no repo.
 */

/**
 * URL canônica, SEM barra final. Toda URL absoluta do site deriva daqui.
 *
 * NÃO cai para NEXTAUTH_URL: em dev ela é http://localhost:3001, e um canonical
 * apontando para localhost em produção tira o site do índice. O fallback é o
 * domínio real; para trocar de domínio, defina NEXT_PUBLIC_SITE_URL.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://fechai.januscms.com.br"
).replace(/\/+$/, "");

export const SITE_NAME = "fechai";

/**
 * Descrição-mãe. Repete a marca + a categoria ("agente de IA para WhatsApp")
 * porque é assim que tanto o Google quanto um LLM associam o nome ao que o
 * produto faz — o alvo da busca por "fechai".
 */
export const SITE_DESCRIPTION =
  "O fechai é um agente de IA que atende, qualifica e agenda pelo WhatsApp do seu negócio 24 horas por dia. Você define a persona, o que ele sabe e o que ele pode fazer — sem programar. Comece grátis, sem cartão.";

/** Termos-alvo. Ordem importa: marca primeiro, depois categoria e cauda longa. */
export const SITE_KEYWORDS = [
  "fechai",
  "fechaí",
  "fechai agente de IA",
  "agente de IA para WhatsApp",
  "atendimento automático WhatsApp",
  "chatbot com IA para WhatsApp",
  "IA para vendas no WhatsApp",
  "qualificação de leads automática",
  "agendamento automático WhatsApp",
  "automação de WhatsApp para negócios",
  "responder leads 24 horas",
  "SaaS de atendimento com inteligência artificial",
];

export const ORGANIZATION = {
  name: "fechai",
  legalName: "fechai",
  // Mesmo e-mail das páginas de privacidade/termos — contato divergente entre
  // JSON-LD e página legal é sinal de baixa confiança para o Google.
  email: "mavellium@gmail.com",
  foundingDate: "2026",
  country: "BR",
  language: "pt-BR",
} as const;

/** Perfis oficiais — viram `sameAs` no JSON-LD (sinal forte de entidade). */
export const SOCIAL_PROFILES = ["https://github.com/mavellium"];

/** Monta uma URL absoluta a partir de um caminho relativo. */
export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
