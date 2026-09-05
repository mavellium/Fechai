import { z } from "zod";

/**
 * Conferência das variáveis de ambiente críticas.
 *
 * Existe por causa de uma classe inteira de falha: um segredo ausente não
 * quebrava nada visivelmente, só desligava a proteção em silêncio. O HMAC da
 * personificação caía para chave vazia e continuava "validando"; o webhook do
 * WhatsApp seguia aceitando qualquer requisição. O produto parecia saudável.
 *
 * Aqui o erro aparece no boot, não meses depois num incidente.
 *
 * O que NÃO entra nesta lista: chave de serviço opcional (Stripe, OpenAI,
 * Google, Bunny, Resend). O código já trata a ausência delas como "recurso
 * indisponível neste ambiente" — `isStripeConfigured()`, `isEncryptionConfigured()` —
 * e transformar isso em erro fatal impediria rodar o projeto localmente sem ter
 * conta em todos os terceiros. A régua para entrar aqui é: sem isto, alguma
 * proteção falha aberta.
 */

const MIN_SECRET_LENGTH = 32;

const secret = (name: string) =>
  z
    .string({ message: `${name} não configurada` })
    .min(
      MIN_SECRET_LENGTH,
      `${name} curta demais: use ao menos ${MIN_SECRET_LENGTH} caracteres. Gere uma com: openssl rand -base64 32`,
    );

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL não configurada"),
  // Assina a sessão E o cookie de personificação. O NextAuth v5 aceita os dois
  // nomes; aceitamos também, senão uma instalação válida seria recusada aqui.
  AUTH_SECRET: secret("AUTH_SECRET"),
});

export type CriticalEnv = z.infer<typeof schema>;

/**
 * Valida e devolve os problemas em texto. Não lança: quem chama decide o que
 * fazer — o boot derruba o processo, um health check apenas relata.
 */
export function checkCriticalEnv(): { ok: true } | { ok: false; problems: string[] } {
  const parsed = schema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  });

  if (parsed.success) return { ok: true };
  return { ok: false, problems: parsed.error.issues.map((i) => i.message) };
}

/**
 * Avisos de configuração que não impedem o produto de subir, mas desligam
 * alguma defesa. Separado do bloco acima de propósito: um projeto novo, sem
 * WhatsApp conectado, não deve ser impedido de rodar por causa do segredo de um
 * webhook que ninguém vai chamar — mas quem opera precisa saber que está assim.
 */
export function warnOptionalSecurityEnv(): string[] {
  const warnings: string[] = [];

  if (!process.env.WHATSAPP_WEBHOOK_SECRET) {
    warnings.push(
      "WHATSAPP_WEBHOOK_SECRET não configurada — o webhook do WhatsApp vai RECUSAR todas as mensagens.",
    );
  }

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey || encryptionKey.length < MIN_SECRET_LENGTH) {
    warnings.push(
      "ENCRYPTION_KEY ausente ou curta — integrações que guardam credencial (Clinicorp) ficam indisponíveis.",
    );
  }

  if (!process.env.BACKUP_ENCRYPTION_KEY) {
    warnings.push(
      "BACKUP_ENCRYPTION_KEY não configurada — os backups serão gravados SEM criptografia.",
    );
  }

  return warnings;
}
