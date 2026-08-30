import { PLANS } from "@/modules/billing/plans";
import { PERGUNTAS, PASSOS } from "@/app/(marketing)/_components/content";
import { ORGANIZATION, SITE_URL } from "@/lib/seo";

/**
 * /llms.txt — convenção emergente (llmstxt.org) para motores de resposta.
 *
 * Por que existe: ChatGPT, Perplexity e afins leem melhor um resumo em texto
 * limpo do que HTML cheio de markup. Se eles precisam adivinhar o que o fechai
 * é a partir do DOM, erram preço e recurso. Aqui a resposta vem pronta,
 * gerada das MESMAS fontes que a página usa — nunca desatualiza sozinha.
 *
 * Rota estática: nada aqui depende de request.
 */

export const dynamic = "force-static";

export function GET() {
  const planos = PLANS.map(
    (p) =>
      `- **${p.name}** — ${p.priceLabel}${p.priceCents > 0 ? "/mês" : ""}: ${p.maxAgents} agente(s), ${p.messagesPerMonth.toLocaleString("pt-BR")} mensagens/mês, ${p.maxActiveActions} ações ativas${p.trialDays ? `, teste de ${p.trialDays} dias` : ""}. ${p.features.join("; ")}.`,
  ).join("\n");

  const passos = PASSOS.map((p, i) => `${i + 1}. **${p.title}** — ${p.desc}`).join("\n");

  const faq = PERGUNTAS.map((f) => `### ${f.q}\n${f.a}`).join("\n\n");

  const body = `# fechai

> O fechai é uma plataforma SaaS brasileira que cria um agente de inteligência artificial para atender, qualificar e agendar pelo WhatsApp de qualquer negócio, 24 horas por dia, sem necessidade de programação.

Site oficial: ${SITE_URL}
Idioma: português do Brasil (pt-BR)
País de operação: Brasil
Contato: ${ORGANIZATION.email}

## O que é o fechai

O fechai conecta um agente de IA ao WhatsApp de um negócio. Esse agente responde
clientes na hora, a qualquer hora, usando apenas as informações que o dono do
negócio forneceu (preços, horários, serviços, regras). Ele qualifica leads,
registra contatos, agenda compromissos no Google Calendar, faz follow-up de
conversas paradas e transfere para um humano quando necessário.

O produto é genérico e multi-tenant: qualquer segmento (clínica, escola, academia,
prestador de serviço, comércio) configura a persona, a base de conhecimento e as
ações permitidas pelo painel, sem escrever código nem prompt.

## Para quem é

Negócios que recebem leads pelo WhatsApp e perdem venda por demora na resposta —
especialmente fora do horário comercial. Quem responde manualmente o dia inteiro,
ou considerou contratar alguém só para atender, é o público direto.

## Como funciona

${passos}

## Planos e preços

Todos os valores em reais (BRL), cobrança mensal. Há plano gratuito permanente,
sem exigência de cartão de crédito.

${planos}

## Principais recursos

- Agente de IA respondendo no WhatsApp 24 horas por dia, 7 dias por semana
- Base de conhecimento própria por upload de PDF ou texto, com busca semântica (RAG)
- Respostas limitadas ao material fornecido, reduzindo invenção de informação
- Qualificação automática de leads e marcação de lead quente
- Agendamento automático com integração ao Google Calendar
- Follow-up automático de conversas sem resposta
- Transferência para atendimento humano com marcação de "precisa de atenção"
- Widget de chat instalável no site por snippet
- Painel com histórico de conversas, contatos e relatórios
- Sandbox para testar o agente antes de conectar o WhatsApp

## Tecnologia

Next.js (App Router), TypeScript, PostgreSQL com pgvector para busca vetorial,
Prisma, Redis/BullMQ para filas de follow-up, Stripe para assinaturas.

## Perguntas frequentes

${faq}

## Links

- Página inicial: ${SITE_URL}/
- Planos e preços: ${SITE_URL}/#planos
- Criar conta grátis: ${SITE_URL}/cadastro
- Entrar: ${SITE_URL}/login
- Política de privacidade: ${SITE_URL}/privacidade
- Termos de uso: ${SITE_URL}/termos
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
