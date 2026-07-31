# fechai — Deploy com Docker (servidor Linux)

Este documento cobre a stack de **produção**: `docker-compose.yml` orquestra 6 serviços — `web` e
`worker` rodam a mesma imagem (`Dockerfile`, só o `command` muda), e `evolution` +
`evolution-postgres` são o gateway de WhatsApp (Evolution API v2, self-hosted). Para rodar só a
Evolution na sua máquina local (sem a stack), existe o `docker-compose.evolution.yml`.

> Este arquivo substituiu o `docker-compose.yml` anterior, que só tinha Postgres+Redis para
> desenvolvimento local. Esse uso continua funcionando: `npm run db:up` agora roda
> `docker compose up -d postgres redis` (só esses dois serviços, não a stack inteira) — o fluxo de
> `next dev` local descrito no [README.md](./README.md) não muda. `postgres`/`redis` publicam a
> porta só em `127.0.0.1` (não em `0.0.0.0`): acessível do próprio servidor, não da rede externa.

## Arquitetura

```
                ┌─────────────┐
   :3000  ───▶  │     web     │  (Next.js — next start)
                └──────┬──────┘
                       │
        ┌──────────────┼──────────────┐
        ▼                             ▼
┌───────────────┐             ┌───────────────┐
│   postgres     │             │     redis     │
│ pgvector/pg16  │             │  redis:7-alpine│
└───────┬───────┘             └───┬───────┬────┘
        │                         │       │
        │                 ┌───────┴───────┴───────┐
        │                 │      worker            │  (BullMQ — follow-up)
        │                 │  mesma imagem do web   │
        │                 └───────────────────────┘
        │
┌───────┴──────────────┐        ┌──────────────────────┐
│ evolution-postgres    │   :8080│     evolution         │  (Evolution API v2)
│  postgres:16-alpine   │◀──────▶│  evoapicloud/evolution│  — gateway WhatsApp
└──────────────────────┘        └──────────────────────┘
```

Rede interna dedicada (`fechai_net`). `web` expõe a porta ao host normalmente (`WEB_PORT`);
`evolution` expõe `EVOLUTION_PORT` (padrão 8080) — a Evolution precisa ser alcançável pelo app
(e é, pela rede interna). `postgres`/`redis` publicam a porta só em `127.0.0.1` (uso local/debug no
próprio servidor, não alcançável pela rede externa).

**Serviços externos usados pelo código, mas que não rodam no seu servidor:** Stripe e Gemini/OpenAI.
O WhatsApp passou a ser local: a Evolution API (`evolution`) conecta o número e o app fala com ela
por HTTP (`EVOLUTION_API_URL`/`EVOLUTION_API_KEY`).

## Pré-requisitos no servidor Linux

