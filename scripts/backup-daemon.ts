import * as fs from 'fs'
import * as path from 'path'
import * as cron from 'node-cron'
import { runBackup, type BackupType } from './backup'

const BACKUPS_DIR = path.resolve(process.cwd(), 'backups')

const RETENTION: Record<BackupType, number> = {
  manual: 10,
  daily: 3,
  monthly: 1,
}

function cleanOldBackups(type: BackupType): void {
  if (!fs.existsSync(BACKUPS_DIR)) return

  const prefix = `fechai-${type}-`
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter(
      (f) =>
        f.startsWith(prefix) &&
        (f.endsWith('.sql.gz') || f.endsWith('.sql') || f.endsWith('.dump')),
    )
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtime }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

  const toDelete = files.slice(RETENTION[type])
  for (const file of toDelete) {
    fs.unlinkSync(path.join(BACKUPS_DIR, file.name))
    console.log(`Backup removido: ${file.name}`)
  }
}

async function executeBackup(type: BackupType): Promise<void> {
  const start = Date.now()
  try {
    console.log(`[${new Date().toISOString()}] Iniciando backup ${type}...`)
    const filepath = await runBackup(type)
    const sizeMb = (fs.statSync(filepath).size / 1024 / 1024).toFixed(2)
    const seconds = ((Date.now() - start) / 1000).toFixed(1)
    console.log(
      `[${new Date().toISOString()}] Backup ${type} concluído em ${seconds}s (${sizeMb} MB): ${filepath}`,
    )
    cleanOldBackups(type)
  } catch (err) {
    const seconds = ((Date.now() - start) / 1000).toFixed(1)
    console.error(
      `[${new Date().toISOString()}] Erro no backup ${type} após ${seconds}s:`,
      err instanceof Error ? err.message : String(err),
    )
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Backup daemon iniciado`)

  if (process.env.BACKUP_ON_BOOT === 'false') {
    console.log(`[${new Date().toISOString()}] Backup no boot desativado (BACKUP_ON_BOOT=false)`)
  } else {
    await executeBackup('manual')
  }

  cron.schedule('0 2 * * *', () => void executeBackup('daily'))
  cron.schedule('0 4 1 * *', () => void executeBackup('monthly'))

  console.log(
    `[${new Date().toISOString()}] Agendamentos registrados: diário 02:00 (mantém 3), mensal dia 1 04:00 (mantém 1)`,
  )
}

main().catch((err) => {
  console.error('Erro fatal no daemon:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})