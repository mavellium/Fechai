import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { Transform } from 'stream'

/**
 * Criptografia dos arquivos de backup.
 *
 * O dump saía em `.sql.gz` — gzip é compressão, não cifra. Um único arquivo
 * comprometido (VPS invadida, permissão frouxa, cópia para storage mal
 * configurado) entregava o banco inteiro de TODOS os tenants: hashes de senha,
 * CPF/CNPJ e telefone de leads, conversas completas, tokens de integração.
 *
 * É a mesma escolha de `src/lib/crypto.ts` (AES-256-GCM, chave derivada por
 * SHA-256 de um segredo de alta entropia), aqui em stream porque o dump não
 * cabe confortavelmente em memória. Módulo separado do app de propósito: os
 * scripts rodam fora do Next, sem os aliases de `@/`.
 *
 * Formato do arquivo: [ IV (12 bytes) ][ ciphertext ][ authTag (16 bytes) ]
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const MIN_KEY_LENGTH = 32

export const ENCRYPTED_SUFFIX = '.enc'

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

/** A instalação tem chave de backup? */
export function isBackupEncryptionConfigured(): boolean {
  const secret = process.env.BACKUP_ENCRYPTION_KEY
  return Boolean(secret && secret.length >= MIN_KEY_LENGTH)
}

function requireKey(): Buffer {
  const secret = process.env.BACKUP_ENCRYPTION_KEY
  if (!secret) {
    throw new Error(
      'BACKUP_ENCRYPTION_KEY não configurada. Gere uma com: openssl rand -base64 32',
    )
  }
  if (secret.length < MIN_KEY_LENGTH) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY curta demais: use ao menos ${MIN_KEY_LENGTH} caracteres.`,
    )
  }
  return deriveKey(secret)
}

/**
 * Transform de cifra para entrar no pipeline do backup. O IV vai à frente do
 * conteúdo e a tag de autenticação ao final — a tag só existe depois que todo o
 * dado passou, então é justamente o `flush` que a anexa.
 */
export function createEncryptStream(): Transform {
  const key = requireKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let headerWritten = false

  // Transform próprio, envolvendo o cipher. A alternativa — remendar `push` e
  // `_flush` do próprio cipher — funciona por acidente e quebra em silêncio se
  // o Node mudar o interno; num arquivo de backup, "quebrar em silêncio"
  // significa descobrir o problema no dia da restauração.
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        if (!headerWritten) {
          headerWritten = true
          this.push(iv) // IV primeiro: a decifra precisa dele antes do resto
        }
        this.push(cipher.update(chunk))
        callback()
      } catch (err) {
        callback(err as Error)
      }
    },
    flush(callback) {
      try {
        if (!headerWritten) this.push(iv) // dump vazio: o cabeçalho sai mesmo assim
        this.push(cipher.final())
        this.push(cipher.getAuthTag()) // tag só existe depois de todo o dado
        callback()
      } catch (err) {
        callback(err as Error)
      }
    },
  })
}

/**
 * Decifra um backup inteiro em memória.
 *
 * Em memória, e não em stream, porque a tag de autenticação está nos últimos 16
 * bytes: só dá para validá-la depois de ler o arquivo todo. Isso é uma
 * propriedade desejável na restauração — um backup adulterado falha ANTES de
 * qualquer byte tocar o banco, em vez de restaurar metade e abortar.
 */
export function decryptBackup(payload: Buffer): Buffer {
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Arquivo de backup corrompido: menor que o cabeçalho mínimo.')
  }

  const key = requireKey()
  const iv = payload.subarray(0, IV_BYTES)
  const tag = payload.subarray(payload.length - TAG_BYTES)
  const data = payload.subarray(IV_BYTES, payload.length - TAG_BYTES)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([decipher.update(data), decipher.final()])
  } catch {
    // GCM falha na verificação: ou a chave é outra, ou o arquivo foi alterado.
    throw new Error(
      'Não foi possível decifrar o backup: BACKUP_ENCRYPTION_KEY incorreta ou arquivo corrompido.',
    )
  }
}

export function isEncryptedBackup(filename: string): boolean {
  return filename.endsWith(ENCRYPTED_SUFFIX)
}
