import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getImpersonation } from "@/lib/impersonation";
import { requestContext } from "@/modules/auth/attempts";
import { diffFields, hasChanges } from "./diff";
import { AUDIT_EVENTS, eventDef, type AuditEvent } from "./events";
import { redactSnapshot } from "./redact";

/**
 * Escrita da trilha de auditoria.
 *
 * Duas regras que valem para tudo aqui:
 *
 * 1. **Nunca lança.** Auditar é observação: se a gravação falhar, a ação que
 *    estava sendo auditada continua. O contrário — o cliente não conseguir
 *    salvar a persona porque um índice do log quebrou — troca um problema de
 *    observabilidade por uma indisponibilidade do produto. Mesma regra de
 *    `modules/auth/attempts.ts`.
 * 2. **O chamador não monta o ator.** Quem fez, em qual conta e de qual IP sai
 *    da sessão e dos headers aqui dentro. Passar isso por parâmetro faria cada
 *    action repetir cinco linhas — e a primeira que esquecesse gravaria um log
 *    anônimo, que é pior que nenhum log.
 */

type Target = {
  /** Modelo do Prisma: "Agent", "Tenant", "Lead"… */
  type: string;
  id: string;
  /** Nome legível no momento do evento. */
  label?: string | null;
};

export type RecordAuditInput = {
  event: AuditEvent;
  target?: Target;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  /**
   * Sobrepõe o tenant resolvido pela sessão. Usado em dois casos: quando o
   * admin age sobre a conta de OUTRA pessoa (o tenant do log é o alvo, não o
   * do admin) e quando não há sessão (webhook, worker).
   */
  tenantId?: string | null;
  /** Ator explícito para caminhos sem sessão (worker, webhook, cron). */
  actor?: { id?: string | null; email?: string | null; role?: string } | null;
};

/**
 * Grava um evento. Silenciosa por contrato — o retorno é `void` e a falha vai
 * para o console, não para o chamador.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    const def = eventDef(input.event);
    if (!def) {
      // Evento fora do catálogo é bug de quem chamou, não do usuário: registra
      // no console e não grava, para a tabela não juntar chaves inventadas que
      // a tela não sabe rotular nem filtrar.
      console.error("[audit] evento desconhecido:", input.event);
      return;
    }

    const actor = await resolveActor(input.actor);
    const tenantId = input.tenantId !== undefined ? input.tenantId : actor.tenantId;
    const tenantName = tenantId ? await tenantNameOf(tenantId) : null;
    const context = await safeRequestContext();

    await prisma.auditLog.create({
      data: {
        tenantId: tenantId ?? null,
        tenantName,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        impersonated: actor.impersonated,
        event: input.event,
        kind: def.kind,
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        targetLabel: input.target?.label ?? null,
        before: toJson(input.before),
        after: toJson(input.after),
        meta: toJson(input.meta),
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        revertible: def.revertible === true,
      },
    });
  } catch (error) {
    console.error("[audit] não foi possível registrar o evento", input.event, error);
  }
}

export type RecordChangeInput = {
  event: AuditEvent;
  target: Target;
  /** Estado antes — normalmente o registro lido no começo da action. */
  before: Record<string, unknown> | null | undefined;
  /** Estado depois. Só as chaves aqui presentes entram na comparação. */
  after: Record<string, unknown> | null | undefined;
  meta?: Record<string, unknown>;
  tenantId?: string | null;
  actor?: RecordAuditInput["actor"];
};

/**
 * Grava uma ALTERAÇÃO, com o diff já calculado — e **não grava nada se nada
 * mudou**. É o que impede a trilha de encher de linhas em que a pessoa abriu a
 * tela, clicou em Salvar e não tocou em nada; um log assim fica ilegível
 * justamente quando é preciso achar a alteração que quebrou a conta.
 */
export async function recordChange(input: RecordChangeInput): Promise<void> {
  const diff = diffFields(input.before ?? null, input.after ?? null);
  if (!hasChanges(diff)) return;

  await recordAudit({
    event: input.event,
    target: input.target,
    before: diff.before,
    after: diff.after,
    meta: { ...input.meta, fields: diff.fields },
    tenantId: input.tenantId,
    actor: input.actor,
  });
}

/**
 * Grava uma EXCLUSÃO guardando a linha inteira em `before`, que é o que
 * `revertAuditLog` usa para recriar o registro com o mesmo id. Chamar **antes**
 * do delete, com o registro ainda em mãos: depois ele não existe mais para ser
 * lido.
 */
export async function recordDeletion(input: {
  event: AuditEvent;
  target: Target;
  /** A linha completa, como veio do Prisma. */
  snapshot: Record<string, unknown>;
  meta?: Record<string, unknown>;
  tenantId?: string | null;
}): Promise<void> {
  await recordAudit({
    event: input.event,
    target: input.target,
    before: input.snapshot,
    after: null,
    meta: input.meta,
    tenantId: input.tenantId,
  });
}

// ─────────────────────────────────────────────────────────── internos

type ResolvedActor = {
  id: string | null;
  email: string | null;
  role: string;
  tenantId: string | null;
  impersonated: boolean;
};

/**
 * Quem está agindo. Personificação é resolvida aqui, e não pela sessão crua: o
 * que interessa à auditoria é que **o admin** fez aquilo na conta do cliente.
 * Registrar o dono da conta como autor de uma mudança feita pelo suporte é
 * exatamente o erro que uma trilha de auditoria existe para não cometer.
 */
async function resolveActor(explicit: RecordAuditInput["actor"]): Promise<ResolvedActor> {
  if (explicit) {
    return {
      id: explicit.id ?? null,
      email: explicit.email ?? null,
      role: explicit.role ?? "SYSTEM",
      tenantId: null,
      impersonated: false,
    };
  }

  try {
    const session = await auth();
    if (!session?.user) {
      return { id: null, email: null, role: "SYSTEM", tenantId: null, impersonated: false };
    }

    const impersonation =
      session.user.role === "SUPERADMIN" ? await getImpersonation() : null;

    return {
      // Ator é sempre o humano real (o admin), mesmo personificando; o tenant
      // é o da conta em que ele está agindo.
      id: session.user.id ?? null,
      email: session.user.email ?? null,
      role: session.user.role ?? "OWNER",
      tenantId: impersonation?.tenantId ?? session.user.tenantId ?? null,
      impersonated: Boolean(impersonation),
    };
  } catch {
    return { id: null, email: null, role: "SYSTEM", tenantId: null, impersonated: false };
  }
}

/** Nome do tenant congelado na linha — sobrevive à exclusão da conta. */
async function tenantNameOf(tenantId: string): Promise<string | null> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return tenant?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * `requestContext()` lê `headers()`, que só existe dentro de uma request. Num
 * worker ou num job, chamá-la lança — e o log não pode cair por causa disso.
 */
async function safeRequestContext() {
  try {
    return await requestContext();
  } catch {
    return null;
  }
}

/** Passa pelo redator antes de virar coluna Json. */
function toJson(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return redactSnapshot(value) as object;
}

/** Reexport para quem só precisa do catálogo. */
export { AUDIT_EVENTS };
