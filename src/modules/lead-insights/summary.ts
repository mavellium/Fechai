import { IDLE_LOSS_KEY, doubtLabel, lossLabel } from "./categories";
import { classifyCity, type ServiceArea } from "./service-area";

/**
 * Qualidade dos leads: agrega o que o agente registrou (`ConversationInsight`)
 * com o que o sistema já sabe (agendamento, transbordo, perda) e responde
 * "quanto da verba comprou lead que não converte, e por quê". Puro: o painel, o
 * relatório mensal e os testes importam daqui; a leitura do banco fica em
 * `queries.ts`.
 *
 * Duas coisas NÃO são gravadas, são calculadas aqui na leitura: dentro/fora do
 * raio (usa a área de hoje) e o resultado do lead (agendou, transbordou,
 * perdeu). Gravar as duas congelaria um palpite velho quando a clínica muda o
 * raio ou o lead volta a conversar.
 */

/** Sem resposta do contato por este tempo, um lead sem desfecho vira "parou de responder". */
export const IDLE_AFTER_HOURS = 72;
/** Abaixo disto de leads com cidade informada não há amostra para sugerir mudança de tráfego. */
export const MIN_SAMPLE = 10;
/** Fatia mínima de fora do raio para sugerir mexer na segmentação. */
const OUT_SHARE_TO_SUGGEST = 0.2;
const MIN_OUT_TO_SUGGEST = 5;
/** Fatia mínima de uma dúvida/motivo entre as registradas para virar sugestão. */
const TOPIC_SHARE_TO_SUGGEST = 0.25;

export type LeadOutcome = "scheduled" | "handoff" | "lost" | "open";

export type LeadRow = {
  createdAt: Date;
  status: string;
  /** Carimbo da triagem (`Lead.disqualifiedAt`) e o motivo dela. */
  disqualified: boolean;
  disqualifiedReason: string | null;
  conversation: {
    needsHuman: boolean;
    lastInboundAt: Date | null;
    followUpReason: string | null;
    /** Eventos `handoff` do relatório: transbordo que já foi devolvido ao agente continua contando. */
    handoffEvents: number;
  } | null;
  appointments: { status: string }[];
  insight: {
    city: string | null;
    cityKey: string | null;
    firstQuestionKey: string | null;
    lossReasonKey: string | null;
  } | null;
};

/** Motivo de perda derivado do que o sistema sabe (não é o agente quem declara). */
const NOT_A_LEAD_KEY = "nao_e_paciente";

/**
 * Resultado do lead. Ordem que decide: agendou > transbordou > perdeu > em
 * andamento. "Perdeu" só depois de um sinal explícito (motivo registrado,
 * triagem, follow-up de quem recusou/pediu para parar, status perdido) ou de
 * `IDLE_AFTER_HOURS` sem resposta — antes disso o lead ainda está em jogo e
 * chamá-lo de perdido inflaria a perda do mês corrente.
 */
export function leadOutcome(row: LeadRow, now: Date): { outcome: LeadOutcome; lossKey: string | null } {
  if (row.appointments.some((a) => a.status !== "canceled")) return { outcome: "scheduled", lossKey: null };
  const conversation = row.conversation;
  if (conversation && (conversation.needsHuman || conversation.handoffEvents > 0)) return { outcome: "handoff", lossKey: null };

  const lossKey = lossKeyOf(row, now);
  return lossKey ? { outcome: "lost", lossKey } : { outcome: "open", lossKey: null };
}

/**
 * O motivo de perda, sem olhar se o lead agendou ou transbordou. O relatório
 * mensal usa direto: lá todo contato que não agendou tem um motivo principal,
 * inclusive o que passou para a equipe.
 */
