/**
 * O que se sabe de um áudio recebido pelo WhatsApp sem precisar ouvi-lo.
 *
 * O relatório mensal soma quanto tempo de áudio o agente ouviu no lugar da
 * recepção. A Evolution informa a duração no payload; a Meta não, então ela é
 * lida do próprio arquivo, que o webhook já baixa para guardar e transcrever.
 */

/**
 * Texto gravado em `Message.content` quando o áudio não foi transcrito (escuta
 * desligada ou transcrição falhou). Nesses casos a IA não ouviu o áudio — o
 * relatório usa este marcador para não contar como tempo que o agente assumiu.
 */
export const UNTRANSCRIBED_AUDIO = "[Áudio]";

const CAPTURE = Buffer.from("OggS", "latin1");

/**
 * Duração em segundos inteiros de um áudio OGG (Opus ou Vorbis), ou `null`
 * quando não dá para medir. Nota de voz do WhatsApp é sempre OGG/Opus; arquivo
 * de áudio anexado (mp3, m4a, amr) volta `null` — "não medido", nunca zero.
 * Nunca lança: medir é conveniência, não pode derrubar o webhook.
 *
 * No OGG, cada página traz a posição (em amostras) do fim do último pacote que
 * ela fecha. A última página com posição válida marca a duração total; no Opus
 * a posição é sempre em 48 kHz e desconta o `pre-skip` do cabeçalho.
 */
export function audioDurationSeconds(audio: Buffer): number | null {
  try {
    if (audio.length < 28 || !audio.subarray(0, 4).equals(CAPTURE) || audio[4] !== 0) return null;
    const serial = audio.readUInt32LE(14);
    const head = audio.subarray(27 + audio[26]);
    let rate: number;
    let preSkip = 0;
    if (head.subarray(0, 8).toString("latin1") === "OpusHead") {
      rate = 48_000;
      preSkip = head.readUInt16LE(10);
    } else if (head[0] === 1 && head.subarray(1, 7).toString("latin1") === "vorbis") {
      rate = head.readUInt32LE(12);
    } else return null;
    if (!rate) return null;

    for (let at = audio.lastIndexOf(CAPTURE); at > 0; at = audio.lastIndexOf(CAPTURE, at - 1)) {
      // "OggS" também pode aparecer por acaso dentro dos dados de áudio: só
      // vale a página com cabeçalho completo e do mesmo fluxo da primeira.
      if (at + 27 > audio.length || audio[at + 4] !== 0 || audio.readUInt32LE(at + 14) !== serial) continue;
      const granule = audio.readBigInt64LE(at + 6);
      if (granule < BigInt(0)) continue; // -1: nenhum pacote termina nesta página
      const seconds = (Number(granule) - preSkip) / rate;
      return Number.isFinite(seconds) && seconds > 0 && seconds < 86_400 ? Math.max(1, Math.round(seconds)) : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Duração informada pelo provedor, quando é um número plausível. */
export function reportedAudioSeconds(value: unknown): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 && seconds < 86_400 ? Math.max(1, Math.round(seconds)) : undefined;
}
