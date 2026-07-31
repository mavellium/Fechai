# ADR-001 — Fixar Prisma na v6

## Contexto

`create-next-app` + install trouxeram Prisma 7, que removeu `url` no `schema.prisma` e passou a exigir `prisma.config.ts` + driver adapters (`@prisma/adapter-pg`) passados ao `PrismaClient`. Isso adiciona configuração e superfície não trivial logo na fundação do MVP.

## Decisão

Fixar `prisma` e `@prisma/client` na **v6** (fluxo clássico: `url = env("DATABASE_URL")` no schema, `new PrismaClient()` direto, `prisma-client-js` em `node_modules`).

## Consequência

- Menos peças móveis; caminho mais documentado para o trabalho de RAG/pgvector à frente.
- pgvector via `previewFeatures = ["postgresqlExtensions"]` + `extensions = [pgvector]`.
- Trade-off: migração futura para Prisma 7 exigirá adotar `prisma.config.ts` + adapter. Aceitável — reavaliar pós-MVP.
