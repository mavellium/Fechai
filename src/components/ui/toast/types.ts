/** Tipos do sistema de notificações (ver TOASTS.md). */

export type ToastKind = "loading" | "success" | "error" | "warning" | "info";

/** Estado de qualquer fluxo de salvamento — o mesmo vocabulário em toda tela. */
export type SaveStatus = "idle" | "loading" | "success" | "error";

export type ToastAction = {
  label: string;
  /** Navegação (ex.: `/login` na sessão expirada). */
  href?: string;
  /** Ação local (ex.: tentar novamente). Fecha o toast depois de executar. */
  onClick?: () => void;
};

export type ToastInput = {
  /**
   * Mesmo `id` = mesmo toast. É assim que "Salvando…" vira "Salvo!" no lugar,
   * sem empilhar duas mensagens para a mesma ação.
   */
  id?: string;
  kind: ToastKind;
  title: string;
  description?: string;
  /** ms até sumir sozinho; `null` fica até a pessoa fechar. Padrão por tipo. */
  duration?: number | null;
  action?: ToastAction;
};

export type Toast = Omit<ToastInput, "id" | "duration"> & {
  id: string;
  duration: number | null;
  /** Sobe a cada `show` com o mesmo id: reinicia o timer e reanuncia o texto. */
  revision: number;
};

/** Categoria da falha — decide título, ícone de contexto e se cabe "tentar de novo". */
export type FailureKind = "validation" | "auth" | "forbidden" | "network" | "server";

/**
 * Retorno padrão de Server Action de salvamento. É um superconjunto do
 * `{ ok, error, info }` que as actions do produto já devolvem, então nenhuma
 * action existente precisa mudar.
 */
export type ActionResult = {
  /** `true`/`string` = sucesso (a string, quando existe, é a própria mensagem). */
  ok?: boolean | string;
  error?: string;
  info?: string;
  /** Erros por campo (nome do campo → mensagem ou mensagens). */
  errors?: Record<string, string | string[] | undefined>;
  /** Classificação explícita, quando a action sabe (ex.: sessão expirada). */
  code?: FailureKind;
};

export type EntityGender = "m" | "f";

/** O que está sendo salvo — base de todas as mensagens personalizadas. */
export type SaveContext = {
  /** Substantivo em minúsculas, sem artigo: "cliente", "regras do agente". */
  entity: string;
  /** Padrão `save`. `create`/`update`/`delete` trocam o verbo. */
  action?: "save" | "create" | "update" | "delete";
  /** Concordância de "salvo/salva", "o/a". Padrão masculino. */
  gender?: EntityGender;
  plural?: boolean;
  /** Rótulos legíveis por campo, para "Preencha os campos: nome, e-mail". */
  fieldLabels?: Record<string, string>;
};
