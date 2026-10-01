import type { MonthlyAppointment, MonthlyConversation, MonthlyEvent, MonthlyInput } from "@/modules/reports/monthly";
import { EMPTY_ASSUMPTIONS, monthlyWindow, type MonthlyAssumptions } from "@/modules/reports/monthly-config";

/*
 * Fixture de aceite do relatório mensal v2: reproduz o modelo aprovado
 * ("Clínica Exemplo Odonto", setembro de 2026). Todos os números são fictícios.
 *
 * Uma diferença para o modelo: lá aparecem "1.180 mensagens" com 7h35 de
 * leitura, mas 7h35 a 30 s por mensagem são 910 mensagens. A fixture usa 910,
 * o que preserva 7h35, o total de 9h40 e o retorno do modelo.
 */

const TZ = "America/Sao_Paulo";
/** Hora local de Brasília (UTC−3) em setembro/outubro de 2026. */
export const local = (day: number, hour: number, minute = 0, second = 0, month = 9) =>
  new Date(Date.UTC(2026, month - 1, day, hour + 3, minute, second));
const plus = (at: Date, seconds: number) => new Date(at.getTime() + seconds * 1000);

export const v2Config = (): MonthlyAssumptions => ({ ...EMPTY_ASSUMPTIONS, timezone: TZ,
  // seg a sex 8h–18h, sáb 8h–12h, domingo fechado.
  humanHours: [[], ...Array.from({ length: 5 }, () => [{ start: 480, end: 1080 }]), [{ start: 480, end: 720 }]],
  secondsPerMessage: 30, attendantMonthlyCents: 550_000, attendantMonthlyHours: 220, investmentCents: 149_000,
  completedStatusTypes: ["ATTENDED"], noShowStatusTypes: ["MISSED"],
  procedures: ["Implante", "Ortodontia / alinhador", "Avaliação geral", "Clareamento"].map((name) => ({ name, ticketCents: 320_000, conversionBps: 3500 })),
});

// 214 contatos, pela hora da primeira mensagem: 0–8h, 8–12h, 12–14h, 14–18h, 18–22h, 22–24h.
const BANDS: [number, number][] = [[6, 14], [9, 46], [13, 22], [15, 58], [19, 52], [22, 22]];
// Dias úteis até 25/09: quem parou de responder já passou de 72h em 01/10.
const DAYS = [1, 2, 3, 4, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25];
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const TRANSFERRED = range(14, 71);            // 58, todos no expediente
const ANSWERED_BY_TEAM = TRANSFERRED.slice(0, 55);
// Espera da recepção em minutos: mediana 22, 11 acima de 1 hora.
const WAITS = [...Array(27).fill(10), 22, ...Array(16).fill(30), ...Array(11).fill(90)] as number[];
const AI_ONLY = [...range(0, 13), ...range(72, 213)]; // 156
const SCHEDULED_INSIDE = range(72, 90);       // 19
const SCHEDULED_OUTSIDE = range(140, 151);    // 12
const QUALIFIED = [...range(72, 127), ...range(140, 180)]; // 56 no expediente + 41 fora
const OUT_OF_AREA = [140, ...range(0, 13), ...range(152, 165)]; // 29, um deles agendou
const IN_AREA = range(14, 117);               // 104
const AUDIO_SECONDS = [372, ...Array(12).fill(345), 343, ...Array(23).fill(115)] as number[]; // 37 áudios, 2h05

const id = (i: number) => `c${String(i).padStart(3, "0")}`;

