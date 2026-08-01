# fechai — Deploy com Docker (servidor Linux)

Este documento cobre a stack de **produção**: `docker-compose.yml` orquestra 6 serviços — `web` e
`worker` rodam a mesma imagem (`Dockerfile`, só o `command` muda), e `evolution` +
`evolution-postgres` são o gateway de WhatsApp (Evolution API v2, self-hosted). O acesso HTTPS do
subdomínio `fechai.januscms.com.br` é feito pelo **Traefik** do servidor (mesmo padrão do projeto
janus). Para rodar só a Evolution na sua máquina local (sem a stack), existe o
`docker-compose.evolution.yml`.

> Este arquivo substituiu o `docker-compose.yml` anterior, que só tinha Postgres+Redis para
> desenvolvimento local. Esse uso continua funcionando: `npm run db:up` agora roda
> `docker compose up -d postgres redis` (só esses dois serviços, não a stack inteira) — o fluxo de
> `next dev` local descrito no [README.md](./README.md) não muda. `postgres`/`redis` publicam a
> porta só em `127.0.0.1` (não em `0.0.0.0`): acessível do próprio servidor, não da rede externa.

## Arquitetura

```
                    ┌──────────────┐
   HTTPS 80/443 ───▶│   traefik    │  (proxy reverso externo — padrão janus,
                    │  (no host)   │   não sobe neste compose)
                    └──────┬───────┘
                           │  rede traefik-public
                           ▼
                    ┌─────────────┐
                    │     web     │  (Next.js — next start, :3000)
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
    │ evolution-postgres    │        │     evolution         │  (Evolution API v2)
    │  postgres:16-alpine   │◀──────▶│  evoapicloud/evolution│  — gateway WhatsApp
    └──────────────────────┘        └──────────────────────┘
```

Rede interna dedicada (`fechai_net`) + rede externa `traefik-public` (o `web` entra nela e o Traefik
roteia `fechai.januscms.com.br` → `web:3000` por labels — sem porta mapeada no host pro app). O `web`
alcança `evolution`, `postgres` e `redis` pela rede interna. `evolution` publica a porta em
`127.0.0.1` (`EVOLUTION_PORT`, admin/debug via túnel SSH no próprio servidor); `postgres`/`redis`
idem — nenhum serviço fica alcançável da rede externa.

**Serviços externos usados pelo código, mas que não rodam no seu servidor:** Stripe e Gemini/OpenAI.
O WhatsApp passou a ser local: a Evolution API (`evolution`) conecta o número e o app fala com ela
por HTTP (`EVOLUTION_API_URL`/`EVOLUTION_API_KEY`).

## Pré-requisitos no servidor Linux

- Docker Engine ≥ 24 (`docker --version`)
- Plugin Docker Compose v2 (`docker compose version` — já vem com o Docker atual; se aparecer "command
  not found", instale `docker-compose-plugin`)
- **Traefik rodando fora deste compose** (mesmo padrão do projeto janus), publicando 80/443, com a
  rede externa `traefik-public` criada (`docker network create traefik-public`) e o certresolver
  `myresolver` configurado
- **DNS**: registro A `fechai.januscms.com.br` apontando para o IP público da VPS
- **Firewall**: portas 80 e 443 liberadas. Nenhum serviço deste compose publica porta no host além do
  `evolution` em loopback (`EVOLUTION_PORT`, padrão 8080)

## Configurar o `.env`

```bash
cp .env.example .env
```

Edite o `.env` e preencha, no mínimo:

- `POSTGRES_PASSWORD` — obrigatório, sem valor padrão (o compose recusa subir sem ele)
- `NEXTAUTH_SECRET` / `AUTH_SECRET` — gere com `openssl rand -base64 32`
- `NEXTAUTH_URL` — `https://fechai.januscms.com.br` (sem barra final)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `GEMINI_API_KEY` (ou `OPENAI_API_KEY`, dependendo do provedor ativo em `/admin/ia`)
- `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` — o primeiro é usado no dev local (`http://localhost:8080`);
  em produção o compose sobrescreve para `http://evolution:8080` (rede interna). O segundo é o token
  do gateway (`AUTHENTICATION_API_KEY`). Se quiser, ajuste `EVOLUTION_DB_USER`/`EVOLUTION_DB_PASSWORD`/
  `EVOLUTION_DB_NAME` do Postgres dedicado dela (padrão `evolution`).

> Para o app **receber** mensagens reais (responder quem chama no WhatsApp), configure `EVOLUTION_WEBHOOK_ENABLED=true` e `EVOLUTION_WEBHOOK_URL=https://fechai.januscms.com.br/api/webhooks/whatsapp` — a Evolution dispara o evento `messages.upsert` para essa URL.

`DATABASE_URL` e `REDIS_URL` do `.env` **não precisam ser editados** — o `docker-compose.yml`
os sobrescreve automaticamente para apontar para os serviços `postgres`/`redis` da rede interna.

> `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` é injetada no bundle do frontend **durante o build** (é assim
> que o Next trata variáveis `NEXT_PUBLIC_*`). Se trocar esse valor, precisa rodar `build` de novo —
> só reiniciar o container não é suficiente.

## Primeira subida

Confira que a rede `traefik-public` existe (senão `docker network create traefik-public`) e que o
Traefik já está rodando — o `web` só é alcançável através dele.

```bash
docker compose build
docker compose up -d --wait
```

O `depends_on` com `condition: service_healthy` garante que `web` e `worker` só sobem depois que
`postgres` e `redis` responderem saudáveis. No fim, o app responde em
https://fechai.januscms.com.br (assim que o Traefik emitir o certificado).

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
`EVOLUTION_WEBHOOK_ENABLED=true` e `EVOLUTION_WEBHOOK_URL=https://fechai.januscms.com.br/api/webhooks/whatsapp`.
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
./deploy.sh                                  # build + restart do web (padrão janus)
docker compose exec web npx prisma db push   # se o schema mudou
```

Ou manualmente (equivalente):

```bash
git pull
docker compose build
docker compose up -d --wait
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
curl -i https://fechai.januscms.com.br/api/health
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

6. **HTTPS via Traefik externo (padrão janus).** O compose integra com o Traefik que roda no host —
   rede externa `traefik-public` + labels no `web` — mas **não sobe o Traefik** (ele é do servidor,
   compartilhado com outros apps, como no janus). Os docs do Next.js recomendam um reverse proxy na
   frente do app para self-hosting; se quiser Caddy/nginx no lugar, remova os labels e reexponha uma
   porta no host pro `web`.
