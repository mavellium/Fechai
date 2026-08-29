import { createHash } from "node:crypto";
import { redis } from "@/lib/redis";

/**
 * Freio de força bruta do login.
 *
 * A contagem é por **e-mail + IP**, não por IP puro. Numa rede compartilhada
 * (escritório, coworking, operadora com CGNAT) bloquear o IP inteiro derruba
 * gente que nunca errou a senha — e não protege muito mais, já que quem ataca
 * de verdade troca de IP. O par e-mail+IP pune a tentativa repetida contra uma
 * conta específica, que é o ataque real.
 *
 * Login bem-sucedido zera o contador. Isso é essencial: sem isso, quem erra a
 * senha algumas vezes e depois acerta continua contando falhas e é bloqueado
 * na próxima vez que errar uma letra.
 *
 * Mora no Redis (não no Postgres) porque é estado quente com validade curta:
 * expira sozinho, não cresce e não precisa de limpeza. A trilha permanente,
 * para auditoria, é a tabela `LoginAttempt`.
 */

/** Sem novas tentativas por esse tempo, o contador zera sozinho. */
const FAILURE_WINDOW_SECONDS = 30 * 60;

/**
 * Penalidade progressiva: as primeiras falhas passam batido (errar a senha é
 * normal), e a espera cresce rápido depois disso. Ler como "a partir de N
 * falhas, espere S segundos".
 */
const PENALTY_LADDER: readonly { failures: number; seconds: number }[] = [
  { failures: 10, seconds: 30 * 60 },
  { failures: 8, seconds: 5 * 60 },
  { failures: 6, seconds: 2 * 60 },
  { failures: 5, seconds: 60 },
];

/**
 * Rede de proteção contra *spray* (um IP tentando muitas contas diferentes com
 * senhas comuns), que escapa do contador por conta. O teto é folgado de
 * propósito — um escritório inteiro errando senha no mesmo dia não chega perto.
 */
const IP_SPRAY_LIMIT = 30;
const IP_SPRAY_WINDOW_SECONDS = 15 * 60;
const IP_SPRAY_BLOCK_SECONDS = 15 * 60;

export type LoginBlock = {
  blocked: boolean;
  /** Segundos até liberar. 0 quando não está bloqueado. */
  retryAfterSeconds: number;
  /** Falhas acumuladas na janela — alimenta o aviso de "última tentativa". */
  failures: number;
};

const FREE: LoginBlock = { blocked: false, retryAfterSeconds: 0, failures: 0 };

/**
 * O e-mail não vai em claro para a chave: o Redis pode aparecer num dump de
 * memória ou num `KEYS *` de suporte, e a lista de quem errou a senha não
 * precisa ser legível ali.
 */
function identityKey(email: string, ip: string) {
  const digest = createHash("sha256")
    .update(`${email.trim().toLowerCase()}|${ip}`)
    .digest("base64url")
    .slice(0, 24);
  return `login:id:${digest}`;
}

function ipKey(ip: string) {
  return `login:ip:${createHash("sha256").update(ip).digest("base64url").slice(0, 24)}`;
}

function penaltyFor(failures: number): number {
  return PENALTY_LADDER.find((step) => failures >= step.failures)?.seconds ?? 0;
}

/**
 * Redis fora do ar não pode trancar o produto inteiro: sem ele o login segue
 * funcionando (a senha ainda é verificada) e a tentativa continua indo para
 * `LoginAttempt`. Falhar fechado transformaria uma queda de cache em uma queda
 * de autenticação.
 */
async function tolerate<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error("[login-throttle] Redis indisponível — seguindo sem o freio:", error);
    return fallback;
  }
}

async function blockStatus(key: string): Promise<number> {
  const ttl = await redis.pttl(`${key}:blk`);
  return ttl > 0 ? Math.ceil(ttl / 1000) : 0;
}

/**
 * Consulta sem efeito colateral — usada pela tela de login para avisar antes do
 * envio e para explicar a espera depois de uma falha. Não incrementa nada.
 */
export async function peekLoginBlock(email: string, ip: string): Promise<LoginBlock> {
  return tolerate(async () => {
    const key = identityKey(email, ip);
    const [identitySeconds, spraySeconds, rawFailures] = await Promise.all([
      blockStatus(key),
      blockStatus(ipKey(ip)),
      redis.get(`${key}:fail`),
    ]);

    const retryAfterSeconds = Math.max(identitySeconds, spraySeconds);
    return {
      blocked: retryAfterSeconds > 0,
      retryAfterSeconds,
      failures: Number(rawFailures ?? 0),
    };
  }, FREE);
}

/** Registra uma falha e devolve o estado já atualizado. */
export async function registerLoginFailure(email: string, ip: string): Promise<LoginBlock> {
  return tolerate(async () => {
    const key = identityKey(email, ip);
    const spray = ipKey(ip);

    const [failures, ipFailures] = await Promise.all([
      redis.incr(`${key}:fail`),
      redis.incr(`${spray}:fail`),
    ]);

    // A janela é reiniciada a cada falha: tentar de novo mantém o contador
    // vivo, parar de tentar deixa ele morrer.
    await Promise.all([
      redis.expire(`${key}:fail`, FAILURE_WINDOW_SECONDS),
      redis.expire(`${spray}:fail`, IP_SPRAY_WINDOW_SECONDS),
    ]);

    const penalty = penaltyFor(failures);
    if (penalty > 0) await redis.set(`${key}:blk`, "1", "EX", penalty);
    if (ipFailures >= IP_SPRAY_LIMIT) {
      await redis.set(`${spray}:blk`, "1", "EX", IP_SPRAY_BLOCK_SECONDS);
    }

    const retryAfterSeconds = Math.max(penalty, await blockStatus(spray));
    return { blocked: retryAfterSeconds > 0, retryAfterSeconds, failures };
  }, FREE);
}

/**
 * Entrou: some com o contador e com o bloqueio daquela identidade. O contador
 * do IP fica de pé — ele mede o IP, não a conta, e um acerto isolado no meio de
 * um spray não é motivo para liberar o resto.
 */
export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  await tolerate(async () => {
    const key = identityKey(email, ip);
    await redis.del(`${key}:fail`, `${key}:blk`);
  }, undefined);
}

/** "1 minuto", "5 minutos" — texto pronto para a mensagem de erro. */
export function formatRetryAfter(seconds: number): string {
  if (seconds <= 60) return "1 minuto";
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minutos`;
}