export function lossKeyOf(row: LeadRow, now: Date): string | null {
  const conversation = row.conversation;
  const reason = conversation?.followUpReason;
  const idleSince = conversation?.lastInboundAt ?? row.createdAt;
  const idle = now.getTime() - idleSince.getTime() >= IDLE_AFTER_HOURS * 3_600_000;

  let lossKey: string | null = row.insight?.lossReasonKey ?? null;
  if (!lossKey && row.disqualified) lossKey = row.disqualifiedReason === "fora_da_area" ? "fora_da_regiao" : NOT_A_LEAD_KEY;
  if (!lossKey && reason === "declined") lossKey = "adiou";
  if (!lossKey && reason === "stop") lossKey = "sem_interesse";
  if (!lossKey && row.status === "lost") lossKey = "outro";
  if (!lossKey && idle) lossKey = IDLE_LOSS_KEY;
  return lossKey;
}

export type RankItem = { key: string; label: string; count: number };
export type CityItem = { city: string; count: number; scheduled: number; verdict: "in" | "out" | "unknown" };

export type LeadQuality = {
  version: 1;
  /** Leads reais criados no período. */
  leads: number;
  /** Quantos deles disseram a cidade. */
  withCity: number;
  areaConfigured: boolean;
  baseCity: string | null;
  /** Entre os que disseram a cidade; zeros quando a área não está configurada. */
  inRadius: number;
  outOfRadius: number;
  inScheduled: number;
  outScheduled: number;
  /** Cidades mais citadas, com o veredito de cada uma (até 8). */
  cities: CityItem[];
  withDoubt: number;
  doubts: RankItem[];
  lostTotal: number;
  losses: RankItem[];
  outcomes: Record<LeadOutcome, number>;
  /** `withCity` abaixo de `MIN_SAMPLE`: amostra pequena demais para sugerir. */
  lowSample: boolean;
  suggestions: string[];
};

const SMALL_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);

