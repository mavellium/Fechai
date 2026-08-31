import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

const WINDOWS_PG_ROOTS = [
  'C:\\Program Files\\PostgreSQL',
  'C:\\Program Files (x86)\\PostgreSQL',
]

function findWindowsPgBin(): string | null {
  for (const root of WINDOWS_PG_ROOTS) {
    if (!fs.existsSync(root)) continue
    const versions = fs.readdirSync(root).sort((a, b) => Number(b) - Number(a))
    for (const v of versions) {
      const bin = path.join(root, v, 'bin')
      if (fs.existsSync(path.join(bin, 'pg_dump.exe'))) return bin
    }
  }
  return null
}

function findDockerContainerByPort(port: string): string | null {
  try {
    const output = execSync('docker ps --format "{{.Names}} {{.Ports}}"', {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim()
    for (const line of output.split('\n')) {
      if (line.includes(`:${port}->`)) {
        return line.split(' ')[0]
      }
    }
  } catch {
    // docker não disponível ou sem containers
  }
  return null
}

export interface PgExecContext {
  mode: 'docker' | 'local'
  containerName?: string
  binPath?: string
}

export function resolvePgContext(port: string): PgExecContext {
  if (process.env.PGBIN) {
    return { mode: 'local', binPath: process.env.PGBIN }
  }

  if (process.env.BACKUP_PG_CONTAINER) {
    return { mode: 'docker', containerName: process.env.BACKUP_PG_CONTAINER }
  }

  const container = findDockerContainerByPort(port)
  if (container) {
    return { mode: 'docker', containerName: container }
  }

  if (os.platform() === 'win32') {
    const bin = findWindowsPgBin()
    if (bin) return { mode: 'local', binPath: bin }
  }

  return { mode: 'local' }
}

export function buildPgCommand(ctx: PgExecContext, executable: string, args: string): string {
  if (ctx.mode === 'docker' && ctx.containerName) {
    return `docker exec ${ctx.containerName} ${executable} ${args}`
  }
  const bin = ctx.binPath
    ? path.join(ctx.binPath, os.platform() === 'win32' ? `${executable}.exe` : executable)
    : executable
  return `"${bin}" ${args}`
}