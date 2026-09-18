/**
 * Bloqueio de números: contatos que o agente simplesmente ignora.
 *
 * "Ignorar" aqui é literal e é o ponto todo: a mensagem não vira conversa, não
 * vira lead, não gasta LLM e **não recebe resposta nenhuma** — nem um "não
 * posso falar". Quem foi bloqueado não deve descobrir que foi; um aviso
 * automático transformaria o bloqueio num convite a insistir.
 *
 * Por que uma tabela e não uma flag no Lead: o caso comum é bloquear um número
 * que ainda não escreveu (o ex-fornecedor que vai ligar, o número de spam que
 * já mandou para o vizinho). Esperar virar lead para poder bloquear chegaria
 * sempre tarde demais — e o filtro precisa rodar ANTES de criar lead/conversa.
 */

import { prisma } from "@/lib/prisma";

/** Teto por conta. Existe para conter engano de colar uma lista inteira, não
 *  para racionar: quem bloqueia mais que isso está querendo outra coisa
 *  (ignorar grupos, pausar o agente) e a tela sugere isso no erro. */
export const MAX_BLOCKED_NUMBERS = 200;

/**
 * Forma canônica usada para comparar dois números.
 *
 * O dono digita "(11) 98765-4321"; o WhatsApp entrega "5511987654321" no JID.
 * Comparar as duas strings nunca casaria, e é exatamente esse o bug silencioso
 * que este bloqueio não pode ter: uma tela dizendo "bloqueado" com o agente
 * respondendo normalmente.
 *
 * A regra: só dígitos, sem o `55` do Brasil e **sem o nono dígito** de celular.
 * O nono dígito é o detalhe que morde — o mesmo aparelho aparece como
 * `5511987654321` ou `551187654321` conforme a origem, e o WhatsApp
 * historicamente entrega os dois. Reduzir ao DDD + 8 últimos dígitos faz as
 * duas formas colidirem de propósito.
 *
 * Fora do Brasil (ou número curto/estranho) os dígitos passam inteiros: sem
 * saber o país não dá para cortar nada com segurança, e cortar errado
 * bloquearia um número que ninguém pediu.
 */
export function canonicalPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  // Brasil: 55 + DDD (2) + 8 ou 9 dígitos.
  const withoutCountry =
    digits.length >= 12 && digits.length <= 13 && digits.startsWith("55")
      ? digits.slice(2)
      : digits;

  // DDD + 9 dígitos (celular com o nono): descarta o nono para casar com a
  // forma antiga do mesmo aparelho.
  if (withoutCountry.length === 11 && withoutCountry[2] === "9") {
    return withoutCountry.slice(0, 2) + withoutCountry.slice(3);
  }

  return withoutCountry;
}

/** Número plausível o bastante para virar regra de bloqueio. Curto demais
 *  casaria com muita coisa por causa da canonicalização — "9" bloquearia
 *  qualquer um. */
export function isBlockablePhone(value: string): boolean {
  return canonicalPhone(value).length >= 8;
}

/**
 * Este número está bloqueado nesta conta?
 *
 * Consulta por chave única (tenantId + forma canônica) — é o que justifica a
 * tabela: roda a cada mensagem que entra no webhook.
 *
 * **Nunca lança.** Mesma regra do resto do caminho da conversa: banco fora do
 * ar não pode virar 500 no webhook (a Evolution reentrega em laço). Na dúvida
 * o número NÃO está bloqueado — deixar passar uma mensagem de quem foi
 * bloqueado é um incômodo; engolir a mensagem de um cliente real por causa de
 * uma falha de leitura é perder a venda.
 */
export async function isPhoneBlocked(tenantId: string, phone: string): Promise<boolean> {
  const canonical = canonicalPhone(phone);
  if (!canonical) return false;

  try {
    const hit = await prisma.whatsappBlockedNumber.findUnique({
      where: { tenantId_phone: { tenantId, phone: canonical } },
      select: { id: true },
    });
    return Boolean(hit);
  } catch (err) {
    console.error("[whatsapp blocklist] falha ao consultar bloqueio", err);
    return false;
  }
}

export type BlockedNumber = {
  id: string;
  /** Forma canônica guardada (só dígitos) — use `formatBlockedPhone` na tela. */
  phone: string;
  label: string | null;
  createdAt: Date;
};

export async function listBlockedNumbers(tenantId: string): Promise<BlockedNumber[]> {
  return prisma.whatsappBlockedNumber.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, phone: true, label: true, createdAt: true },
  });
}

/**
 * Exibe o número canônico de volta em forma de telefone BR. O nono dígito foi
 * descartado na entrada de propósito (ver `canonicalPhone`), então o que se
 * mostra é "(11) 8765-4321" mesmo quando a pessoa digitou o celular com nove —
 * a alternativa seria guardar as duas formas e ter que explicar qual vale.
 */
export function formatBlockedPhone(canonical: string): string {
  // Só 10 dígitos: depois de `canonicalPhone` um número BR é sempre DDD + 8. Um
  // canônico de 11 é estrangeiro (o `+1 415...` da vida) e vestir máscara de
  // DDD nele mostraria um número que não existe.
  if (canonical.length === 10) {
    return canonical.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }
  return canonical;
}
