/**
 * Texto das perguntas: limpeza, chave de agrupamento sem embeddings e a
 * duração legível do "tempo para responder". Puro — a tela e os testes
 * importam daqui.
 */

export const MAX_QUESTION = 300;
export const MAX_ANSWER = 4000;
export const MAX_RESUME_MESSAGE = 1000;

/**
 * Distância de cosseno máxima para duas perguntas virarem o mesmo assunto.
 *
 * Conservadora de propósito: juntar "quanto custa implante?" com "quanto custa
 * clareamento?" faz a equipe responder uma e a outra sumir da fila. Separar
 * paráfrases só custa um item a mais, que a equipe responde igual. O valor
 * serve aos dois modelos de embedding da plataforma (Gemini e OpenAI): no
 * Gemini as distâncias são menores, e perguntas vizinhas do mesmo assunto já
 * chegam perto de 0,2.
 */
export const GROUP_MAX_DISTANCE = 0.15;

/** Uma linha, sem espaço sobrando, no tamanho que cabe na fila. */
export function cleanQuestion(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const line = raw.replace(/\s+/g, " ").trim();
  return line.length > MAX_QUESTION ? `${line.slice(0, MAX_QUESTION - 1).trimEnd()}…` : line;
}

/**
 * Chave de agrupamento quando não há embeddings: minúsculas, sem acento, sem
 * pontuação. Pega "Aceita Unimed?" e "aceita unimed" — não pega paráfrase,
 * que é trabalho do vetor.
 */
export function normalizeQuestion(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** "12 min", "3 h 20 min", "2 dias e 4 h". Null = sem dado. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return `${days} ${days === 1 ? "dia" : "dias"}${h ? ` e ${h} h` : ""}`;
}

/** Título do documento que a aprovação cria na base. */
export function answerDocumentTitle(question: string): string {
  const q = cleanQuestion(question);
  return `Pergunta respondida: ${q.length > 100 ? `${q.slice(0, 99).trimEnd()}…` : q}`;
}

/**
 * Conteúdo do documento: pergunta e resposta juntas no mesmo trecho, para o
 * RAG achar a resposta pela pergunta parecida que vier depois.
 */
export function answerDocumentContent(question: string, answer: string): string {
  return `Pergunta frequente de contatos: ${cleanQuestion(question)}\nResposta aprovada pela equipe: ${answer.trim()}`;
}

/** Texto sugerido para retomar quem ficou sem resposta. Editável na tela. */
export function defaultResumeMessage(answer: string): string {
  return `Olá! Voltando à sua pergunta: ${answer.trim()}`.slice(0, MAX_RESUME_MESSAGE);
}

/**
 * Célula "tempo médio para a equipe responder" do relatório mensal (tela e
 * PDF). Sem o campo é relatório fechado antes da fila existir; nenhuma
 * aprovada no mês não é tempo zero.
 */
export function formatGapTime(m: { gapAnswerSeconds?: number | null; gapsAnswered?: number }): string {
  if (m.gapAnswerSeconds === undefined) return "Sem registro";
  if (m.gapAnswerSeconds === null) return "Nenhuma aprovada";
  const n = m.gapsAnswered ?? 0;
  return `${formatDuration(m.gapAnswerSeconds)} · ${n} ${n === 1 ? "aprovada" : "aprovadas"}`;
}

/** Versão curta para a célula do PDF: " · 3h", " · 2d". Vazia sem dado. */
export function formatGapTimeShort(m: { gapAnswerSeconds?: number | null }): string {
  const s = m.gapAnswerSeconds;
  if (s === undefined || s === null || !Number.isFinite(s)) return "";
  const minutes = Math.max(1, Math.round(s / 60));
  if (minutes < 60) return ` · ${minutes}min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? ` · ${hours}h` : ` · ${Math.round(hours / 24)}d`;
}
