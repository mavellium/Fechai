import { describe, expect, it } from "vitest";
import { diagnose, isLikelyBusinessHours } from "../src/modules/whatsapp/health";

/**
 * Detecção de número de WhatsApp fora do ar.
 *
 * Vem de um incidente real: a sessão de uma clínica morreu e o painel seguiu
 * mostrando "Seu número está atendendo · conectado" por horas. Ninguém foi
 * avisado — quem descobriu foi um humano estranhando o silêncio, já com leads
 * perdidos. Duas descobertas daquele dia estão travadas aqui:
 *
 * 1. O provedor MENTE. A Evolution respondeu `state: "open"` enquanto o
 *    `logout` da mesma instância, no mesmo segundo, devolvia "Connection
 *    Closed". Confiar só no estado não teria pego o caso.
 * 2. Por isso existe o segundo sinal (silêncio) — e por isso ele precisa ser
 *    conservador: alarme falso treina o dono a ignorar o aviso, e aí o alerta
 *    não serve para nada no dia em que for verdadeiro.
 */

const base = {
  storedStatus: "connected",
  liveStatus: "connected" as string | null,
  exists: true,
  reachable: true,
  silentHours: 1,
  duringBusinessHours: true,
};

describe("diagnose — estado do provedor", () => {
  it("conectado e recebendo mensagens está ok", () => {
    expect(diagnose(base)).toBe("ok");
  });

  it("provedor diz desconectado e o banco achava que estava conectado: avisa", () => {
    expect(diagnose({ ...base, liveStatus: "disconnected" })).toBe("desconectado");
  });

  it("instância apagada no provedor é o caso mais grave (só volta com QR novo)", () => {
    expect(diagnose({ ...base, exists: false })).toBe("sumiu");
  });

  it("número que o painel JÁ mostrava desconectado não vira alerta", () => {
    // Estado conhecido não é falha nova. Avisar aqui seria avisar sobre algo
    // que a pessoa já sabe — e todo aviso supérfluo corrói os que importam.
    expect(
      diagnose({ ...base, storedStatus: "disconnected", liveStatus: "disconnected" }),
    ).toBe("ok");
  });
});

describe("diagnose — provedor fora do ar", () => {
  it("não culpa o cliente quando quem caiu fomos nós", () => {
    // A Evolution fora do ar não significa que o WhatsApp DELE caiu. Mandar
    // "seu número saiu do ar" nesse caso é mentir para o cliente e gerar
    // reconexão desnecessária (que ainda custa um QR novo).
    expect(diagnose({ ...base, reachable: false, liveStatus: null })).toBe("indeterminado");
  });

  it("indeterminado vence até quando a instância parece sumida", () => {
    // Sem conseguir falar com o provedor, `exists` não é informação confiável.
    expect(
      diagnose({ ...base, reachable: false, exists: false, liveStatus: null }),
    ).toBe("indeterminado");
  });
});

describe("diagnose — silêncio (o sinal que pega provedor mentiroso)", () => {
  it("conectado mas mudo há muitas horas em horário comercial: avisa", () => {
    // Este é exatamente o caso do incidente: provedor jurando "open",
    // nenhuma mensagem entrando.
    expect(diagnose({ ...base, silentHours: 8 })).toBe("silencioso");
  });

  it("silêncio fora do horário comercial não é sintoma", () => {
    // Madrugada e domingo são silenciosos por natureza. Alertar aí é o
    // caminho mais curto para o dono ignorar o próximo aviso.
    expect(diagnose({ ...base, silentHours: 8, duringBusinessHours: false })).toBe("ok");
  });

  it("silêncio curto não dispara nada", () => {
    expect(diagnose({ ...base, silentHours: 2 })).toBe("ok");
  });

  it("conta que nunca recebeu mensagem não é tratada como quebrada", () => {
    // Conta nova, recém-conectada: não há silêncio a interpretar, e acusar
    // falha no primeiro dia de uso seria péssimo.
    expect(diagnose({ ...base, silentHours: null })).toBe("ok");
  });

  it("desconexão real tem prioridade sobre a regra de silêncio", () => {
    expect(diagnose({ ...base, liveStatus: "disconnected", silentHours: 30 })).toBe(
      "desconectado",
    );
  });
});

describe("isLikelyBusinessHours", () => {
  // Datas em UTC; America/Sao_Paulo é UTC-3.
  it("meio da tarde de uma quarta é horário comercial", () => {
    expect(isLikelyBusinessHours(new Date("2026-09-16T17:00:00Z"))).toBe(true);
  });

  it("madrugada não é", () => {
    expect(isLikelyBusinessHours(new Date("2026-09-16T06:00:00Z"))).toBe(false);
  });

  it("domingo não é, mesmo de tarde", () => {
    expect(isLikelyBusinessHours(new Date("2026-09-13T17:00:00Z"))).toBe(false);
  });
});
