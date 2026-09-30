import { describe, expect, it } from "vitest";
import { cleanCity, normalizeCity, sameCity } from "@/modules/lead-insights/city";
import { DOUBT_CATEGORIES, LOSS_CATEGORIES, doubtLabel, lossLabel, parseDoubtCategory, parseLossCategory } from "@/modules/lead-insights/categories";
import { classifyCity, describeServiceArea, parseServiceArea, serviceAreaFormSchema, splitCityList } from "@/modules/lead-insights/service-area";
import { IDLE_AFTER_HOURS, MIN_SAMPLE, leadOutcome, leadQualityHeadline, summarizeLeadQuality, trafficSuggestions, type LeadRow } from "@/modules/lead-insights/summary";

const NOW = new Date("2026-09-29T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("cidade dita pelo contato", () => {
  it.each([
    ["Marília", "marilia"], ["marilia", "marilia"], ["MARÍLIA", "marilia"], ["Marília - SP", "marilia"],
    ["Marília/SP", "marilia"], ["marilia sp", "marilia"], ["Garça, SP", "garca"], ["São José do Rio Preto", "sao jose do rio preto"],
    ["Sant'Ana do Livramento", "santana do livramento"], ["Vila Velha ES", "vila velha"],
  ])("normaliza %s → %s", (raw, key) => expect(normalizeCity(raw)).toBe(key));

  it("mantém cidade com nome de UF quando é a única palavra", () => {
    expect(normalizeCity("Palmas")).toBe("palmas");
    expect(normalizeCity("SP")).toBe("sp"); // só a sigla: sem nome para sobrar, não some
  });

  it.each([null, undefined, 42, "", "   ", "Rua 5, 123", "moro em marília e queria saber o valor da consulta de vocês pra semana", "a@b.com", "https://x.com", "x".repeat(61)])(
    "descarta o que não parece cidade: %s",
    (raw) => {
      expect(cleanCity(raw)).toBeNull();
      expect(normalizeCity(raw)).toBeNull();
    },
  );

  it("perdoa um erro de digitação só em nome com 6+ letras", () => {
    expect(sameCity("marilia", "marilha")).toBe(true);
    expect(sameCity("ourinhos", "ourinho")).toBe(true);
    expect(sameCity("tupa", "tupi")).toBe(false);
    expect(sameCity("garca", "garco")).toBe(false);
    expect(sameCity("marilia", "garca")).toBe(false);
  });
});

describe("categorias", () => {
  it("chave conhecida passa, desconhecida vira outro, ausente é null", () => {
    expect(parseDoubtCategory("localizacao")).toBe("localizacao");
    expect(parseDoubtCategory("qualquer coisa")).toBe("outro");
    expect(parseDoubtCategory("")).toBeNull();
    expect(parseDoubtCategory(undefined)).toBeNull();
    expect(parseLossCategory("preco")).toBe("preco");
    expect(parseLossCategory("sumiu")).toBe("outro"); // "sumiu" é derivado, o agente não declara
    expect(parseLossCategory(3)).toBeNull();
  });
  it("rótulos e chaves únicas", () => {
    expect(new Set(DOUBT_CATEGORIES.map((c) => c.key)).size).toBe(DOUBT_CATEGORIES.length);
    expect(new Set(LOSS_CATEGORIES.map((c) => c.key)).size).toBe(LOSS_CATEGORIES.length);
    expect(doubtLabel("preco")).toBe("Preço");
    expect(lossLabel("sumiu")).toBe("Parou de responder");
    expect(lossLabel("nada")).toBe("Outro motivo");
  });
});

