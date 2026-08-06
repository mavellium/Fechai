# Índice do Projeto

> Leia este arquivo primeiro em qualquer nova sessão. Ele te diz onde encontrar o resto — não leia o repositório inteiro.

## O que é este projeto

**fechai** — SaaS multi-tenant onde qualquer negócio configura um agente de IA para atendimento comercial via WhatsApp, sem suporte humano no onboarding. Produto **genérico** (persona, base de conhecimento e ações configuráveis); a "escola de esportes" é apenas um seed de exemplo.

> Nomenclatura: **fechai** é o nome do produto (wordmark, títulos, copy). "Agente" segue sendo o termo de domínio para a IA que atende o lead — `agent-engine`, `AgentConfig`, `runAgentTurn` e frases como "o agente responde" **não** mudam.

## Estado atual

Ver [CHANGELOG.md](./CHANGELOG.md) para o último milestone concluído.

## Onde encontrar cada coisa

- Arquitetura geral → [ARCHITECTURE.md](./ARCHITECTURE.md)
- Convenções de código → [CONVENTIONS.md](./CONVENTIONS.md)
- Primitivos de UI, superfícies e regras de interação → [CONVENTIONS.md](./CONVENTIONS.md) (seções "Superfícies" e "Regras de interação")
- Revisão de UI do painel (diagnóstico, decisões e pendências) → [revisao-ui-painel-2026-07.md](./revisao-ui-painel-2026-07.md)
- SEO e GEO (metadata, sitemap, JSON-LD, llms.txt + passos fora do código) → [SEO.md](./SEO.md)
- Decisões técnicas (ADRs) → [decisions/](./decisions/)
- Auth (Auth.js v5) → `src/auth.ts`, guards em `src/lib/session.ts`
- Cliente Prisma (singleton) → `src/lib/prisma.ts`
- Schema do banco → `prisma/schema.prisma`
- Seed (superadmin + tenant demo) → `prisma/seed.ts`
- Módulo tenants (provisionamento + onboarding) → `src/modules/tenants/README.md`
- Onboarding guiado da conta nova (`/onboarding`) → `src/app/onboarding/` + seção no README de tenants
- Módulo billing → `src/modules/billing/README.md`
- Módulo agent-engine (ações + persona; motor no M5) → `src/modules/agent-engine/README.md`
- Módulo ai (providers de LLM/embeddings, catálogo, modelo ativo) → `src/modules/ai/README.md`
- Módulo knowledge-base (RAG) → `src/modules/knowledge-base/README.md`
- Módulo whatsapp (provider Evolution) → `src/modules/whatsapp/README.md`
- Módulo reports → `src/modules/reports/README.md`
- Módulo admin → `src/modules/admin/README.md`
- Módulo feedback → `src/modules/feedback/README.md`
- Worker de follow-up → `workers/follow-up-worker/README.md`
- Deploy em produção (Docker, servidor Linux) → [README.docker.md](../README.docker.md)

## Como rodar localmente

```bash
cp .env.example .env      # preencha os secrets necessários
npm install
npm run db:up             # sobe Postgres (pgvector) + Redis via Docker
npm run db:push           # aplica o schema Prisma
npm run db:seed           # cria superadmin + tenant demo
npm run dev               # http://localhost:3000
```

Contas de teste (após seed): `superadmin@saas.local` / `demo@escola.local` — senha `password123`.
