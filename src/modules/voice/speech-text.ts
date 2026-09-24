/**
 * O texto que vira FALA não é o mesmo texto que vira mensagem escrita.
 *
 * Escrevendo, "kkkk", "rsrs" e 😄 são pontuação emocional: o olho lê como tom,
 * não como palavra. Num TTS eles viram som — a Fish Audio recebe "kkkk" e
 * entrega uma gargalhada no meio do atendimento, sem nenhum motivo na conversa.
 * Foi essa a reclamação que deu origem a este arquivo: o agente "dando risada"
 * em resposta a um cliente que só perguntou um preço.
 *
 * Por isso a limpeza acontece SÓ no caminho do áudio. `Message.content` continua
 * sendo o texto original (é ele que vai para o histórico, para o resumo, para a
 * busca e para o próximo turno do LLM, ver `modules/voice/README.md`) — aqui a
 * gente só decide o que a boca do agente pronuncia.
 *
 * A regra vive em módulo próprio, e não dentro de `fish.ts`, porque não é regra
 * da Fish Audio: qualquer provedor de voz teria o mesmo problema com "kkkk".
 * Trocar de provedor não deve levar isto junto.
 *
 * Isto NÃO é filtro de conteúdo nem tenta reescrever a resposta. Se sobrar
 * dúvida entre remover e manter, mantém: falar de leve errado é muito melhor
 * que engolir metade da frase do atendimento.
 *
 * Em cima da limpeza padrão vem a lista do agente (`Agent.speechBlocklist`,
 * editada em Agentes › Comportamento). Ela SOMA, nunca substitui: a risada
 * escrita sai em qualquer conta, e a lista existe para o que é daquele negócio
 * — bordão, apelido, muleta que o LLM repete. Por isso ela também não serve
 * para proibir assunto: quem manda no que o agente DIZ é a persona (as Regras
 * viram instrução no prompt); aqui a frase já está pronta, e tirar uma palavra
 * de conteúdo só deixaria a fala torta. Cabe interjeição e ruído, não "não".
 */

/**
 * Risada escrita, nas formas que aparecem de verdade em conversa de WhatsApp
 * em português.
 *
 * Todas exigem repetição ou 2+ letras justamente para não morder palavra real:
 * "kk" mínimo deixa o "ok" em paz, e `(h[aeiou]){2,}` não pega "hoje" nem
 * "humano" (precisam de duas sílabas h+vogal seguidas).
 */
const RISADA_ESCRITA: RegExp[] = [
  // kkk, KKKK, kkkkkkkk
  /\bk{2,}\b/gi,
  // haha, hehe, hihi, ahahah, hahahaha
  /\ba?(?:h[aeiou]){2,}h?\b/gi,
  // huehue, huehuehue
  /\b(?:hue){2,}\b/gi,
  // rsrs, rsrsrs
  /\b(?:rs){2,}\b/gi,
  // "rs" sozinho, só em minúsculo: "RS" maiúsculo é o estado ("Porto Alegre - RS"),
  // e tirar isso de um endereço faria o agente falar um endereço pela metade.
  /\brs\b/g,
];

/**
 * Marcação de rubrica: "(risos)", "[risada]", "*gargalhada*", "(laughs)".
 *
 * O LLM às vezes escreve isso achando que é uma anotação de cena. No texto é
 * ruído; no áudio é pior, porque modelos de voz expressiva (a família s2 da
 * Fish é uma delas) tratam parênteses desse tipo como INSTRUÇÃO e de fato dão
 * a risada pedida.
 */
const RUBRICA_DE_RISADA =
  /[([{*]\s*(?:risos?|risadas?|gargalhadas?|laugh(?:s|ing)?|haha+|kkk+)\s*[)\]}*]/gi;

/**
 * Emoji não tem pronúncia. Dependendo do normalizador ele some (e a frase perde
 * o tom que quem escreveu quis dar) ou vira uma leitura literal do nome —
 * "rosto sorrindo com olhos de coração" no meio de um orçamento. Fora, nos dois
 * casos.
 *
 * Mesmos code points de `lib/emoji.ts`: os componentes de junção (ZWJ, seletor
 * de variação, keycap) entram explícitos porque não são pictográficos sozinhos.
 */
const EMOJI = /[\p{Extended_Pictographic}️‍⃣]/gu;

/**
 * Formatação do WhatsApp/markdown: *negrito*, _itálico_, ~riscado~, `código`.
 *
 * Os delimitadores só existem para o olho. Vão embora com o conteúdo intacto.
 */
const ENFASE = /([*_~`])(\S|\S[^*_~`]*?\S)\1/g;

