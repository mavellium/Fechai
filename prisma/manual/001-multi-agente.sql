-- Migração manual: um agente por conta -> vários agentes por conta.
--
-- Por que existe: o projeto usa `prisma db push` (sem pasta de migrations), e
-- um push direto neste schema seria destrutivo — dropa `AgentConfig` (perde
-- todas as personas) e recusa as colunas `agentId` NOT NULL em tabelas que já
-- têm linhas. Este script faz a parte que preserva dados; o `db push` depois
-- só finaliza (NOT NULL, FKs e índices) sem ter o que apagar.
--
-- Como rodar:
--   npx prisma db execute --file prisma/manual/001-multi-agente.sql --schema prisma/schema.prisma
--   npx prisma db push
--
-- Idempotente (IF NOT EXISTS / WHERE NOT EXISTS) e numa transação só: se
-- qualquer passo falhar, nada é aplicado.

BEGIN;

-- 1. Tabela de agentes. Colunas na forma final do schema.
CREATE TABLE IF NOT EXISTS "Agent" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT NOT NULL,
  "name"         TEXT NOT NULL DEFAULT 'Meu agente',
  "systemPrompt" TEXT NOT NULL DEFAULT '',
  "objective"    TEXT NOT NULL DEFAULT '',
  "personaDraft" JSONB,
  "isPrimary"    BOOLEAN NOT NULL DEFAULT false,
  "archived"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Um agente por tenant, herdando a persona do AgentConfig existente.
--    Tenant sem AgentConfig (não deveria haver) ainda ganha um agente vazio.
INSERT INTO "Agent" ("id", "tenantId", "name", "systemPrompt", "objective", "personaDraft", "isPrimary")
SELECT
  gen_random_uuid()::text,
  t."id",
  t."name",
  COALESCE(ac."systemPrompt", ''),
  COALESCE(ac."objective", ''),
  ac."personaDraft",
  true
FROM "Tenant" t
LEFT JOIN "AgentConfig" ac ON ac."tenantId" = t."id"
WHERE NOT EXISTS (SELECT 1 FROM "Agent" a WHERE a."tenantId" = t."id");

-- 3. Colunas de vínculo, criadas NULL para poderem ser preenchidas.
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "KnowledgeChunk"    ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "TenantAction"      ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "Conversation"      ADD COLUMN IF NOT EXISTS "agentId" TEXT;

-- 4. Backfill: tudo que era do tenant passa a ser do agente dele (só existe um
--    por conta neste momento, então não há ambiguidade).
UPDATE "KnowledgeDocument" d
   SET "agentId" = a."id"
  FROM "Agent" a
 WHERE a."tenantId" = d."tenantId" AND d."agentId" IS NULL;

UPDATE "KnowledgeChunk" c
   SET "agentId" = a."id"
  FROM "Agent" a
 WHERE a."tenantId" = c."tenantId" AND c."agentId" IS NULL;

UPDATE "TenantAction" ta
   SET "agentId" = a."id"
  FROM "Agent" a
 WHERE a."tenantId" = ta."tenantId" AND ta."agentId" IS NULL;

-- Conversation.agentId é opcional no schema (histórico sobrevive ao agente),
-- mas vincular o que já existe deixa /conversas coerente desde o primeiro dia.
UPDATE "Conversation" cv
   SET "agentId" = a."id"
  FROM "Agent" a
 WHERE a."tenantId" = cv."tenantId" AND cv."agentId" IS NULL;

-- 5. A unicidade de ação passa a ser por agente. O índice antigo
--    (tenantId, key) impediria dois agentes da mesma conta de ligarem a mesma
--    ação — exatamente o que a mudança precisa permitir.
DROP INDEX IF EXISTS "TenantAction_tenantId_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "TenantAction_agentId_key_key"
  ON "TenantAction" ("agentId", "key");

-- 6. Persona já copiada para Agent — a tabela antiga sai.
DROP TABLE IF EXISTS "AgentConfig";

COMMIT;
