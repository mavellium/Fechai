/**
 * Formatação de data/telefone para a interface, em pt-BR.
 *
 * O painel mostrava datas cruas (`toLocaleDateString`) e nenhum tempo relativo —
 * numa caixa de entrada, "há 12 minutos" responde a pergunta que "31/07/2026"
 * não responde: isso é recente?
 */

const RELATIVE = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "agora", "há 12 minutos", "há 3 dias". */
export function relativeTime(date: Date, now: Date = new Date()) {
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);

  if (abs < MINUTE) return "agora";
  if (abs < HOUR) return RELATIVE.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return RELATIVE.format(Math.round(diff / HOUR), "hour");
  if (abs < 30 * DAY) return RELATIVE.format(Math.round(diff / DAY), "day");
  return dateLabel(date);
}

/** Versão curta para listas apertadas: "12min", "3h", "5d", "12 jul". */
export function shortAge(date: Date, now: Date = new Date()) {
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return "agora";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}min`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date);
}

/** "12 de julho de 2026". */
export function dateLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(date);
}

/** "12 jul, 14:32". */
export function dateTimeLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** "14:32" — horário de envio de uma mensagem no histórico. */
export function timeLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Moeda em reais a partir de centavos: "R$ 1.234,56". Visão Financeira de /relatorios. */
export function formatBRL(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Separador de dia dentro do histórico: "hoje", "ontem" ou a data. */
export function dayLabel(date: Date, now: Date = new Date()) {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(date)) / DAY);
  if (days === 0) return "hoje";
  if (days === 1) return "ontem";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long" }).format(date);
}

/**
 * O chat de teste cria um lead com telefone sintético — "sandbox" nas contas
 * antigas, "sandbox:<agentId>" desde que o teste passou a ser por agente (ver
 * `api/sandbox/route.ts`). Nenhum dos dois é um número: não dá para ligar nem
 * abrir no WhatsApp, e a interface precisa saber antes de oferecer a ação.
 */
export function isSandboxPhone(phone: string) {
  return phone === "sandbox" || phone.startsWith("sandbox:");
}

/** Telefone formatado para leitura: "(11) 98765-4321" quando reconhecível. */
export function phoneLabel(phone: string) {
  if (isSandboxPhone(phone)) return "teste no sandbox";
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

/** Link de conversa direta no WhatsApp, ou `null` quando não há número real. */
export function waLink(phone: string) {
  if (isSandboxPhone(phone)) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `https://wa.me/${digits}`;
}
