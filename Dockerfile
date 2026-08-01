# syntax=docker/dockerfile:1.7
#
# Imagem única de produção do fechai — usada pelos serviços "web" e "worker" do
# docker-compose.yml (mesmo código, comandos diferentes: `npm run start` e
# `npm run worker`). Build multi-stage: deps -> builder -> runner.
#
# Node 22 (LTS): next@16 exige >=20.9, mas a linha 20 entra em EOL em 2026-04.
# bookworm-slim (glibc, Debian) em vez de alpine: evita as pegadinhas conhecidas de
# musl com os engines nativos do Prisma e do sharp (usado pelo next/image).
#
# Observação: como o worker roda workers/follow-up-worker via `tsx` (hoje em
# devDependencies), a imagem final precisa manter as devDependencies instaladas —
# por isso não há um estágio de "prune" aqui. Se `tsx` for movido para
# "dependencies" no package.json, dá pra podar as devDependencies no estágio
# `deps` e enxugar a imagem — não fizemos essa mudança de código sem confirmar
# com você antes.

ARG NODE_VERSION=22-bookworm-slim

# ---------- base ----------
FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV NODE_ENV=production

# ---------- deps ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --include=dev

# ---------- builder ----------
FROM base AS builder
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --include=dev
COPY . .
# NEXT_PUBLIC_* é inlined no bundle em build time — precisa chegar como build arg,
# não só como env de runtime do container final.
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
RUN npm run build

# ---------- runner: imagem final, usuário não-root ----------
FROM base AS runner

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs app

COPY --from=deps    --chown=app:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=app:nodejs /app/package.json ./package.json
COPY --from=builder --chown=app:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=app:nodejs /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=app:nodejs /app/public ./public
COPY --from=builder --chown=app:nodejs /app/.next ./.next
COPY --from=builder --chown=app:nodejs /app/prisma ./prisma
COPY --from=builder --chown=app:nodejs /app/src ./src
COPY --from=builder --chown=app:nodejs /app/workers ./workers
COPY --chown=app:nodejs docker/healthcheck-web.js ./docker/healthcheck-web.js
COPY --chown=app:nodejs docker/healthcheck-worker.js ./docker/healthcheck-worker.js

ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
USER app

# Sem HEALTHCHECK fixo aqui: a mesma imagem serve "web" (HTTP) e "worker" (Redis),
# cada um com o teste certo definido no docker-compose.yml.

CMD ["npm", "run", "start"]