describe("área de atendimento", () => {
  const area = parseServiceArea({ baseCity: "Garça", cities: ["Álvaro de Carvalho", "garca - SP", "Vera Cruz"] })!;

  it("lê linha suja sem lançar", () => {
    expect(parseServiceArea(null)).toBeNull();
    expect(parseServiceArea({ baseCity: "  " })).toBeNull();
    expect(parseServiceArea({ baseCity: "Garça", cities: "não é lista" })).toEqual({ baseCity: "Garça", cities: [] });
    expect(area.cities).toEqual(["Álvaro de Carvalho", "Vera Cruz"]); // a base repetida sai
  });

  it("dentro, fora e desconhecido", () => {
    expect(classifyCity(area, "garca")).toBe("in");
    expect(classifyCity(area, "vera cruz")).toBe("in");
    expect(classifyCity(area, "marilia")).toBe("out");
    expect(classifyCity(area, null)).toBe("unknown");
    expect(classifyCity(null, "marilia")).toBe("unknown"); // sem área, nunca "dentro" presumido
  });

  it("descreve e separa a lista digitada", () => {
    expect(describeServiceArea(null)).toBe("Não configurada");
    expect(describeServiceArea(area)).toBe("Garça e mais 2 cidades");
    expect(describeServiceArea({ baseCity: "Garça", cities: ["Vera Cruz"] })).toBe("Garça e mais 1 cidade");
    expect(splitCityList("Vera Cruz, Álvaro de Carvalho;\nGália")).toEqual(["Vera Cruz", "Álvaro de Carvalho", "Gália"]);
  });

  it("valida o formulário", () => {
    expect(serviceAreaFormSchema.safeParse({ baseCity: "Garça", cities: "Vera Cruz\nvera cruz\nGarça" }).data).toEqual({ baseCity: "Garça", cities: ["Vera Cruz"] });
    expect(serviceAreaFormSchema.safeParse({ baseCity: "", cities: "" }).success).toBe(false);
    expect(serviceAreaFormSchema.safeParse({ baseCity: "Rua 5", cities: "" }).success).toBe(false);
    const bad = serviceAreaFormSchema.safeParse({ baseCity: "Garça", cities: "Vera Cruz, http://x.com" });
    expect(bad.success).toBe(false);
    expect(serviceAreaFormSchema.safeParse({ baseCity: "Garça", cities: Array.from({ length: 101 }, (_, i) => `Cidade ${String.fromCharCode(97 + (i % 26))}${"x".repeat(i % 7)}`).join("\n") }).success).toBe(false);
  });
});

function lead(over: Partial<LeadRow> & { city?: string; loss?: string; doubt?: string } = {}): LeadRow {
  const { city, loss, doubt, ...rest } = over;
  return {
    createdAt: hoursAgo(2), status: "new", disqualified: false, disqualifiedReason: null,
    conversation: { needsHuman: false, lastInboundAt: hoursAgo(1), followUpReason: null, handoffEvents: 0 },
    appointments: [],
    insight: city || loss || doubt ? { city: city ?? null, cityKey: city ? normalizeCity(city) : null, firstQuestionKey: doubt ?? null, lossReasonKey: loss ?? null } : null,
    ...rest,
  };
}