export function v2Conversations(): MonthlyConversation[] {
  const hours = BANDS.flatMap(([hour, n]) => Array<number>(n).fill(hour));
  const scheduled = new Set([...SCHEDULED_INSIDE, ...SCHEDULED_OUTSIDE]);
  const notScheduled = range(0, 213).filter((i) => !scheduled.has(i));
  // Um motivo por contato que não agendou: 112 só pararam de responder (sem registro).
  const REASONS: [string | null, number][] = [[null, 112], ["preco", 29], ["fora_da_regiao", 17], ["adiou", 14], ["outro", 5], ["concorrente", 3], ["sem_interesse", 3]];
  const reasonOf = new Map<number, string | null>();
  REASONS.flatMap(([key, n]) => Array<string | null>(n).fill(key)).forEach((key, n) => reasonOf.set(notScheduled[n], key));
  const DOUBTS: [string, number][] = [["preco", 73], ["localizacao", 45], ["convenio", 38], ["horario", 26], ["pagamento", 20], ["procedimento", 12]];
  const doubts = DOUBTS.flatMap(([key, n]) => Array<string>(n).fill(key));

  return hours.map((hour, i): MonthlyConversation => {
    const first = local(DAYS[i % DAYS.length], hour, i % 20);
    const messages: MonthlyConversation["messages"] = [
      { id: `${id(i)}-in`, role: "user", sentBy: null, createdAt: first },
      { id: `${id(i)}-ai`, role: "assistant", sentBy: "agent", createdAt: plus(first, [30, 38, 46][i % 3]) },
    ];
    const team = ANSWERED_BY_TEAM.indexOf(i);
    if (team >= 0) messages.push({ id: `${id(i)}-team`, role: "assistant", sentBy: "human", createdAt: plus(first, WAITS[team] * 60) });
    const solo = AI_ONLY.indexOf(i);
    if (solo >= 0) {
      // 696 textos além do primeiro de cada contato (910 no total) e 37 áudios, todos respondidos pela IA.
      const extras = 4 + (solo < 72 ? 1 : 0);
      for (let n = 0; n < extras; n++) {
        const at = plus(first, 300 + n * 240);
        messages.push({ id: `${id(i)}-in${n}`, role: "user", sentBy: null, createdAt: at },
          { id: `${id(i)}-ai${n}`, role: "assistant", sentBy: "agent", createdAt: plus(at, 20) });
      }
      if (solo < AUDIO_SECONDS.length) {
        const at = plus(first, 1800);
        messages.push({ id: `${id(i)}-audio`, role: "user", sentBy: null, createdAt: at, audio: { seconds: AUDIO_SECONDS[solo], heard: true } },
          { id: `${id(i)}-audio-ai`, role: "assistant", sentBy: "agent", createdAt: plus(at, 25) });
      }
    }
    const city = OUT_OF_AREA.includes(i) ? "Sumaré" : IN_AREA.includes(i) ? "Campinas" : null;
    return { id: id(i), leadId: id(i), variables: {}, lead: { createdAt: first, status: "new" }, firstInbound: first, messages,
      insight: { city, cityKey: city && city.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(),
        firstQuestionKey: doubts[i], lossReasonKey: reasonOf.get(i) ?? null } };
  });
}

export function v2Appointments(): MonthlyAppointment[] {
  const status = (outcomes: [string, number][]) => outcomes.flatMap(([key, n]) => Array<string>(n).fill(key));
  const inside = status([["attended", 13], ["no_show", 4], ["upcoming", 2]]);
  const outside = status([["attended", 8], ["no_show", 2], ["upcoming", 1], ["unknown", 1]]);
  const procedures = status([["Implante", 11], ["Ortodontia / alinhador", 8], ["Avaliação geral", 7], ["Clareamento", 5]]);
  const cohort = [...SCHEDULED_INSIDE.map((i, n) => [i, inside[n]] as const), ...SCHEDULED_OUTSIDE.map((i, n) => [i, outside[n]] as const)]
    .map(([i, outcome], n): MonthlyAppointment => ({
      id: `a${n}`, conversationId: id(i), leadId: id(i), source: "agent", serviceType: "Avaliação", kind: "evaluation", status: "scheduled",
      procedure: procedures[n], createdAt: local(26, 10), clinicorpAppointmentId: null,
      startsAt: outcome === "upcoming" ? local(3, 10, 0, 0, 10) : local(28, 10),
      attendance: outcome === "upcoming" ? "unknown" : outcome, attendanceAt: outcome === "attended" || outcome === "no_show" ? local(28, 12) : null,
    }));
  // Marcadas em agosto, realizadas em setembro: linha à parte, fora da taxa.
  const earlier = [0, 1].map((n): MonthlyAppointment => ({
    id: `aug${n}`, conversationId: `aug${n}`, leadId: null, source: "agent", serviceType: "Avaliação", kind: "evaluation", status: "scheduled",
    procedure: "Implante", createdAt: local(28, 15, 0, 0, 8), startsAt: local(2, 9), attendance: "attended", attendanceAt: local(2, 11), clinicorpAppointmentId: null,
  }));
  return [...cohort, ...earlier];
}

export function v2Events(): MonthlyEvent[] {
  return [
    ...QUALIFIED.map((i, n): MonthlyEvent => ({ id: `q${n}`, conversationId: id(i), kind: "qualified", procedure: null, createdAt: local(25, 23) })),
    // Transbordos sem resposta da equipe: os 3 últimos transferidos.
    ...TRANSFERRED.slice(55).map((i, n): MonthlyEvent => ({ id: `h${n}`, conversationId: id(i), kind: "handoff", procedure: null, createdAt: local(25, 23, 10) })),
    ...range(0, 13).map((n): MonthlyEvent => ({ id: `u${n}`, conversationId: id(n), kind: "unanswered", procedure: null, createdAt: local(25, 23, 20) })),
  ];
}

export function v2Input(): MonthlyInput {
  const window = monthlyWindow("2026-09", TZ);
  return { start: window.start, end: window.end, now: local(1, 9, 0, 0, 10), trackingSince: window.previous.start, accountCreatedAt: window.previous.start,
    config: v2Config(), conversations: v2Conversations(), appointments: v2Appointments(), events: v2Events(),
    clinicorp: { available: false, error: null, appointments: [], statusTypes: [] },
    area: { baseCity: "Campinas", cities: [] },
    incidents: [{ startsAt: local(17, 19), endsAt: local(17, 22), kind: "agent", description: "Agente fora do ar", contactsAffected: 6 }],
  };
}
