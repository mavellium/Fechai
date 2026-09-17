import { describe, expect, it } from "vitest";
import { isWithinBusinessHours, parseScheduleConfig, resolveDuration, scheduleSystemContext, slotStartTimes, validateDurations, validateScheduleBreaks } from "@/modules/scheduling/config";
import { parseLocalDateTime } from "@/modules/scheduling/time";

const cfg = parseScheduleConfig({ durationMinutes: 60, breaks: [
  { label: "Almoço", startTime: "12:00", endTime: "13:00" },
  { label: "Café", startTime: "15:30", endTime: "15:45" },
] });
const at = (time: string) => parseLocalDateTime("2026-09-17", time, cfg.timezone)!;

describe("expediente com pausas", () => {
  it.each([["11:00", true], ["11:30", false], ["12:00", false], ["12:30", false], ["13:00", true], ["14:45", false], ["15:30", false], ["15:45", true], ["17:00", true], ["17:30", false]] as const)("consulta às %s disponível=%s", (time, allowed) => {
    expect(isWithinBusinessHours(at(time), cfg)).toBe(allowed);
  });
  it("respeita dias fechados", () => {
    expect(isWithinBusinessHours(parseLocalDateTime("2026-09-20", "10:00", cfg.timezone)!, cfg)).toBe(false);
  });
  it("informa as pausas e as regras de confirmação ao agente", () => {
    const context = scheduleSystemContext({ ...cfg, allowCancellation: true, allowRescheduling: true });
    expect(context).toContain("Almoço");
    expect(context).toContain("12:00–13:00");
    expect(context).toContain("ESPERE a próxima mensagem");
    expect(context).toContain("Não reinicie o agendamento");
  });
  it("recusa pausas invertidas, fora do expediente e sobrepostas", () => {
    for (const breaks of [
      [{ label: "", startTime: "13:00", endTime: "12:00" }],
      [{ label: "", startTime: "08:00", endTime: "10:00" }],
      [{ label: "", startTime: "12:00", endTime: "13:00" }, { label: "", startTime: "12:30", endTime: "14:00" }],
    ]) expect(validateScheduleBreaks({ ...cfg, breaks })).toBeTruthy();
    expect(validateScheduleBreaks(cfg)).toBeNull();
  });
});

describe("compatibilidade de configurações", () => {
  it("preserva expediente antigo sem habilitar cancelamento/reagendamento sozinho", () => {
    expect(parseScheduleConfig({ startTime: "08:30", endTime: "17:00", workdays: [2, 6] })).toMatchObject({
      startTime: "08:30", endTime: "17:00", workdays: [2, 6], breaks: [],
      allowCancellation: false, allowRescheduling: false, recognizeExisting: true,
    });
  });
  it.each([null, [], "inválido", { timezone: "inexistente", startTime: "99:99", breaks: [null, {}, { startTime: "12:90" }] }])("tolera JSON antigo ou malformado: %j", (raw) => {
    const parsed = parseScheduleConfig(raw);
    expect(() => scheduleSystemContext(parsed)).not.toThrow();
    expect(() => isWithinBusinessHours(at("10:00"), parsed)).not.toThrow();
  });
  it("não trata a string false como ligada", () => {
    expect(parseScheduleConfig({ allowCancellation: "false", allowRescheduling: "true" })).toMatchObject({ allowCancellation: false, allowRescheduling: false });
  });
});

describe("grade de horários", () => {
  it("recomeça os blocos no fim da pausa em vez de pular a primeira hora da tarde", () => {
    const cfg = parseScheduleConfig({ startTime: "09:00", endTime: "15:00", durationMinutes: 45, breaks: [{ label: "Almoço", startTime: "12:00", endTime: "13:00" }] });
    expect(slotStartTimes(cfg)).toEqual(expect.arrayContaining(["09:00", "09:45", "13:00", "13:45"]));
    expect(slotStartTimes(cfg).every((t) => t <= "14:15")).toBe(true);
  });
  it("diz ao agente para consultar os livres antes de sugerir", () => {
    expect(scheduleSystemContext(parseScheduleConfig(null))).toContain("list_available_slots");
  });
});

describe("durações por tipo de atendimento", () => {
  const comVariacoes = parseScheduleConfig({
    durationMinutes: 60,
    durations: [{ label: "Limpeza", minutes: 30 }, { label: "Clareamento", minutes: 90 }],
  });

  it("nasce vazio: quem atende tudo no mesmo bloco não ganha variação sozinho", () => {
    expect(parseScheduleConfig(null).durations).toEqual([]);
    expect(parseScheduleConfig({ durationMinutes: 45 }).durations).toEqual([]);
  });

  it("descarta linha sem nome, fora da faixa ou com nome repetido", () => {
    const parsed = parseScheduleConfig({ durations: [
      { label: "Limpeza", minutes: 30 },
      { label: "  ", minutes: 30 },
      { label: "Curta demais", minutes: 1 },
      { label: "Longa demais", minutes: 999 },
      { label: "LIMPEZA", minutes: 45 },
      { label: "Sem minutos" },
      null,
    ] });
    expect(parsed.durations).toEqual([{ label: "Limpeza", minutes: 30 }]);
  });

  it("resolve o tipo ignorando caixa e acento", () => {
    const cfg = parseScheduleConfig({ durations: [{ label: "Avaliação", minutes: 20 }] });
    for (const pedido of ["Avaliação", "avaliacao", " AVALIAÇÃO "]) {
      expect(resolveDuration(cfg, pedido)).toMatchObject({ minutes: 20, label: "Avaliação", matched: true });
    }
  });

  it("cai na duração padrão quando o tipo não existe ou não veio", () => {
    for (const pedido of [undefined, null, "", "Massagem"]) {
      expect(resolveDuration(comVariacoes, pedido)).toMatchObject({ minutes: 60, label: null, matched: false });
    }
  });

  it("lista as variações para o agente e manda passar o nome exato", () => {
    const context = scheduleSystemContext(comVariacoes);
    expect(context).toContain("Limpeza (30 min)");
    expect(context).toContain("Clareamento (90 min)");
    expect(context).toContain("tipoAtendimento");
  });

  it("não fala de tipos quando não há variação cadastrada", () => {
    expect(scheduleSystemContext(parseScheduleConfig({ durationMinutes: 60 }))).not.toContain("tipoAtendimento");
  });

  it("um tipo mais longo que o padrão é recusado pelo expediente", () => {
    const cfg = parseScheduleConfig({ startTime: "09:00", endTime: "18:00", durationMinutes: 30, durations: [{ label: "Longa", minutes: 120 }] });
    const as1730 = parseLocalDateTime("2026-09-17", "17:30", cfg.timezone)!;
    expect(isWithinBusinessHours(as1730, cfg)).toBe(true);
    expect(isWithinBusinessHours(as1730, { ...cfg, durationMinutes: resolveDuration(cfg, "Longa").minutes })).toBe(false);
  });

  it("recusa nome duplicado e duração fora da faixa na validação do formulário", () => {
    expect(validateDurations([{ label: "Limpeza", minutes: 30 }, { label: "limpeza", minutes: 45 }])).toBeTruthy();
    expect(validateDurations([{ label: "", minutes: 30 }])).toBeTruthy();
    expect(validateDurations([{ label: "Limpeza", minutes: 2 }])).toBeTruthy();
    expect(validateDurations([{ label: "Limpeza", minutes: 30 }, { label: "Avaliação", minutes: 60 }])).toBeNull();
  });
});
