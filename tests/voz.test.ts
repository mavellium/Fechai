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
});
