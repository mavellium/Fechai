import type { ActionResult, EntityGender, FailureKind, SaveContext, ToastInput } from "./types";

/**
 * Textos das notificações de salvamento — funções puras, sem React, para que a
 * regra (concordância, classificação, o que nunca vai à tela) seja testável e
 * fique num lugar só. Tela nenhuma monta frase de "salvo com sucesso" à mão.
 */

const VERBS = {
  save: { infinitive: "salvar", gerund: "Salvando", participle: ["salvo", "salva"] },
  create: { infinitive: "criar", gerund: "Criando", participle: ["criado", "criada"] },
  update: { infinitive: "atualizar", gerund: "Atualizando", participle: ["atualizado", "atualizada"] },
  delete: { infinitive: "excluir", gerund: "Excluindo", participle: ["excluído", "excluída"] },
} as const;

function verbOf(ctx: SaveContext) {
  return VERBS[ctx.action ?? "save"];
}

function article(gender: EntityGender = "m", plural = false) {
  return gender === "f" ? (plural ? "as" : "a") : plural ? "os" : "o";
}

function participle(ctx: SaveContext) {
  const [m, f] = verbOf(ctx).participle;
  const base = ctx.gender === "f" ? f : m;
  return ctx.plural ? `${base}s` : base;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Salvando cliente…" */
export function loadingMessage(ctx: SaveContext): Pick<ToastInput, "kind" | "title"> {
  return { kind: "loading", title: `${verbOf(ctx).gerund} ${ctx.entity}…` };
}

/**
 * "Cliente salvo com sucesso!". A mensagem que a action devolveu (`info`, ou
 * `ok` como texto) vence: ela sabe mais do que o formulário ("Perfil
 * atualizado.", "Senha alterada.").
 */
export function successMessage(ctx: SaveContext, fromServer?: string | null): Pick<ToastInput, "kind" | "title"> {
  const title = fromServer?.trim() || `${capitalize(ctx.entity)} ${participle(ctx)} com sucesso!`;
  return { kind: "success", title };
}

/**
 * Um motivo vindo da API só vai à tela se parecer texto escrito para gente.
 * Stack, SQL, código de erro do Prisma, HTML e afins ficam de fora — a pessoa
 * recebe a frase genérica e o detalhe continua nos logs do servidor.
 */
const TECHNICAL =
  /\b(prisma|P\d{4}|ECONN\w*|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|stack|node_modules|constraint|SQLSTATE|NEXT_[A-Z_]+|digest|(Type|Reference|Syntax|Range)Error)\b|\bat\s+\S+\s+\(|\b(SELECT|INSERT|UPDATE|DELETE)\s+\w+|<\/?[a-z][^>]*>|Unexpected token|\[object /i;
const MAX_REASON = 240;

export function sanitizeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX_REASON || text.includes("\n")) return null;
  if (TECHNICAL.test(text)) return null;
  return text;
}

const AUTH = /sess[aã]o (expirou|expirada|inv[aá]lida)|fa[cç]a login|n[aã]o autenticad|unauthori[sz]ed/i;
const FORBIDDEN = /sem permiss[aã]o|n[aã]o tem permiss[aã]o|acesso negado|forbidden/i;
const NETWORK = /failed to fetch|network ?error|network request failed|load failed|sem conex[aã]o|offline/i;

export type FailureInput = {
  status?: number;
  code?: FailureKind;
  message?: string | null;
  errors?: ActionResult["errors"];
};

/** Decide a categoria: código explícito, depois status HTTP, campos, e por fim o texto. */
export function classifyFailure({ status, code, message, errors }: FailureInput): FailureKind {
  if (code) return code;
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 400 || status === 422) return "validation";
  if (status === 0) return "network";
  if (errors && Object.keys(errors).length > 0) return "validation";
  const text = message ?? "";
  if (AUTH.test(text)) return "auth";
  if (FORBIDDEN.test(text)) return "forbidden";
  if (NETWORK.test(text)) return "network";
  return "server";
}

function humanize(field: string) {
  return field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
}

/** Nomes de campo legíveis, na ordem em que a action os devolveu. */
export function invalidFieldNames(errors: ActionResult["errors"], labels: SaveContext["fieldLabels"] = {}): string[] {
  return Object.entries(errors ?? {})
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
    .map(([field]) => labels[field] ?? humanize(field));
}

export type FailureMessage = Pick<ToastInput, "kind" | "title" | "description"> & {
  failure: FailureKind;
  /** Vale oferecer "Tentar novamente"? Não vale se o problema é dado/sessão/permissão. */
  retryable: boolean;
};

/**
 * Mensagem de erro por categoria. O título diz o que aconteceu; a descrição, o
 * motivo real (quando é seguro mostrá-lo) e o que fazer agora.
 */
export function failureMessage(ctx: SaveContext, input: FailureInput): FailureMessage {
  const failure = classifyFailure(input);
  const reason = sanitizeReason(input.message);
  const target = `${article(ctx.gender, ctx.plural)} ${ctx.entity}`;
  const cannot = `Não foi possível ${verbOf(ctx).infinitive} ${target}.`;

  switch (failure) {
    case "validation": {
      const fields = invalidFieldNames(input.errors, ctx.fieldLabels);
      const description = fields.length
        ? `Preencha os campos obrigatórios: ${fields.join(", ")}.`
        : (reason ?? "Confira os dados informados e tente novamente.");
      return { failure, kind: "warning", title: "Confira os campos", description, retryable: false };
    }
    case "auth":
      return {
        failure,
        kind: "error",
        title: "Sua sessão expirou.",
        description: "Faça login novamente para continuar. O que você digitou continua na tela.",
        retryable: false,
      };
    case "forbidden":
      return {
        failure,
        kind: "error",
        title: `Você não tem permissão para ${verbOf(ctx).infinitive} ${target}.`,
        description: reason ?? "Peça acesso a quem administra a conta.",
        retryable: false,
      };
    case "network":
      return {
        failure,
        kind: "error",
        title: "Sem conexão com o servidor.",
        description: `${cannot} Verifique sua internet e tente novamente.`,
        retryable: true,
      };
    default:
      return {
        failure,
        kind: "error",
        title: cannot,
        description: reason ?? "Tente novamente em instantes.",
        retryable: true,
      };
  }
}

/** Classifica um retorno de action: `null` enquanto ainda não houve tentativa. */
export function readResult(result: ActionResult | null | undefined):
  | { status: "idle" }
  | { status: "success"; message: string | null }
  | { status: "error"; input: FailureInput } {
  if (!result) return { status: "idle" };
  const failed =
    result.ok === false || Boolean(result.error) || Boolean(result.code) || Object.keys(result.errors ?? {}).length > 0;
  if (failed) {
    return { status: "error", input: { code: result.code, message: result.error, errors: result.errors } };
  }
  if (result.ok || result.info) {
    return { status: "success", message: typeof result.ok === "string" ? result.ok : (result.info ?? null) };
  }
  return { status: "idle" };
}
