import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AUDIT_GROUPS, AUDIT_EVENTS, eventLabel, type AuditGroup } from "./events";

/**
 * Leitura da trilha para o painel do admin.
 *
 * Paginação por CURSOR, não por `skip`/`take`: a tabela cresce por cima (evento
 * novo entra no topo), e um offset numa lista que muda enquanto se navega pula
 * e repete linhas. Com cursor, "carregar mais" continua exatamente de onde
 * parou mesmo que dez eventos tenham chegado no meio.
 */

/**
 * Recorte da trilha.
 *
 * Listas, não valores únicos, nos campos de recorte: dentro do mesmo campo os
 * valores são OU ("admin OU sistema"), e entre campos, E — a mesma regra da
 * lista de contas, porque a pergunta real de quem investiga costuma ser
 * composta. Lista vazia = campo não filtra.
 */
export type AuditFilters = {
  /** Busca em e-mail do ator, nome da conta, rótulo do alvo e IP. */
  search?: string;
  /** Chaves de evento (`AUDIT_EVENTS`). */
  events?: string[];
  /** Grupos do catálogo — atalho para "todos os eventos de agente". */
  groups?: AuditGroup[];
  /** "admin" | "cliente" | "sistema" — quem agiu. */
  actors?: string[];
  /** create | update | delete | auth | access — a natureza do evento. */
  kinds?: string[];
  tenantId?: string;
  actorId?: string;
  /** Só o que ainda pode ser desfeito. */
  onlyRevertible?: boolean;
  /** Janela: dias para trás a partir de agora. */
  days?: number;
  cursor?: string;
  take?: number;
};

export const AUDIT_PAGE_SIZE = 50;
/** Teto absoluto: o `take` vem da URL e um número livre varreria a tabela. */
const MAX_PAGE_SIZE = 200;

export type AuditRow = Awaited<ReturnType<typeof listAuditLogs>>["rows"][number];

export async function listAuditLogs(filters: AuditFilters = {}) {
  const take = Math.min(filters.take ?? AUDIT_PAGE_SIZE, MAX_PAGE_SIZE);
  const where = buildWhere(filters);

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    // Uma linha a mais que a página só para saber se existe próxima — mais
    // barato que um count() sobre a tabela inteira a cada carregamento.
    take: take + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      createdAt: true,
      event: true,
      kind: true,
      tenantId: true,
      tenantName: true,
      actorId: true,
      actorEmail: true,
      actorRole: true,
      impersonated: true,
      targetType: true,
      targetId: true,
      targetLabel: true,
      before: true,
      after: true,
      meta: true,
      ip: true,
      revertible: true,
      revertedAt: true,
      revertedByEmail: true,
    },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return {
    rows: page.map((row) => ({ ...row, label: eventLabel(row.event) })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getAuditLog(id: string) {
  const row = await prisma.auditLog.findUnique({ where: { id } });
  return row ? { ...row, label: eventLabel(row.event) } : null;
}

/** Últimos eventos de uma conta — usado no painel lateral de /admin/contas. */
export async function recentTenantActivity(tenantId: string, take = 8) {
  const rows = await prisma.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      event: true,
      actorEmail: true,
      actorRole: true,
      impersonated: true,
      targetLabel: true,
    },
  });
  return rows.map((row) => ({ ...row, label: eventLabel(row.event) }));
}

/** Rótulo da tela → papel gravado na linha. */
const ACTOR_ROLE: Record<string, string> = {
  admin: "SUPERADMIN",
  cliente: "OWNER",
  sistema: "SYSTEM",
};

function buildWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  const and: Prisma.AuditLogWhereInput[] = [];

  if (filters.tenantId) where.tenantId = filters.tenantId;
  if (filters.actorId) where.actorId = filters.actorId;

  // Grupos e eventos se combinam pela INTERSEÇÃO: escolher o grupo "Agente" e
  // o evento "Excluiu um agente" deve devolver só a exclusão, não o grupo
  // inteiro. Dentro de cada um deles, porém, vale a união — "Agente OU Conta".
  const eventKeys = new Set<string>();
  if (filters.groups?.length) {
    for (const [key, def] of Object.entries(AUDIT_EVENTS)) {
      if (filters.groups.includes(def.group)) eventKeys.add(key);
    }
  }
  if (filters.events?.length) {
    const chosen = filters.events.filter((e) => e in AUDIT_EVENTS);
    if (chosen.length) {
      if (eventKeys.size) {
        for (const key of [...eventKeys]) if (!chosen.includes(key)) eventKeys.delete(key);
      } else {
        chosen.forEach((key) => eventKeys.add(key));
      }
    }
  }
  if (eventKeys.size) where.event = { in: [...eventKeys] };

  // O papel guardado na linha, não o rótulo da tela: "cliente" é OWNER,
  // "admin" é SUPERADMIN, "sistema" é o que a plataforma faz sozinha.
  if (filters.actors?.length) {
    const roles = filters.actors
      .map((a) => ACTOR_ROLE[a])
      .filter((r): r is string => Boolean(r));
    if (roles.length) where.actorRole = { in: roles };
  }

  if (filters.kinds?.length) where.kind = { in: filters.kinds };

  // "Ainda pode ser desfeito" é revertível E não revertido: um evento já
  // desfeito continua revertible=true na linha (é um fato sobre o evento),
  // mas não é mais uma pendência para o admin.
  if (filters.onlyRevertible) {
    where.revertible = true;
    where.revertedAt = null;
  }

  if (filters.days && filters.days > 0) {
    where.createdAt = { gte: new Date(Date.now() - filters.days * 86_400_000) };
  }

  const search = filters.search?.trim();
  if (search) {
    and.push({
      OR: [
        { actorEmail: { contains: search, mode: "insensitive" } },
        { tenantName: { contains: search, mode: "insensitive" } },
        { targetLabel: { contains: search, mode: "insensitive" } },
        { ip: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  if (and.length) where.AND = and;
  return where;
}

/** Opções do filtro, montadas do catálogo — nunca uma lista paralela na tela. */
export function auditFilterOptions() {
  return {
    groups: (Object.keys(AUDIT_GROUPS) as AuditGroup[]).map((key) => ({
      key,
      label: AUDIT_GROUPS[key],
    })),
  };
}

/**
 * Retenção. A trilha é um registro operacional, não um arquivo permanente:
 * sem poda ela cresce sem teto e a tela fica lenta justamente quando é
 * consultada por causa de um incidente.
 *
 * O que foi revertido, e o que registra exclusão, tem vida mais longa: são as
 * linhas que alguém volta a procurar meses depois.
 */
export async function pruneAuditLogs(days = 180): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      kind: { notIn: ["delete"] },
      revertedAt: null,
    },
  });
  return result.count;
}
