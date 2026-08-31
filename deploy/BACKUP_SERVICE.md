# Backup como systemd service (teto duro de CPU/RAM) — fechai

Mesmo padrão do projeto janus (`deploy/janus-backup.service`), adaptado para o fechai.

Garante que o backup **nunca** passe de 50% de 1 vCPU nem de 512 MB de RAM,
independente de carga. O limite é no cgroup do serviço → cobre `node` + `gzip`.
(`pg_dump` roda no container do Postgres via `docker exec`, limitado por
`nice`/`ionice` já embutidos — ver nota no fim.)

O que o daemon faz (`scripts/backup-daemon.ts`, `node-cron`):

- **Diário às 02:00** → `fechai-daily-*.sql.gz`, mantém os **3** mais recentes;
- **Todo dia 1 às 04:00** → `fechai-monthly-*.sql.gz`, mantém **1**;
- No boot roda um `manual` (a menos que `BACKUP_ON_BOOT=false`), retenção de 10;
- Sempre com `pg_dump --format=plain` em **streaming** para `gzip -1` (RAM ~constante,
  nada de jogar o dump inteiro na memória — lição vinda da auditoria do janus).

> **Importante:** na VPS o Node é instalado via **nvm** e não há `node_modules`
> no host. Os passos abaixo resolvem isso. Faça **uma vez**.

## 1. Pré-requisitos no host (uma vez)

```bash
cd /var/www/Fechai
git pull origin main

# instala node_modules no HOST (necessario p/ rodar o daemon fora do container)
npm ci --include=dev

# symlinks ESTAVEIS p/ o systemd nao depender do caminho do nvm
# (descobre o node atual do nvm e linka em /usr/local/bin)
ln -sf "$(command -v node)" /usr/local/bin/node
ln -sf "$(command -v node)" /usr/local/bin/nodejs
```

> Se atualizar a versão do node no nvm depois, rode de novo só os dois `ln -sf`.

## 2. Confirmar que NÃO há outro backup rodando

```bash
systemctl list-units --all | grep -i fechai
pm2 list 2>/dev/null
crontab -l 2>/dev/null; sudo crontab -l 2>/dev/null
```

(`dpkg-db-backup` é do Ubuntu, ignore.) Se achar algo do fechai, desative antes:
- pm2: `pm2 delete <nome> && pm2 save`
- cron: `crontab -e` e remova a linha

## 3. Achar o nome REAL do container do Postgres

O `.service` usa `BACKUP_PG_CONTAINER=fechai-postgres-1` como padrão, mas o nome
depende de como o compose foi iniciado (projeto/diretorio). Confira:

```bash
docker ps --format "{{.Names}} {{.Image}}"
```

Se o container do banco do fechai tiver outro nome (ex.: `fechai_postgres_1`,
`saas_postgres`, etc.), **edite o `BACKUP_PG_CONTAINER` no `.service` antes de instalar**.
É obrigatório fixar o container aqui: nesta VPS há vários Postgres e a detecção
automática por porta poderia pegar o container errado.

## 4. Instalar o service

```bash
sudo cp /var/www/Fechai/deploy/fechai-backup.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fechai-backup.service
```

> Confira também que o `DATABASE_URL` do `.env` do host aponta para o banco certo —
> porta da publicação do Postgres do compose (`POSTGRES_HOST_PORT`, nesta VPS é
> **5438**). O daemon lê o `.env` da pasta de trabalho e, com `BACKUP_PG_CONTAINER`
> fixo, usa só usuário/senha/banco dele (ignora host/porta).

## 5. Verificar

```bash
systemctl status fechai-backup.service
systemctl show fechai-backup.service -p CPUQuotaPerSecUSec -p MemoryMax
journalctl -u fechai-backup.service -n 30 --no-pager
```

- `CPUQuotaPerSecUSec` deve ser `500ms` (= 50%).
- Logs devem mostrar:
  `Agendamentos registrados: diário 02:00 (mantém 3), mensal dia 1 04:00 (mantém 1)`
- `status` deve estar `active (running)`.

## 6. Testar um backup AGORA (sem esperar 02:00) sob o mesmo teto

```bash
sudo BACKUP_PG_CONTAINER=fechai-postgres-1 systemd-run --scope \
  -p CPUQuota=50% -p MemoryMax=512M \
  --working-directory=/var/www/Fechai \
  --setenv=BACKUP_PG_CONTAINER=fechai-postgres-1 \
  /usr/local/bin/node node_modules/tsx/dist/cli.mjs scripts/backup.ts manual

ls -lh backups/        # deve aparecer um fechai-manual-*.sql.gz
```

> `systemd-run --scope` não aceita `-p Nice=`; o `pg_dump` já roda com
> `nice -19`/`ionice` embutidos, então não é necessário aqui.

Em paralelo, em outro terminal, confirme que o teto segura:
```bash
top -b -n1 | grep -E 'node|gzip'   # %CPU do node nao passa de ~50
```

## Restaurar um backup

```bash
cd /var/www/Fechai
npm run db:restore backups/fechai-daily-XXXX.sql.gz
```

Aceita `.sql.gz`, `.sql` (compactado com gzip em ~/tmp) e `.dump` (via `pg_restore`).

## Ajustar o teto

Edite `CPUQuota` no `.service` (`100%` = 1 core; `50%` = meio core), depois:
```bash
sudo systemctl daemon-reload && sudo systemctl restart fechai-backup.service
```

## Notas

- **`BACKUP_PG_CONTAINER`**: fixa QUAL container Postgres dumpar. Obrigatório neste
  host, que tem vários Postgres — a detecção automática por porta pegaria o
  container errado. Sempre que o teste manual rodar fora do service, exporte antes:
  `export BACKUP_PG_CONTAINER=fechai-postgres-1`
- `BACKUP_ON_BOOT=false`: não dispara dump pesado a cada restart/reboot do
  service. Remova a linha se quiser backup no boot.
- **Fuso horário:** o `node-cron` usa o horário do servidor — nesta VPS é **UTC**
  (02:00 UTC = 23h em Brasília; dia 1 04:00 UTC = 01h).
  Para rodar no fuso de Brasília, adicione `Environment=TZ=America/Sao_Paulo`
  no `.service` e reinstale, ou ajuste os horários ("diário 02:00" vira `0 5 * * *`).
- **Destino e retenção:** os dumps ficam em `<projeto>/backups/` (ignorado pelo
  Git e pelo build do Docker). Daemon remove os antigos após cada dump:
  manual 10, diário 3, mensal 1. Para colocar em outro volume/disco, mude o
  `BACKUPS_DIR` em `scripts/backup.ts` ou aponte com um bind/symlink.
- **`pg_dump` x teto duro:** o dump roda dentro do container do Postgres
  (`docker exec`), fora do cgroup do service. Ele é limitado por `nice -19` +
  `ionice -c3 idle` já embutidos no comando → cede CPU/IO sob disputa, mas
  **não tem teto duro**. O que travava a VPS no passado (dump inteiro em RAM →
  swap) já foi eliminado pelo streaming; isso não volta.