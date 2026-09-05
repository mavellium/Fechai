import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import { createGzip } from 'zlib'
import { pipeline } from 'stream/promises'
import * as dotenv from 'dotenv'
import { resolvePgContext } from './pg-bin'
import {
  ENCRYPTED_SUFFIX,
  createEncryptStream,
  isBackupEncryptionConfigured,
} from './backup-crypto'

dotenv.config()

const BACKUPS_DIR = path.resolve(process.cwd(), 'backups')

export type BackupType = 'manual' | 'daily' | 'monthly'

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

function buildFilename(type: BackupType, encrypted: boolean): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  // O sufixo .enc é o que permite ao restore saber o que fazer com o arquivo
  // sem depender de configuração — inclusive com backups antigos, em claro.
  return `fechai-${type}-${timestamp}.sql.gz${encrypted ? ENCRYPTED_SUFFIX : ''}`
}

function buildDumpSpawn(
  ctx: ReturnType<typeof resolvePgContext>,
  pgArgs: string[],
): { command: string; args: string[] } {
  if (ctx.mode === 'docker' && ctx.containerName) {
    const inner =
      'if command -v ionice >/dev/null 2>&1; then exec nice -n 19 ionice -c3 pg_dump "$@"; else exec nice -n 19 pg_dump "$@"; fi'
    return {
      command: 'docker',
      args: ['exec', ctx.containerName, 'sh', '-c', inner, 'sh', ...pgArgs],
    }
  }
  const bin = ctx.binPath
    ? path.join(ctx.binPath, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump')
    : 'pg_dump'
  return { command: bin, args: pgArgs }
}

export async function runBackup(type: BackupType): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL não definida no ambiente')

  const db = parseConnectionUrl(databaseUrl)

  if (!fs.existsSync(BACKUPS_DIR)) {
    // 0o700: só o dono lê. Um diretório de backup legível por qualquer usuário
    // da máquina anula a cifra para quem já tem uma conta local no servidor.
    fs.mkdirSync(BACKUPS_DIR, { recursive: true, mode: 0o700 })
  }

  const encrypt = isBackupEncryptionConfigured()
  if (!encrypt) {
    console.warn(
      '[backup] BACKUP_ENCRYPTION_KEY não configurada — gravando SEM criptografia.\n' +
        '         O arquivo conterá dados pessoais de todos os tenants em claro.\n' +
        '         Gere uma chave com: openssl rand -base64 32',
    )
  }

  const filename = buildFilename(type, encrypt)
  const filepath = path.join(BACKUPS_DIR, filename)

  const ctx = resolvePgContext(db.port)
  const pgHost = ctx.mode === 'docker' ? '127.0.0.1' : db.host
  const pgPort = ctx.mode === 'docker' ? '5432' : db.port
  const pgArgs = [
    `--host=${pgHost}`,
    `--port=${pgPort}`,
    `--username=${db.user}`,
    `--dbname=${db.database}`,
    '--no-password',
    '--format=plain',
  ]

  const { command, args } = buildDumpSpawn(ctx, pgArgs)
  const env = { ...process.env, PGPASSWORD: db.password }

  const child = spawn(command, args, { env })

  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const dumpExit = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pg_dump falhou (código ${code}): ${stderr.trim()}`))
    })
  })

  const gzip = createGzip({ level: 1 })
  // 0o600 no próprio open: criar aberto e restringir depois deixa uma janela em
  // que o arquivo já tem conteúdo e ainda está legível por todos.
  const output = fs.createWriteStream(filepath, { mode: 0o600 })

  try {
    // Comprime e só então cifra: gzip sobre texto cifrado não reduz nada.
    const stages = encrypt
      ? pipeline(child.stdout, gzip, createEncryptStream(), output)
      : pipeline(child.stdout, gzip, output)
    await Promise.all([stages, dumpExit])
  } catch (err) {
    // Backup pela metade é pior que backup nenhum: some com o arquivo para
    // ninguém confiar num dump truncado na hora do aperto.
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
    throw err
  }

  return filepath
}

if (require.main === module) {
  const type = (process.argv[2] as BackupType) || 'manual'
  runBackup(type)
    .then((filepath) => {
      console.log(`Backup concluído: ${filepath}`)
    })
    .catch((err) => {
      console.error('Erro ao executar backup:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
}