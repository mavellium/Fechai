import { createHash } from "node:crypto";
import { redis } from "@/lib/redis";

/**
 * Limitador de taxa genérico, em Redis — para endpoints que não são o login
 * (que tem freio próprio, progressivo, em `lib/login-throttle`).
 *
 * Janela fixa, não deslizante: para conter abuso de formulário público é
 * suficiente e custa uma operação só. O Redis é o que permite o limite valer
 * de verdade com mais de uma instância da aplicação no ar — um contador em
 * memória seria contornado só por cair em outro processo.
 */
export type RateLimitResult = {
  allowed: boolean;
  /** Segundos até a janela virar. 0 quando ainda há saldo. */
  retryAfterSeconds: number;
};

const ALLOWED: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };

/**
 * `scope` separa os contadores (ex.: "reset:ip" e "reset:email") e `subject` é
 * quem está sendo contado. O subject é hasheado: e-mail em claro numa chave do
 * Redis vira lista de clientes para quem tiver acesso ao cache.
 */
export async function rateLimit(
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const digest = createHash("sha256").update(subject).digest("base64url").slice(0, 24);
  const key = `rl:${scope}:${digest}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    if (count <= limit) return ALLOWED;

    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  } catch (error) {
    // Mesma escolha do freio de login: cache fora do ar não pode virar
    // indisponibilidade do produto.
    console.error(`[rate-limit] Redis indisponível em "${scope}" — liberando:`, error);
    return ALLOWED;
  }
}

/** "1 minuto", "15 minutos" — texto pronto para a mensagem de erro. */
export function formatWait(seconds: number): string {
  if (seconds <= 60) return "1 minuto";
  return `${Math.ceil(seconds / 60)} minutos`;
}