- Docker Engine ≥ 24 (`docker --version`)
- Plugin Docker Compose v2 (`docker compose version` — já vem com o Docker atual; se aparecer "command
  not found", instale `docker-compose-plugin`)
- Portas livres: a que você definir em `WEB_PORT` (padrão 3000) e `EVOLUTION_PORT` (padrão 8080)

## Configurar o `.env`

```bash
cp .env.example .env
```

Edite o `.env` e preencha, no mínimo:

- `POSTGRES_PASSWORD` — obrigatório, sem valor padrão (o compose recusa subir sem ele)
- `NEXTAUTH_SECRET` / `AUTH_SECRET` — gere com `openssl rand -base64 32`
- `NEXTAUTH_URL` — a URL pública real do servidor (ex.: `https://seu-dominio.com`), não `localhost`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `GEMINI_API_KEY` (ou `OPENAI_API_KEY`, dependendo do provedor ativo em `/admin/ia`)
- `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` — o primeiro aponta para a Evolution (`http://localhost:8080` em dev; `EVOLUTION_PUBLIC_URL` em produção); o segundo é o token do gateway. Se quiser, ajuste `EVOLUTION_DB_USER`/`EVOLUTION_DB_PASSWORD`/`EVOLUTION_DB_NAME` do Postgres dedicado dela (padrão `evolution`).

> Para o app **receber** mensagens reais (responder quem chama no WhatsApp), configure `EVOLUTION_WEBHOOK_ENABLED=true` e `EVOLUTION_WEBHOOK_URL=https://seu-dominio.com/api/webhooks/whatsapp` — a Evolution dispara o evento `messages.upsert` para essa URL.

`DATABASE_URL` e `REDIS_URL` do `.env` **não precisam ser editados** — o `docker-compose.yml`
os sobrescreve automaticamente para apontar para os serviços `postgres`/`redis` da rede interna.

> `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` é injetada no bundle do frontend **durante o build** (é assim
> que o Next trata variáveis `NEXT_PUBLIC_*`). Se trocar esse valor, precisa rodar `build` de novo —
> só reiniciar o container não é suficiente.

## Build e subida

```bash
docker compose build
docker compose up -d
```

O `depends_on` com `condition: service_healthy` garante que `web` e `worker` só sobem depois que
`postgres` e `redis` responderem saudáveis.

### Primeira subida: aplicar o schema do banco

O projeto usa `prisma db push` (não há `prisma migrate` configurado ainda — ver "Observações"
abaixo). Depois do primeiro `up -d`, rode uma vez:

```bash
docker compose exec web npx prisma db push
```

Se quiser popular dados iniciais (opcional, ver `prisma/seed.ts`):

```bash
docker compose exec web npx prisma db seed
```

Repita o `db push` (não o seed) sempre que o `schema.prisma` mudar em um novo deploy.

## Conectar o WhatsApp (Evolution API)

A Evolution sobe junto com a stack. Conecte o número:

1. Acesse o app → **WhatsApp** → Conectar. O app cria a instância e mostra o QR.
2. Escaneie com o celular (WhatsApp → Configurações → Aparelhos conectados).

Para **receber** mensagens em produção, ligue o webhook (ver `.env`):
`EVOLUTION_WEBHOOK_ENABLED=true` e `EVOLUTION_WEBHOOK_URL` apontando para `/api/webhooks/whatsapp`.
Sem isso o app envia (mensagens de saída), mas não responde entradas reais.

### Local — só a Evolution, sem a stack

Reaproveita o Postgres/Redis já rodando via `npm run db:up`:

```bash
docker compose -f docker-compose.evolution.yml up -d
```

`http://localhost:8080` deve responder. A Evolution fica no ar; o restante (`web`/`worker`) continua
rodando via `npm run dev`.

## Operação do dia a dia

```bash
# ver status e healthcheck de cada serviço
docker compose ps

# logs (Ctrl+C para sair, os processos continuam rodando)
docker compose logs -f web
docker compose logs -f worker

# parar tudo (mantém os volumes/dados)
docker compose down

# parar E apagar os dados do banco/redis — cuidado, é destrutivo
docker compose down -v
```

## Atualizar para uma nova versão do código

```bash
git pull
docker compose build
docker compose up -d
docker compose exec web npx prisma db push   # se o schema mudou
```

## Validar que cada serviço está saudável

```bash
docker compose ps
```

Cada linha deve mostrar `healthy` na coluna de status. Health checks configurados:

| Serviço | Como é checado |
|---|---|
| `postgres` | `pg_isready` |
| `redis` | `redis-cli ping` |
| `evolution-postgres` | `pg_isready` |
| `web` | `GET /api/health` (endpoint já existia no projeto, testa a conexão com o banco) |
| `worker` | conexão de ping com o Redis via `ioredis` (script em `docker/healthcheck-worker.js`) |

Teste manual do app depois de subir:

```bash
curl -i http://localhost:${WEB_PORT:-3000}/api/health
```

Deve responder `200` com `{"ok":true,"db":true,...}`.

## Observações e recomendações (não aplicadas ao código automaticamente)

Estes pontos foram identificados na análise mas **não foram alterados no seu código-fonte** —
são melhorias opcionais para você decidir.

1. **`next.config.ts` sem `output: "standalone"`.** Hoje a imagem final do `web` copia o
   `node_modules` de produção inteiro. Adicionando

   ```ts
   const nextConfig: NextConfig = {
     output: "standalone",
   };
   ```

   o Next gera um `.next/standalone` só com os arquivos realmente usados (bem menor). Se quiser
   isso, me avise que eu ajusto o `next.config.ts` e o estágio `runner` do `Dockerfile` juntos.

2. **`tsx` em `devDependencies`.** O worker roda `.ts` direto em produção via `tsx`. Como `web` e
   `worker` compartilham a mesma imagem, isso obriga a imagem inteira (inclusive o `web`) a manter
   as devDependencies instaladas — não há estágio de poda no `Dockerfile`. Mover `tsx` para
   `dependencies` no `package.json` não mudaria esse ponto sozinho (ainda seria a mesma imagem para
   os dois), mas combinado com um estágio de prune reduziria o tamanho final. Também dá pra voltar a
   ter 2 Dockerfiles separados (um enxuto para o `web`, outro para o `worker`) se preferir otimizar
   tamanho em vez de simplicidade — foi a troca que fizemos a seu pedido.

3. **Sem `prisma migrate`.** O projeto usa `db push` (ver script `db:push`). Por isso o schema é
   aplicado manualmente (seção acima) em vez de rodar automaticamente no boot do container — rodar
   uma alteração de schema sem querer a cada restart seria arriscado. Para um pipeline de produção
   mais robusto (histórico de migrações, rollback), vale migrar para `prisma migrate deploy`
   quando fizer sentido para o projeto.

4. **Build baixa fontes do Google** (`next/font/google` em `src/app/layout.tsx`). O `docker compose
   build` precisa de acesso à internet de saída no servidor/CI onde ele roda.

5. **`contas.txt` na raiz do projeto** (não versionado). Já está no `.dockerignore` e deve
   continuar fora do Git — confira se não tem credenciais reais antes de qualquer commit ou backup.

6. **Sem reverse proxy incluído.** O projeto não usa nginx/Caddy, então não adicionamos nenhum ao
   compose (instrução era não incluir serviços que o projeto não usa). Para TLS/HTTPS em produção,
   coloque um reverse proxy na frente da porta `WEB_PORT` (Caddy, nginx ou um proxy gerenciado) —
   os docs do Next.js recomendam isso para self-hosting.
