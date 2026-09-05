/**
 * Cliente da Fish Audio — a voz do agente.
 *
 * Duas operações, e elas são bem diferentes uma da outra:
 *
 *   `cloneVoice()`  cria um MODELO de voz a partir de uma amostra da voz da
 *                   pessoa (POST /model, multipart). Acontece uma vez, no
 *                   painel, e devolve um id que fica guardado no `Agent`.
 *   `synthesize()`  transforma o texto da resposta em áudio usando esse
 *                   modelo (POST /v1/tts). Acontece a cada resposta em áudio.
 *
 * A chave é DA PLATAFORMA (`FISH_AUDIO_API_KEY`), como as dos LLMs — o cliente
 * não cria conta na Fish Audio, o custo entra na conta do plano. É por isso que
 * o modelo de voz nasce `private`: a amostra é a voz real de um cliente nosso,
 * e a conta da Fish é compartilhada por todos os tenants. `unlist` já bastaria
 * para não aparecer na busca deles, mas "quem tiver o link ouve" não é uma
 * promessa que dá para fazer sobre a voz de outra pessoa.
 *
 * Nenhuma função aqui lança para o chamador em caminho de conversa: o WhatsApp
 * do cliente não pode ficar sem resposta porque um terceiro está fora do ar —
 * `synthesize()` devolve `null` e quem chama manda a resposta em texto, que é a
 * degradação certa (a pessoa recebe o atendimento, só não em voz). `cloneVoice()`
 * é a exceção e devolve erro explicado: ali a pessoa está parada na tela
 * esperando o resultado, e "falhou em silêncio" viraria um botão quebrado.
 */

const API_BASE = "https://api.fish.audio";

/**
 * Chain de modelos, na ordem de preferência — mesma ideia do fallback de LLM do
 * projeto (Gemini → Grok → Groq).
 *
 * `s2.1-pro` é o de produção. `s2.1-pro-free` é o MESMO modelo a custo zero,
 * sem garantia de latência (TTFA) nem DPA — bom o suficiente para a conta
 * continuar falando quando o crédito da API acaba.
 *
 * Por que fallback e não uma variável de ambiente: crédito zerado não é uma
 * decisão de instalação, é um estado que acontece sozinho no meio do mês. Sem
 * isto, a primeira resposta depois de acabar o saldo viraria texto e ninguém
 * saberia por quê — o log de 402 fica registrado, mas o cliente continua sendo
 * atendido em voz.
 *
 * A escolha vive aqui, e não no `.env`, porque trocar de modelo muda como a voz
 * soa: é decisão de produto, não de instalação.
 */
const TTS_MODELS = ["s2.1-pro", "s2.1-pro-free"] as const;

/**
 * Teto de texto que vira áudio numa resposta.
 *
 * TTS cobra por caractere e demora proporcional ao tamanho: uma resposta longa
 * viraria um áudio de minutos que ninguém ouve até o fim, cobrado inteiro. Não
 * é o limite da API — é o ponto em que áudio deixa de ser melhor que texto.
 * Acima disso quem chama manda texto (ver `speakReply`).
 */
export const MAX_TTS_CHARS = 800;

/** Amostra de voz: limites do que aceitamos ANTES de gastar chamada na Fish. */
export const VOICE_SAMPLE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB
export const VOICE_SAMPLE_MIN_BYTES = 8 * 1024; // ~0,5s: abaixo disso é clique, não fala

export function isFishAudioConfigured(): boolean {
  return Boolean(process.env.FISH_AUDIO_API_KEY);
}

function authHeader(): Record<string, string> {
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) throw new Error("FISH_AUDIO_API_KEY não configurada");
  return { Authorization: `Bearer ${key}` };
}

export type CloneVoiceResult =
  | { ok: true; referenceId: string }
  | { ok: false; error: string };

/**
 * Cria o modelo de voz na Fish Audio a partir da amostra gravada/enviada.
 *
 * `train_mode: "fast"` é o único aceito para TTS e deixa o modelo utilizável na
 * hora — sem fila de treino para a tela ter que acompanhar depois.
 *
 * Não mandamos `texts` (a transcrição da amostra) de propósito: sem ele a Fish
 * roda ASR na própria amostra. Transcrição errada digitada pela pessoa piora a
 * clonagem, e não temos como validar o que ela digitou contra o que ela falou.
 */
