import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Testes da regra de "quando o agente responde em áudio".
 *
 * O que está sendo protegido aqui não é o TTS em si (isso é a Fish Audio), e
 * sim a promessa de que **falar é opcional**: qualquer coisa que dê errado no
 * caminho da voz precisa terminar em resposta de texto, nunca em silêncio. Um
 * arrependimento nessa regra deixaria o contato sem resposta no WhatsApp por
 * causa de um terceiro fora do ar — que é exatamente o que a arquitetura de
 * `modules/voice` existe para impedir.
 *
 * `speakReply` só depende de `fish.ts`, então entra de verdade (sem mock do
 * módulo inteiro): o `fetch` é que é interceptado, que é a fronteira real.
 */

const CHAVE = "fish-teste";

async function importarReply() {
  // Reimporta a cada teste: `isFishAudioConfigured()` lê o env na chamada, mas
  // o módulo é cacheado entre testes e o estado de um vazaria no outro.
  vi.resetModules();
  return import("../src/modules/voice/reply");
}

describe("Quando o agente responde em áudio (modules/voice/reply.ts)", () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    process.env.FISH_AUDIO_API_KEY = CHAVE;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    delete process.env.FISH_AUDIO_API_KEY;
    vi.restoreAllMocks();
  });

  /** Resposta da Fish Audio com áudio de verdade (bytes quaisquer). */
  function fishRespondeComAudio(bytes = 4096) {
    const audio = new Uint8Array(bytes).fill(7);
    globalThis.fetch = vi.fn(async () =>
      new Response(audio, { status: 200 }),
    ) as unknown as typeof fetch;
  }

  it("fala quando o contato mandou áudio e a conta tem voz gravada", async () => {
    fishRespondeComAudio();
    const { speakReply } = await importarReply();

    const r = await speakReply({
      text: "Claro, posso te ajudar com isso!",
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    expect(r.spoken).toBe(true);
    if (r.spoken) {
      expect(r.audio.length).toBeGreaterThan(0);
      // opus/ogg é o que o WhatsApp trata como mensagem de voz (PTT).
      expect(r.mime).toBe("audio/ogg");
    }
  });

  it("NÃO fala com quem escreveu — o agente espelha o contato", async () => {
    fishRespondeComAudio();
    const chamou = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { speakReply } = await importarReply();

    const r = await speakReply({
      text: "Claro, posso te ajudar!",
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: false,
    });

    expect(r).toEqual({ spoken: false, reason: "not_audio" });
    // A decisão vem ANTES da chamada paga: mandar texto de volta não deve
    // custar uma síntese jogada fora.
    expect(chamou).not.toHaveBeenCalled();
  });

  it("não fala com a opção desligada, mesmo tendo voz gravada", async () => {
    fishRespondeComAudio();
    const { speakReply } = await importarReply();

    const r = await speakReply({
      text: "Oi!",
      settings: { speakReplies: false, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    expect(r).toEqual({ spoken: false, reason: "off" });
  });

  it("não fala sem voz gravada — a opção ligada sozinha não basta", async () => {
    fishRespondeComAudio();
    const { speakReply } = await importarReply();

    const r = await speakReply({
      text: "Oi!",
      settings: { speakReplies: true, voiceId: null },
      incomingWasAudio: true,
    });

    expect(r).toEqual({ spoken: false, reason: "no_voice" });
  });

  it("manda texto quando a resposta é longa demais para virar áudio", async () => {
    fishRespondeComAudio();
    const chamou = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { speakReply } = await importarReply();
    const { MAX_TTS_CHARS } = await import("../src/modules/voice/fish");

    const r = await speakReply({
      text: "a".repeat(MAX_TTS_CHARS + 1),
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    expect(r).toEqual({ spoken: false, reason: "too_long" });
    expect(chamou).not.toHaveBeenCalled();
  });

  it("cai para texto quando a Fish Audio devolve erro — nunca deixa sem resposta", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("upstream indisponível", { status: 503 }),
    ) as unknown as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { speakReply } = await importarReply();

    const r = await speakReply({
      text: "Claro, posso te ajudar!",
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    // `failed`, e não uma exceção: quem chama manda o texto e a conversa segue.
    expect(r).toEqual({ spoken: false, reason: "failed" });
  });

  it("cai para texto quando a rede cai no meio da síntese", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { speakReply } = await importarReply();

    const r = await speakReply({
      text: "Claro!",
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    expect(r).toEqual({ spoken: false, reason: "failed" });
  });

  it("cai para texto quando a Fish devolve 200 com áudio vazio", async () => {
    // Falha traiçoeira: status ok, corpo vazio. Sem esta checagem o WhatsApp
    // receberia uma mensagem de voz de zero segundo no lugar da resposta.
    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array(0), { status: 200 }),
    ) as unknown as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { speakReply } = await importarReply();

    const r = await speakReply({
      text: "Claro!",
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    expect(r).toEqual({ spoken: false, reason: "failed" });
  });

  it("cai para o modelo gratuito quando o crédito da API acaba (402)", async () => {
    // Verificado contra a API real: com crédito zero, `s2.1-pro` devolve 402 e
    // `s2.1-pro-free` responde 200 com áudio. Sem este fallback, a conta pararia
    // de falar sozinha no meio do mês, sem ninguém entender por quê.
    const modelosTentados: string[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const model = (init.headers as Record<string, string>).model;
      modelosTentados.push(model);
      if (model === "s2.1-pro") {
        return new Response(JSON.stringify({ status: 402, message: "Insufficient API credit" }), {
          status: 402,
        });
      }
      return new Response(new Uint8Array(3072).fill(9), { status: 200 });
    }) as unknown as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { speakReply } = await importarReply();
    const r = await speakReply({
      text: "Consigo te encaixar amanhã às dez!",
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    expect(r.spoken).toBe(true);
    expect(modelosTentados).toEqual(["s2.1-pro", "s2.1-pro-free"]);
  });

  it("não insiste no modelo gratuito quando o erro não é de crédito", async () => {
    // 401 (chave inválida) se repetiria igual no modelo seguinte — tentar de
    // novo só dobraria a latência antes de cair para texto do mesmo jeito.
    const modelosTentados: string[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      modelosTentados.push((init.headers as Record<string, string>).model);
      return new Response("chave inválida", { status: 401 });
    }) as unknown as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { speakReply } = await importarReply();
    const r = await speakReply({
      text: "Oi!",
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    expect(r).toEqual({ spoken: false, reason: "failed" });
    expect(modelosTentados).toEqual(["s2.1-pro"]);
  });

  it("não tenta falar numa instalação sem chave da Fish Audio", async () => {
    delete process.env.FISH_AUDIO_API_KEY;
    fishRespondeComAudio();
    const chamou = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { speakReply } = await importarReply();

    const r = await speakReply({
      text: "Oi!",
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    expect(r).toEqual({ spoken: false, reason: "off" });
    expect(chamou).not.toHaveBeenCalled();
  });

  it("manda o reference_id da conta e pede opus na chamada da Fish", async () => {
    // A voz é por conta: mandar o id errado faria o agente de uma clínica
    // responder com a voz de outra.
    let corpo: Record<string, unknown> = {};
    let cabecalhos: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      cabecalhos = init.headers as Record<string, string>;
      return new Response(new Uint8Array(2048).fill(1), { status: 200 });
    }) as unknown as typeof fetch;

    const { speakReply } = await importarReply();
    await speakReply({
      text: "Bom dia!",
      settings: { speakReplies: true, voiceId: "voz-da-clinica-a" },
      incomingWasAudio: true,
    });

    expect(corpo.reference_id).toBe("voz-da-clinica-a");
    expect(corpo.text).toBe("Bom dia!");
    expect(corpo.format).toBe("opus");
    expect(cabecalhos.Authorization).toBe(`Bearer ${CHAVE}`);
  });

  it("não manda a risada escrita para a Fish — o agente não ri sem motivo", async () => {
    // A reclamação que originou `speech-text.ts`: o cliente perguntou o preço e
    // ouviu uma gargalhada, porque o LLM escreveu "kkkk" e o TTS pronunciou.
    let corpo: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      return new Response(new Uint8Array(2048).fill(1), { status: 200 });
    }) as unknown as typeof fetch;

    const { speakReply } = await importarReply();
    const r = await speakReply({
      text: "kkkk que isso 😄 o plano sai por R$ 250, *vale muito*!",
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    expect(r.spoken).toBe(true);
    expect(corpo.text).toBe("que isso o plano sai por R$ 250, vale muito!");
  });

  it("fala neutro por padrão — improviso é opção, não herança", async () => {
    let corpo: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      return new Response(new Uint8Array(2048).fill(1), { status: 200 });
    }) as unknown as typeof fetch;

    const { speakReply } = await importarReply();
    await speakReply({
      text: "Claro, posso verificar isso para você.",
      // Conta que nunca mexeu no estilo (ou anterior ao campo).
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    // Default da Fish é 0.7/0.7: alto o bastante para a família s2 inventar
    // paralinguagem que o texto não pediu.
    expect(corpo.temperature).toBe(0.3);
    expect(corpo.top_p).toBe(0.6);
  });

  it("obedece o estilo escolhido pelo dono da conta", async () => {
    let corpo: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      return new Response(new Uint8Array(2048).fill(1), { status: 200 });
    }) as unknown as typeof fetch;

    const { speakReply } = await importarReply();
    await speakReply({
      text: "Bora marcar!",
      settings: { speakReplies: true, voiceId: "voz-123", voiceStyle: "animada" },
      incomingWasAudio: true,
    });

    expect(corpo.temperature).toBe(0.8);
    expect(corpo.top_p).toBe(0.9);
  });

  it("leva a lista do agente para o texto falado", async () => {
    let corpo: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      return new Response(new Uint8Array(2048).fill(1), { status: 200 });
    }) as unknown as typeof fetch;

    const { speakReply } = await importarReply();
    await speakReply({
      text: "Fechado então, meu rei! Te espero às 14h.",
      settings: { speakReplies: true, voiceId: "voz-123", speechBlocklist: "meu rei" },
      incomingWasAudio: true,
    });

    expect(corpo.text).toBe("Fechado então! Te espero às 14h.");
  });

  it("resposta só de risada e emoji sai em texto, sem gastar síntese", async () => {
    fishRespondeComAudio();
    const chamou = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { speakReply } = await importarReply();

    const r = await speakReply({
      text: "kkkkk 😂😂",
      settings: { speakReplies: true, voiceId: "voz-123" },
      incomingWasAudio: true,
    });

    expect(r).toEqual({ spoken: false, reason: "nothing_to_say" });
    expect(chamou).not.toHaveBeenCalled();
  });
});

/**
 * O jeito de falar é escolha do dono da conta — e o padrão é o contido.
 *
 * O que está preso aqui é o PADRÃO: qualquer estado esquisito da coluna (null,
 * chave antiga, texto editado à mão) tem que cair na voz neutra. O caminho
 * oposto — cair no default da Fish, que improvisa — foi o defeito de origem.
 */
describe("Jeito de falar (modules/voice/style.ts)", () => {
  it("cai na neutra em qualquer valor que não seja do catálogo", async () => {
    const { parseVoiceStyle, voiceStyleParams } = await import("../src/modules/voice/style");

    expect(parseVoiceStyle(null).key).toBe("neutra");
    expect(parseVoiceStyle("").key).toBe("neutra");
    expect(parseVoiceStyle("estilo-que-nao-existe").key).toBe("neutra");
    expect(voiceStyleParams(undefined)).toEqual({ temperature: 0.3, top_p: 0.6 });
  });

  it("sobe a expressividade conforme a escolha, e avisa onde ela improvisa", async () => {
    const { VOICE_STYLES, parseVoiceStyle } = await import("../src/modules/voice/style");

    const temperaturas = VOICE_STYLES.map((s) => s.params.temperature);
    // Ordem do menu = do mais contido ao mais solto.
    expect([...temperaturas].sort((a, b) => a - b)).toEqual(temperaturas);
    // Só a mais expressiva avisa — é a faixa em que a risada sem motivo aparece.
    expect(VOICE_STYLES.filter((s) => s.warning)).toHaveLength(1);
    expect(parseVoiceStyle("animada").warning).toBeTruthy();
    expect(parseVoiceStyle("neutra").warning).toBeUndefined();
  });
});

/**
 * O que o agente PRONUNCIA, que não é o que ele escreve.
 *
 * O risco destes testes não é deixar passar uma risada — é o contrário: comer
 * palavra de verdade do atendimento ("ok", "RS" do endereço) num regex
 * ganancioso. Metade dos casos abaixo existe para provar que isso não acontece.
 */
describe("Texto que vira fala (modules/voice/speech-text.ts)", () => {
  it("fala datas brasileiras e meia-noite de forma natural", async () => {
    const { toSpeech } = await import("../src/modules/voice/speech-text");
    expect(toSpeech("Seu horário: *quinta (24/09), às 00h*.")).toBe(
      "Seu horário: quinta (24 de setembro), à meia-noite.",
    );
    expect(toSpeech("Dia 01/01/2027 às 00:00.")).toBe(
      "Dia 1 de janeiro de 2027 à meia-noite.",
    );
    expect(toSpeech("Encontro em 24/09 às 00h30.")).toBe(
      "Encontro em 24 de setembro à meia-noite e meia.",
    );
  });

  it("preserva frações, datas inválidas e horários diurnos", async () => {
    const { toSpeech } = await import("../src/modules/voice/speech-text");
    expect(toSpeech("Parcela 1/2 e código 123/09.")).toBe("Parcela 1/2 e código 123/09.");
    expect(toSpeech("Consulta 31/02 às 14h.")).toBe("Consulta 31/02 às 14h.");
  });

  it("tira risada escrita em todas as formas que aparecem no WhatsApp", async () => {
    const { toSpeech } = await import("../src/modules/voice/speech-text");

    expect(toSpeech("kkkk boa!")).toBe("boa!");
    expect(toSpeech("hahaha que engraçado")).toBe("que engraçado");
    expect(toSpeech("Vou verificar rsrs, já te falo")).toBe("Vou verificar, já te falo");
    expect(toSpeech("hehe combinado")).toBe("combinado");
    expect(toSpeech("Que bom (risos) vamos marcar")).toBe("Que bom vamos marcar");
  });

  it("não come palavra de verdade parecida com risada", async () => {
    const { toSpeech } = await import("../src/modules/voice/speech-text");

    // "ok" tem um k só; "RS" maiúsculo é o estado, e sumir com ele deixaria o
    // agente falando um endereço pela metade.
    expect(toSpeech("ok, te espero")).toBe("ok, te espero");
    expect(toSpeech("Ficamos em Porto Alegre - RS")).toBe("Ficamos em Porto Alegre - RS");
    expect(toSpeech("Hoje das 9h às 18h")).toBe("Hoje das 9h às 18h");
    expect(toSpeech("A unidade da Bahia também atende")).toBe("A unidade da Bahia também atende");
  });

  it("tira emoji e formatação, que não têm pronúncia", async () => {
    const { toSpeech } = await import("../src/modules/voice/speech-text");

    expect(toSpeech("Bom dia 😄 tudo certo?")).toBe("Bom dia tudo certo?");
    expect(toSpeech("*Promoção* de _verão_, ~esgotada~")).toBe("Promoção de verão, esgotada");
    expect(toSpeech("Oi!!! Tudo bem???")).toBe("Oi! Tudo bem?");
  });

  it("devolve vazio quando não sobra nada para falar", async () => {
    const { toSpeech } = await import("../src/modules/voice/speech-text");

    // Quem chama trata: a resposta sai em texto (ver reply.ts).
    expect(toSpeech("kkkkk 😂")).toBe("");
    expect(toSpeech("   ")).toBe("");
  });

  it("tira também os termos da lista do agente", async () => {
    const { toSpeech } = await import("../src/modules/voice/speech-text");

    // Acento no termo é o caso que o `\b` do JavaScript erraria: "\w" é ASCII,
    // então "né," nunca casaria.
    expect(toSpeech("Fica pronto amanhã, né?", "né")).toBe("Fica pronto amanhã?");
    expect(toSpeech("Então TIPO assim", "tipo")).toBe("Então assim");
    expect(toSpeech("Bom dia, chefia! Vamos marcar?", "chefia\nmeu bem")).toBe(
      "Bom dia! Vamos marcar?",
    );
  });

  it("não deixa a lista do agente colar palavras nem comer pedaço de outra", async () => {
    const { toSpeech } = await import("../src/modules/voice/speech-text");

    // O separador volta no lugar (o replace devolve o grupo da esquerda).
    expect(toSpeech("oi tipo bom dia", "tipo")).toBe("oi bom dia");
    // "tipo" não pode levar "tipografia" junto.
    expect(toSpeech("Mandei a tipografia certa", "tipo")).toBe("Mandei a tipografia certa");
    // Termo de uma letra é ignorado: casaria com meia conversa.
    expect(toSpeech("a agenda está aberta", "a")).toBe("a agenda está aberta");
  });

  it("a lista soma com a limpeza padrão, nunca a substitui", async () => {
    const { toSpeech } = await import("../src/modules/voice/speech-text");

    // Ninguém deveria precisar digitar "kkkk" para o agente parar de rir.
    expect(toSpeech("kkkk beleza então, né", "né")).toBe("beleza então");
  });

  it("normaliza a lista crua do banco (linha vazia, repetida, espaço)", async () => {
    const { parseSpeechBlocklist } = await import("../src/modules/voice/speech-text");

    expect(parseSpeechBlocklist("  né \n\nNÉ\ntipo\n")).toEqual(["né", "tipo"]);
    expect(parseSpeechBlocklist(null)).toEqual([]);
    // Linha antiga, editada à mão ou colada de planilha não derruba o áudio:
    // o excesso é ignorado na leitura, em silêncio.
    expect(parseSpeechBlocklist(Array.from({ length: 80 }, (_, i) => `t${i}`).join("\n")))
      .toHaveLength(40);
  });
});