describe("resultado do lead", () => {
  it("agendou vence tudo; agendamento cancelado não conta", () => {
    expect(leadOutcome(lead({ appointments: [{ status: "scheduled" }], conversation: { needsHuman: true, lastInboundAt: null, followUpReason: "stop", handoffEvents: 1 } }), NOW).outcome).toBe("scheduled");
    expect(leadOutcome(lead({ appointments: [{ status: "canceled" }] }), NOW).outcome).toBe("open");
  });

  it("transbordou: marcado agora ou já registrado, mesmo devolvido ao agente", () => {
    expect(leadOutcome(lead({ conversation: { needsHuman: true, lastInboundAt: hoursAgo(1), followUpReason: null, handoffEvents: 0 } }), NOW).outcome).toBe("handoff");
    expect(leadOutcome(lead({ conversation: { needsHuman: false, lastInboundAt: hoursAgo(1), followUpReason: null, handoffEvents: 1 } }), NOW).outcome).toBe("handoff");
  });

  it("perdeu só com sinal explícito ou depois de 72h sem resposta", () => {
    expect(leadOutcome(lead(), NOW)).toEqual({ outcome: "open", lossKey: null });
    expect(leadOutcome(lead({ loss: "preco" }), NOW)).toEqual({ outcome: "lost", lossKey: "preco" });
    expect(leadOutcome(lead({ disqualified: true, disqualifiedReason: "fora_da_area" }), NOW).lossKey).toBe("fora_da_regiao");
    expect(leadOutcome(lead({ disqualified: true, disqualifiedReason: "spam" }), NOW).lossKey).toBe("nao_e_paciente");
    expect(leadOutcome(lead({ conversation: { needsHuman: false, lastInboundAt: hoursAgo(1), followUpReason: "declined", handoffEvents: 0 } }), NOW).lossKey).toBe("adiou");
    expect(leadOutcome(lead({ conversation: { needsHuman: false, lastInboundAt: hoursAgo(1), followUpReason: "stop", handoffEvents: 0 } }), NOW).lossKey).toBe("sem_interesse");
    expect(leadOutcome(lead({ status: "lost" }), NOW).lossKey).toBe("outro");
    const idle = lead({ conversation: { needsHuman: false, lastInboundAt: hoursAgo(IDLE_AFTER_HOURS), followUpReason: null, handoffEvents: 0 } });
    expect(leadOutcome(idle, NOW)).toEqual({ outcome: "lost", lossKey: "sumiu" });
    const recent = lead({ conversation: { needsHuman: false, lastInboundAt: hoursAgo(IDLE_AFTER_HOURS - 1), followUpReason: null, handoffEvents: 0 } });
    expect(leadOutcome(recent, NOW).outcome).toBe("open");
  });

  it("o motivo do agente vence o derivado", () => {
    expect(leadOutcome(lead({ loss: "concorrente", disqualified: true, disqualifiedReason: "spam" }), NOW).lossKey).toBe("concorrente");
  });

  it("sem conversa, o silêncio conta desde a criação do lead", () => {
    expect(leadOutcome(lead({ conversation: null, createdAt: hoursAgo(100) }), NOW).lossKey).toBe("sumiu");
    expect(leadOutcome(lead({ conversation: null, createdAt: hoursAgo(5) }), NOW).outcome).toBe("open");
  });
});

const area = parseServiceArea({ baseCity: "Garça", cities: [] });

describe("agregação da qualidade dos leads", () => {
  it("conta cidade, raio, resultado, dúvida e perda", () => {
    const rows: LeadRow[] = [
      lead({ city: "Garça", doubt: "preco", appointments: [{ status: "scheduled" }] }),
      lead({ city: "Garça", doubt: "horario" }),
      lead({ city: "Marília", doubt: "localizacao", loss: "fora_da_regiao" }),
      lead({ city: "marilia - SP", doubt: "localizacao", appointments: [{ status: "done" }] }),
      lead({ city: "Bauru", doubt: "outro", loss: "preco" }),
      lead({}), // não disse a cidade
    ];
    const q = summarizeLeadQuality(rows, area, NOW);
    expect(q).toMatchObject({ leads: 6, withCity: 5, areaConfigured: true, baseCity: "Garça", inRadius: 2, outOfRadius: 3, inScheduled: 1, outScheduled: 1, withDoubt: 5, lostTotal: 2 });
    expect(q.outcomes).toEqual({ scheduled: 2, handoff: 0, lost: 2, open: 2 });
    expect(q.cities.map((c) => [c.city, c.count, c.verdict])).toEqual([["Garça", 2, "in"], ["Marília", 2, "out"], ["Bauru", 1, "out"]]);
    expect(q.doubts[0]).toMatchObject({ key: "localizacao", label: "Localização", count: 2 });
    expect(q.losses.map((l) => l.key).sort()).toEqual(["fora_da_regiao", "preco"]);
    expect(q.lowSample).toBe(true);
    expect(q.suggestions).toEqual([]);
  });

  it("sem área configurada não classifica dentro/fora", () => {
    const q = summarizeLeadQuality([lead({ city: "Marília" }), lead({ city: "Garça" })], null, NOW);
    expect(q).toMatchObject({ areaConfigured: false, baseCity: null, inRadius: 0, outOfRadius: 0, withCity: 2 });
    expect(q.cities.every((c) => c.verdict === "unknown")).toBe(true);
    expect(leadQualityHeadline(q)).toContain("ainda não foi configurada");
  });

  it("lista vazia é um resumo zerado, não um erro", () => {
    const q = summarizeLeadQuality([], area, NOW);
    expect(q).toMatchObject({ leads: 0, withCity: 0, lowSample: true, suggestions: [] });
    expect(leadQualityHeadline(q)).toBe("Sem leads no período.");
  });
});

