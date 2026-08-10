/**
 * Transcrição de mensagem de voz do WhatsApp para texto.
 *
 * Mesma filosofia da chain de fallback do chat: tenta o Gemini (áudio nativo
 * via inline_data) e, se falhar ou faltar chave, cai no Whisper da Groq
 * (endpoint compatível com OpenAI). Se nenhuma chave existir ou tudo falhar,
 * devolve `null` — o webhook ignora o áudio em vez de quebrar o turno.
 */

const TRANSCRIBE_GEMINI_MODEL = "gemini-2.5-flash";
const TRANSCRIBE_PROMPT =
  "Este é um áudio de mensagem de voz de WhatsApp. Transcreva fielmente o que a pessoa falou. Devolva apenas o texto falado, sem comentários.";

export async function transcribeAudio(base64: string, mime: string): Promise<string | null> {
  const errors: string[] = [];

  if (process.env.GEMINI_API_KEY) {
    try {
      const text = await transcribeWithGemini(base64, mime);
      if (text) return text;
      errors.push("gemini: transcrição vazia");
    } catch (err) {
      errors.push(`gemini: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (process.env.GROQ_API_KEY) {
    try {
      const text = await transcribeWithGroq(base64, mime);
      if (text) return text;
      errors.push("groq: transcrição vazia");
    } catch (err) {
      errors.push(`groq: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) console.error("[transcribe] todas as transcrições falharam", errors);
  return null;
}

async function transcribeWithGemini(base64: string, mime: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TRANSCRIBE_GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: TRANSCRIBE_PROMPT },
              { inlineData: { mimeType: mime, data: base64 } },
            ],
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gemini transcribe HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini devolveu transcrição vazia");
  return text;
}

async function transcribeWithGroq(base64: string, mime: string): Promise<string> {
  const blob = new Blob([Buffer.from(base64, "base64")], { type: mime });
  const form = new FormData();
  form.append("file", blob, "audio.ogg");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "pt");
  form.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Groq transcribe HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { text?: string };
  const text = (json.text ?? "").trim();
  if (!text) throw new Error("Groq devolveu transcrição vazia");
  return text;
}