export async function cloneVoice(input: {
  audio: Buffer;
  mime: string;
  /** Vira o nome do modelo no painel da Fish — use algo que identifique o tenant. */
  title: string;
}): Promise<CloneVoiceResult> {
  if (!isFishAudioConfigured()) {
    return { ok: false, error: "A voz do agente não está disponível nesta instalação." };
  }

  const form = new FormData();
  form.append("type", "tts");
  form.append("train_mode", "fast");
  form.append("title", input.title);
  form.append("visibility", "private");
  form.append(
    "voices",
    new Blob([new Uint8Array(input.audio)], { type: input.mime }),
    fileNameFor(input.mime),
  );

  try {
    const res = await fetch(`${API_BASE}/model`, {
      method: "POST",
      // Sem Content-Type: o fetch monta o boundary do multipart sozinho.
      headers: authHeader(),
      body: form,
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error("[fish-audio] cloneVoice HTTP", res.status, detail);
      return { ok: false, error: cloneErrorFor(res.status) };
    }

    const json = (await res.json()) as { _id?: string; id?: string };
    const referenceId = json._id ?? json.id;
    if (!referenceId) {
      console.error("[fish-audio] cloneVoice sem id na resposta", json);
      return { ok: false, error: "A Fish Audio não devolveu a voz criada. Tente de novo." };
    }
    return { ok: true, referenceId };
  } catch (err) {
    console.error("[fish-audio] cloneVoice falhou", err);
    return { ok: false, error: "Não foi possível criar a voz agora. Tente de novo em instantes." };
  }
}

/** Mensagem para a pessoa na tela — o status cru não ajuda quem está gravando. */
function cloneErrorFor(status: number): string {
  if (status === 401 || status === 403) {
    return "A chave da Fish Audio desta instalação foi recusada. Avise o suporte.";
  }
  if (status === 402) return "Os créditos de voz desta instalação acabaram. Avise o suporte.";
  if (status === 413) return "A gravação é grande demais. Grave algo em torno de 30 segundos.";
  if (status === 422) {
    return "A Fish Audio não conseguiu usar esta gravação. Grave de novo, falando de forma contínua e sem ruído de fundo.";
  }
  if (status === 429) return "Muitas gravações seguidas. Espere um minuto e tente de novo.";
  return "Não foi possível criar a voz agora. Tente de novo em instantes.";
}

/** Apaga o modelo na Fish Audio. Best-effort: quem chama já decidiu esquecer a voz. */
export async function deleteVoice(referenceId: string): Promise<void> {
  if (!isFishAudioConfigured()) return;
  try {
    const res = await fetch(`${API_BASE}/model/${encodeURIComponent(referenceId)}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    // 404 = já não existe lá, que é o estado que queríamos de todo jeito.
    if (!res.ok && res.status !== 404) {
      console.error("[fish-audio] deleteVoice HTTP", res.status);
    }
  } catch (err) {
    console.error("[fish-audio] deleteVoice falhou", err);
  }
}

export type Synthesized = { audio: Buffer; mime: string };

/**
 * Texto → áudio na voz do modelo. Devolve `null` em qualquer falha.
 *
 * Formato: **opus**, porque é o codec das mensagens de voz do WhatsApp. Pedir
 * mp3 faria a Evolution/Baileys transcodificar (ou entregar como arquivo de
 * áudio em vez de mensagem de voz, sem a onda e o play de PTT).
 */
export async function synthesize(input: {
  text: string;
  referenceId: string;
}): Promise<Synthesized | null> {
  if (!isFishAudioConfigured()) return null;

  const text = input.text.trim();
  if (!text) return null;

  for (const model of TTS_MODELS) {
    try {
      const res = await fetch(`${API_BASE}/v1/tts`, {
        method: "POST",
        headers: {
          ...authHeader(),
          "Content-Type": "application/json",
          model,
        },
        body: JSON.stringify({
          text,
          reference_id: input.referenceId,
          format: "opus",
          // "balanced" troca um pouco de qualidade por latência. Aqui tem alguém
          // esperando a resposta no WhatsApp, e o texto já passou pelo LLM antes.
          latency: "balanced",
          normalize: true,
        }),
      });

      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        console.error("[fish-audio] synthesize HTTP", res.status, `(${model})`, detail);
        // 402 (sem crédito de API) é o caso que o próximo modelo resolve. Os
        // outros erros — chave inválida, texto recusado, indisponibilidade —
        // se repetiriam igual no modelo seguinte: não insiste.
        if (res.status === 402) continue;
        return null;
      }

      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.length === 0) {
        console.error("[fish-audio] synthesize devolveu áudio vazio", `(${model})`);
        return null;
      }
      return { audio, mime: "audio/ogg" };
    } catch (err) {
      // Falha de rede: tentar o outro modelo é a mesma rota e o mesmo host,
      // então não ajudaria — desiste e quem chama manda texto.
      console.error("[fish-audio] synthesize falhou", `(${model})`, err);
      return null;
    }
  }

  return null;
}

/** A Fish identifica o formato pela extensão do arquivo no multipart. */
function fileNameFor(mime: string): string {
  const ext = mime.includes("mpeg") || mime.includes("mp3")
    ? "mp3"
    : mime.includes("wav")
      ? "wav"
      : mime.includes("webm")
        ? "webm"
        : mime.includes("mp4") || mime.includes("m4a")
          ? "m4a"
          : "ogg";
  return `amostra.${ext}`;
}