describe("frase-resumo e sugestões de tráfego", () => {
  // 30 leads: 12 de Marília (1 agendou), 18 de Garça (9 agendaram); muitos perguntaram onde fica.
  const rows: LeadRow[] = [
    ...Array.from({ length: 12 }, (_, i) => lead({ city: "Marília", doubt: i < 8 ? "localizacao" : "preco", appointments: i === 0 ? [{ status: "scheduled" }] : [] })),
    ...Array.from({ length: 18 }, (_, i) => lead({ city: "Garça", doubt: "horario", appointments: i < 9 ? [{ status: "scheduled" }] : [] })),
  ];
  const q = summarizeLeadQuality(rows, area, NOW);

  it("monta a frase do relatório com os números", () => {
    expect(q.withCity).toBeGreaterThanOrEqual(MIN_SAMPLE);
    expect(leadQualityHeadline(q)).toBe("Dos 30 leads, 30 informaram a cidade: 12 eram de fora do raio (12 de Marília), e 1 deles agendou. Dentro do raio, 9 de 18 agendaram.");
  });

  it("sugere segmentação, anúncio e endereço quando os dados pedem", () => {
    expect(q.suggestions).toEqual([
      "Restringir a segmentação dos anúncios a Garça e às cidades atendidas, ou excluir Marília.",
      'Colocar "em Garça" no texto do anúncio, para quem é de outra cidade não clicar.',
      "Incluir o endereço da clínica na mensagem de boas-vindas.",
    ]);
  });

  it("não sugere com amostra pequena, nem com pouco lead de fora", () => {
    expect(trafficSuggestions({ ...q, lowSample: true })).toEqual([]);
    expect(trafficSuggestions({ ...q, outOfRadius: 3, doubts: [], withDoubt: 0 })).toEqual([]);
    expect(trafficSuggestions({ ...q, areaConfigured: false, doubts: [], withDoubt: 0 })).toEqual([]);
  });

  it("preço e convênio viram sugestão quando dominam", () => {
    const base = summarizeLeadQuality(Array.from({ length: 12 }, () => lead({ city: "Garça", doubt: "preco" })), area, NOW);
    expect(base.suggestions[0]).toContain("formas de pagamento");
    const insurance = summarizeLeadQuality(Array.from({ length: 12 }, () => lead({ city: "Garça", doubt: "convenio" })), area, NOW);
    expect(insurance.suggestions).toEqual(["Deixar claro no anúncio se a clínica atende convênio."]);
  });

  it("singular e ninguém de fora", () => {
    const one = summarizeLeadQuality([lead({ city: "Marília", appointments: [] })], area, NOW);
    expect(leadQualityHeadline(one)).toBe("De 1 lead, 1 informou a cidade: 1 era de fora do raio (1 de Marília), e 0 deles agendaram.");
    const none = summarizeLeadQuality([lead({ city: "Garça" }), lead({ city: "Garça" })], area, NOW);
    expect(leadQualityHeadline(none)).toBe("Dos 2 leads, 2 informaram a cidade: nenhum era de fora do raio. Dentro do raio, 0 de 2 agendaram.");
    expect(leadQualityHeadline(summarizeLeadQuality([lead({})], area, NOW))).toBe("De 1 lead, ele não informou a cidade ao agente neste período.");
  });
});
