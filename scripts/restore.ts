import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { createGunzip } from 'zlib'
import { pipeline } from 'stream/promises'
import * as dotenv from 'dotenv'
import { resolvePgContext, buildPgCommand } from './pg-bin'

dotenv.config()

const execAsync = promisify(exec)

interface DBConfig {
  host: string
  port: string
  user: string
  password: string
  database: string
}

function parseConnectionUrl(url: string): DBConfig {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: parsed.username,
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  }
}

async function runRestore(filePath: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL não definida no ambiente')

  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) throw new Error(`Arquivo não encontrado: ${resolved}`)

  const db = parseConnectionUrl(databaseUrl)
  const isCustomFormat = resolved.endsWith('.dump')
  const isGzip = resolved.endsWith('.gz')
  const ctx = resolvePgContext(db.port)
  const env = { ...process.env, PGPASSWORD: db.password }

  if (ctx.mode === 'docker' && ctx.containerName) {
    // .sql.gz é descomprimido no HOST e o .sql pronto é copiado pro container.
    // Evita pipe dentro de `sh -c 'gunzip | psql'`, que o child_process/cmd.exe
    // do Windows não parseia (o janus rodava restore só na VPS e nunca pegou isso).
    let source = resolved
    let localTmp: string | undefined
    if (isGzip) {
      localTmp = resolved.replace(/\.gz$/, '')
      await pipeline(fs.createReadStream(resolved), createGunzip(), fs.createWriteStream(localTmp))
      source = localTmp
    }

    const containerPath = `/tmp/${path.basename(source)}`
    const baseArgs = `--host=127.0.0.1 --port=5432 --username=${db.user} --dbname=${db.database} --no-password`

    try {
      await execAsync(`docker cp "${source}" ${ctx.containerName}:${containerPath}`, {
        env,
        maxBuffer: 512 * 1024 * 1024,
      })

      if (isCustomFormat) {
        await execAsync(
          buildPgCommand(ctx, 'pg_restore', `${baseArgs} --clean --if-exists "${containerPath}"`),
          { env, maxBuffer: 512 * 1024 * 1024 },
        )
      } else {
        await execAsync(
          buildPgCommand(ctx, 'psql', `${baseArgs} --file="${containerPath}"`),
          { env, maxBuffer: 512 * 1024 * 1024 },
        )
      }
    } finally {
      await execAsync(`docker exec ${ctx.containerName} rm -f ${containerPath}`).catch(() => {})
      if (localTmp && fs.existsSync(localTmp)) fs.unlinkSync(localTmp)
    }
  } else {
    const baseArgs = `--host=${db.host} --port=${db.port} --username=${db.user} --dbname=${db.database} --no-password`

    if (isCustomFormat) {
      await execAsync(
        buildPgCommand(ctx, 'pg_restore', `${baseArgs} --clean --if-exists "${resolved}"`),
        { env },
      )
    } else if (isGzip) {
      const tmp = resolved.replace(/\.gz$/, '')
      await pipeline(fs.createReadStream(resolved), createGunzip(), fs.createWriteStream(tmp))
      try {
        await execAsync(buildPgCommand(ctx, 'psql', `${baseArgs} --file="${tmp}"`), { env })
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
      }
    } else {
      await execAsync(buildPgCommand(ctx, 'psql', `${baseArgs} --file="${resolved}"`), { env })
    }
  }
}

const filePath = process.argv[2]

if (!filePath) {
  console.error('Uso: npx tsx scripts/restore.ts <caminho-do-backup>')
  process.exit(1)
}

runRestore(filePath)
  .then(() => {
    console.log(`Restauração concluída a partir de: ${filePath}`)
  })
  .catch((err) => {
    console.error('Erro ao restaurar backup:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })