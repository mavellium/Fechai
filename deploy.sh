#!/usr/bin/env bash
# Deploy incremental do fechai — mesmo padrão do janus (deploy.sh).
# O "web" e o "worker" compartilham a mesma imagem; buildar um deles já gera a
# imagem nova, então o deploy padrão sobe só o "web" (e o compose reutiliza a
# imagem no "worker" no próximo up).
#
# Uso:
#   ./deploy.sh            # build + restart do web
#   ./deploy.sh worker     # build + restart do worker
set -euo pipefail

SERVICE="${1:-web}"

echo "==> Deploy do serviço: ${SERVICE}"

echo "==> [1/3] Buildando imagem nova (site atual continua no ar)..."
docker compose build "${SERVICE}"

echo "==> [2/3] Subindo container novo e aguardando ficar saudável..."
docker compose up -d --no-deps --wait "${SERVICE}"

echo "==> [3/3] Removendo imagens órfãs..."
docker image prune -f >/dev/null 2>&1 || true

echo "==> Deploy concluído. Container saudável e no ar."
docker compose ps "${SERVICE}"
