import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Criptografia simétrica para segredos DE TERCEIROS guardados no banco.
 *
 * Serve para credencial que o sistema precisa **usar de volta** — o token da API
 * do Clinicorp, por exemplo, tem que voltar em texto claro na hora de montar o
 * header Basic. Isso é o oposto de senha de usuário, que nunca é lida de volta e
 * por isso usa hash (`src/lib/password.ts`). Não troque um pelo outro.
 *
 * O que isto protege: um dump do banco (backup vazado, acesso de leitura ao
 * Postgres, log de query) deixa de entregar as credenciais das clínicas. O que
 * NÃO protege: quem já tem o `ENCRYPTION_KEY` e o banco — a chave mora no
 * ambiente do app justamente porque ele precisa decifrar em tempo de execução.
 *
 * AES-256-GCM: cifra e autentica na mesma passada, então um valor adulterado no
 * banco falha ao decifrar em vez de virar lixo silencioso.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, o tamanho recomendado para GCM
const PREFIX = "v1";

/**
 * Deriva os 32 bytes da chave a partir do `ENCRYPTION_KEY` do ambiente.
 *
 * SHA-256 sobre o segredo, e não um KDF lento como scrypt, porque a entrada já é
 * um segredo de alta entropia gerado por máquina (não uma senha humana
 * adivinhável) e esta função roda a cada chamada de API. Sem salt pelo mesmo
 * motivo: não há rainbow table contra 32 bytes aleatórios.
 *
 * O limite dessa escolha — e por que a validação abaixo importa: ela vale
 * ENQUANTO `ENCRYPTION_KEY` for saída de `openssl rand -base64 32`. Se alguém
 * um dia preencher a variável com uma frase escolhida à mão, SHA-256 é rápido
 * demais para atrasar quem tenta adivinhá-la, e a segurança do AES-256 cai para
 * a da frase. O mínimo de 32 caracteres não distingue "aleatório" de
 * "digitado", então a regra de verdade é a documentação:
 * `.env.example` e `docs/ROTACAO_DE_CHAVES.md` dizem para gerar por máquina.
 *
 * Trocar para scrypt/HKDF exigiria migrar tudo que já está cifrado (é o que o
 * prefixo `v1` permite — ver o runbook de rotação).
 */
function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_KEY não configurada. Gere uma com: openssl rand -base64 32",
    );
  }
  // Um segredo curto derrubaria a segurança do AES-256 para a do próprio
  // segredo — falha na hora, e não silenciosamente lá na frente.
  if (secret.length < 32) {
    throw new Error("ENCRYPTION_KEY curta demais: use ao menos 32 caracteres.");
  }
  return createHash("sha256").update(secret).digest();
}

/** A instalação tem como cifrar? A tela usa para não oferecer o que vai falhar. */
export function isEncryptionConfigured(): boolean {
  const secret = process.env.ENCRYPTION_KEY;
  return Boolean(secret && secret.length >= 32);
}

/**
 * Cifra um texto. Formato: `v1:<iv>:<tag>:<dados>`, tudo em base64url.
 *
 * O prefixo de versão existe para uma futura troca de algoritmo ou de chave
 * poder conviver com os valores já gravados — sem ele, migrar significaria
 * adivinhar o formato de cada linha.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(
    ":",
  );
}

/**
 * Decifra o que `encryptSecret` gravou.
 *
 * Devolve `null` em vez de lançar quando o valor não decifra (chave trocada,
 * linha corrompida, formato desconhecido): quem chama trata isso como "a
 * integração precisa ser reconectada", que é a verdade — e uma credencial
 * ilegível não pode derrubar a página inteira.
 */
export function decryptSecret(value: string): string | null {
  try {
    const parts = value.split(":");
    if (parts.length !== 4 || parts[0] !== PREFIX) return null;

    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