/** Linha que sobrou só com pontuação depois das remoções ("!!!", "— ", ":"). */
const SO_PONTUACAO = /^[\s.,!?;:…\-—–"'()[\]{}*_~`]+$/;

const MONTHS = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Só expande padrões inequívocos para não transformar telefones ou frações. */
function expandDatesAndMidnight(value: string): string {
  const dates = value.replace(
    /(?<![\d/])(\d{1,2})\/(\d{2})(?:\/(\d{4}))?(?![\d/])/g,
    (match, dayRaw: string, monthRaw: string, yearRaw?: string) => {
      const day = Number(dayRaw);
      const month = Number(monthRaw);
      const year = yearRaw ? Number(yearRaw) : 2024;
      if (month < 1 || month > 12 || day < 1 ||
        day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return match;
      return `${day} de ${MONTHS[month]}${yearRaw ? ` de ${yearRaw}` : ""}`;
    },
  );
  return dates
    .replace(/\b0{1,2}(?:h|:)([0-5]\d)?\b/gi, (match, minuteRaw?: string) => {
      if (match.includes(":") && minuteRaw === undefined) return match;
      const minute = Number(minuteRaw ?? 0);
      return minute === 0 ? "meia-noite" : minute === 30
        ? "meia-noite e meia" : `meia-noite e ${minute} minutos`;
    })
    .replace(/às\s+meia-noite/gi, "à meia-noite");
}

/**
 * Teto da lista por agente. Não é limite de produto — é limite de trabalho: são
 * regex rodando em cada resposta falada, e uma lista de centenas de termos
 * colada de uma planilha atrasaria o áudio sem ninguém entender por quê.
 */
const MAX_TERMOS = 40;
/** Termo de 1 letra ("a", "e") casaria com meia conversa. Dois é o piso útil. */
const MIN_TERMO = 2;
const MAX_TERMO = 60;

/** Uma lista crua (um termo por linha, como vem do banco) virando termos usáveis. */
export function parseSpeechBlocklist(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const vistos = new Set<string>();
  for (const linha of raw.split("\n")) {
    const termo = linha.trim();
    if (termo.length < MIN_TERMO || termo.length > MAX_TERMO) continue;
    // Sem distinção de maiúscula: quem digita "Kkk" quer "kkk" fora também.
    const chave = termo.toLowerCase();
    if (!vistos.has(chave)) vistos.add(chave);
    if (vistos.size >= MAX_TERMOS) break;
  }
  return [...vistos];
}

/** `.` e `(` digitados pela pessoa são texto, não sintaxe de regex. */
function escaparRegex(termo: string): string {
  return termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Termo digitado pelo dono → regex que casa a palavra inteira.
 *
 * Sem `\b`: o `\w` do JavaScript é ASCII, então "né" ou "tá" (que terminam em
 * letra acentuada) nunca casariam direito. A borda é feita à mão com
 * `[^\p{L}\p{N}]`, que entende acento — e o grupo da esquerda é devolvido no
 * replace para não comer o espaço/pontuação que segurava a frase.
 */
function regexDoTermo(termo: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaparRegex(termo)}(?=$|[^\\p{L}\\p{N}])`, "giu");
}

/**
 * Prepara o texto para ser falado. Nunca lança; no pior caso devolve "".
 *
 * `blocklist` é a lista do agente (`Agent.speechBlocklist`, um termo por linha
 * ou já em array) e soma-se ao padrão — nunca o substitui: a risada escrita sai
 * de todo jeito, porque ninguém deveria ter que descobrir sozinho que precisa
 * digitar "kkkk" para o agente parar de rir.
 *
 * String vazia é uma resposta legítima e significa "não há nada para falar"
 * (aconteceu de a resposta inteira ser "kkkkk"). Quem chama trata: no envio
 * automático a resposta sai em texto, que é o piso de sempre.
 */
export function toSpeech(text: string, blocklist: string | string[] = ""): string {
  let out = text ?? "";

  out = out.replace(RUBRICA_DE_RISADA, " ");
  for (const risada of RISADA_ESCRITA) out = out.replace(risada, " ");
  out = out.replace(EMOJI, " ");
  out = out.replace(ENFASE, "$2");
  out = expandDatesAndMidnight(out);

  // A lista do agente entra depois da limpeza padrão: os termos dela são o que
  // aquele negócio não quer ouvir, não o que todo mundo não quer.
  const termos = Array.isArray(blocklist)
    ? parseSpeechBlocklist(blocklist.join("\n"))
    : parseSpeechBlocklist(blocklist);
  for (const termo of termos) out = out.replace(regexDoTermo(termo), "$1");

  // "Oi!!!" e "sério???" são ênfase de teclado: repetidos, viram pausa estranha
  // ou entonação exagerada. Um basta.
  out = out.replace(/([!?])\1+/g, "$1");
  out = out.replace(/\.{4,}/g, "...");

  // Costura o que sobrou: as remoções deixam espaço antes da vírgula, pontuação
  // dobrada ("preço, , quando") e espaço duplo no meio da frase.
  out = out
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,.!?;:])(?:\s*\1)+/g, "$1")
    .replace(/([,;:])(\s*[.!?])/g, "$2");

  return out
    .split("\n")
    // Vírgula pendurada no fim da linha é resto de remoção ("beleza então, né"
    // sem o "né"). Falada, ela não existe — a pausa de fim de frase é a mesma.
    .map((linha) => linha.trim().replace(/[,;\-–—]+$/, "").trim())
    .filter((linha) => linha.length > 0 && !SO_PONTUACAO.test(linha))
    .join("\n")
    .trim();
}