/** "marilia" / "MARÍLIA" → "Marilia" / "Marília" mantém acento se veio; preposições em minúscula. */
export function displayCity(label: string): string {
  return label
    .toLowerCase()
    .split(" ")
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function rank(counts: Map<string, number>, label: (key: string) => string, limit: number): RankItem[] {
  return [...counts]
    .map(([key, count]) => ({ key, label: label(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
    .slice(0, limit);
}

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

export function summarizeLeadQuality(rows: LeadRow[], area: ServiceArea | null, now: Date): LeadQuality {
  const outcomes: Record<LeadOutcome, number> = { scheduled: 0, handoff: 0, lost: 0, open: 0 };
  const doubts = new Map<string, number>();
  const losses = new Map<string, number>();
  const byCity = new Map<string, { labels: Map<string, number>; count: number; scheduled: number }>();
  let withCity = 0, inRadius = 0, outOfRadius = 0, inScheduled = 0, outScheduled = 0, withDoubt = 0, lostTotal = 0;

  for (const row of rows) {
    const { outcome, lossKey } = leadOutcome(row, now);
    outcomes[outcome]++;
    if (outcome === "lost" && lossKey) { bump(losses, lossKey); lostTotal++; }
    const insight = row.insight;
    if (insight?.firstQuestionKey) { bump(doubts, insight.firstQuestionKey); withDoubt++; }
    if (!insight?.cityKey) continue;
    withCity++;
    const entry = byCity.get(insight.cityKey) ?? { labels: new Map(), count: 0, scheduled: 0 };
    entry.count++;
    if (outcome === "scheduled") entry.scheduled++;
    if (insight.city) bump(entry.labels, insight.city);
    byCity.set(insight.cityKey, entry);
    const verdict = classifyCity(area, insight.cityKey);
    if (verdict === "in") { inRadius++; if (outcome === "scheduled") inScheduled++; }
    if (verdict === "out") { outOfRadius++; if (outcome === "scheduled") outScheduled++; }
  }

  const cities: CityItem[] = [...byCity]
    .map(([key, v]) => {
      const label = [...v.labels].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;
      return { city: displayCity(label), count: v.count, scheduled: v.scheduled, verdict: classifyCity(area, key) };
    })
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "pt-BR"))
    .slice(0, 8);

  const quality: LeadQuality = {
    version: 1, leads: rows.length, withCity, areaConfigured: Boolean(area), baseCity: area?.baseCity ?? null,
    inRadius, outOfRadius, inScheduled, outScheduled, cities,
    withDoubt, doubts: rank(doubts, doubtLabel, 6), lostTotal, losses: rank(losses, lossLabel, 6),
    outcomes, lowSample: withCity < MIN_SAMPLE, suggestions: [],
  };
  quality.suggestions = trafficSuggestions(quality);
  return quality;
}

/**
 * Melhorias de tráfego a partir dos números — regra, não IA: o relatório não
 * chama modelo nenhum, e uma sugestão de verba não pode variar de uma geração
 * para outra. São hipóteses para testar com a agência, nunca promessa. Sem
 * amostra suficiente não sugere nada.
 */
export function trafficSuggestions(q: LeadQuality): string[] {
  if (q.lowSample) return [];
  const out: string[] = [];
  const outShare = q.withCity ? q.outOfRadius / q.withCity : 0;
  if (q.areaConfigured && q.baseCity && q.outOfRadius >= MIN_OUT_TO_SUGGEST && outShare >= OUT_SHARE_TO_SUGGEST) {
    const top = q.cities.find((c) => c.verdict === "out");
    out.push(`Restringir a segmentação dos anúncios a ${q.baseCity} e às cidades atendidas${top ? `, ou excluir ${top.city}` : ""}.`);
    out.push(`Colocar "em ${q.baseCity}" no texto do anúncio, para quem é de outra cidade não clicar.`);
  }
  const share = (items: RankItem[], key: string, total: number) => (total ? (items.find((i) => i.key === key)?.count ?? 0) / total : 0);
  if (q.withDoubt >= MIN_SAMPLE && share(q.doubts, "localizacao", q.withDoubt) >= TOPIC_SHARE_TO_SUGGEST) {
    out.push("Incluir o endereço da clínica na mensagem de boas-vindas.");
  }
  if (q.withDoubt >= MIN_SAMPLE && share(q.doubts, "preco", q.withDoubt) >= TOPIC_SHARE_TO_SUGGEST) {
    out.push("Explicar na mensagem de boas-vindas como funciona a avaliação e as formas de pagamento, para o preço não ser a primeira barreira.");
  }
  const insuranceDoubt = share(q.doubts, "convenio", q.withDoubt) >= TOPIC_SHARE_TO_SUGGEST && q.withDoubt >= MIN_SAMPLE;
  const insuranceLoss = q.lostTotal >= MIN_SAMPLE && share(q.losses, "convenio", q.lostTotal) >= TOPIC_SHARE_TO_SUGGEST;
  if (insuranceDoubt || insuranceLoss) out.push("Deixar claro no anúncio se a clínica atende convênio.");
  return out;
}

export const SUGGESTION_DISCLAIMER =
  "Sugestões geradas a partir dos dados do período. São hipóteses para testar com a agência de tráfego, não promessa de resultado.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A frase-resumo do relatório: "Dos 200 leads, 150 informaram a cidade: 62 eram de fora do raio (48 de Marília), e 2 deles agendaram." */
export function leadQualityHeadline(q: LeadQuality): string {
  if (q.leads === 0) return "Sem leads no período.";
  const of = q.leads === 1 ? "De 1 lead" : `Dos ${q.leads} leads`;
  if (q.withCity === 0) return `${of}, ${q.leads === 1 ? "ele não informou" : "nenhum informou"} a cidade ao agente neste período.`;
  const base = `${of}, ${plural(q.withCity, "informou", "informaram")} a cidade`;
  if (!q.areaConfigured) return `${base}. A área de atendimento ainda não foi configurada, então não dá para separar quem é de dentro e de fora do raio.`;
  const top = q.cities.find((c) => c.verdict === "out");
  const topText = top && q.outOfRadius > 0 ? ` (${top.count} de ${top.city})` : "";
  const outText = q.outOfRadius === 0
    ? "nenhum era de fora do raio"
    : `${q.outOfRadius} ${q.outOfRadius === 1 ? "era" : "eram"} de fora do raio${topText}, e ${plural(q.outScheduled, "deles agendou", "deles agendaram")}`;
  const inText = q.inRadius > 0 ? ` Dentro do raio, ${q.inScheduled} de ${q.inRadius} agendaram.` : "";
  return `${base}: ${outText}.${inText}`;
}
