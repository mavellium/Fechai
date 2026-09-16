/**
 * Quando o agente responde em ÁUDIO, e o que fazer quando ele não consegue.
 *
 * A regra é espelhar o cliente: mandou áudio, recebe áudio; escreveu, recebe
 * texto. Isso mantém a conversa parecida com uma conversa (ninguém manda voz
 * para quem está digitando no trabalho) e segura o custo — TTS é cobrado por
 * caractere, e a maioria das mensagens é texto.
 *
 * Falar é sempre OPCIONAL: se a voz não estiver configurada, se o texto for
 * longo demais ou se a Fish Audio falhar, a resposta sai em texto. O contato
 * recebe o atendimento em qualquer cenário — só não em voz. Por isso este
 * módulo não lança: ele decide, tenta e informa o que conseguiu.
 *
 * O texto da resposta é gravado no histórico pelo orquestrador de qualquer
 * forma, independente de virar áudio: é o que vai pro contexto do LLM no
 * próximo turno e é o que o dono lê em /conversas. O áudio é uma forma de
 * entrega, não um conteúdo diferente.
 */

import { MAX_TTS_CHARS, isFishAudioConfigured, synthesize } from "./fish";
import { toSpeech } from "./speech-text";

/** O que o agente precisa saber para decidir se fala. Vem do `Agent`. */
export type VoiceSettings = {
  /** Opção "Responder com áudio" do agente. */
  speakReplies: boolean;
  /** Id do modelo de voz na Fish Audio. Null = a pessoa ainda não gravou a voz. */
  voiceId: string | null;
  /**
   * O que este agente não pronuncia (`Agent.speechBlocklist`, um termo por
   * linha). Opcional: agente sem lista fala com a limpeza padrão, que já tira
   * risada escrita e emoji.
   */
  speechBlocklist?: string | null;
  /**
   * Como a voz se comporta (`Agent.voiceStyle`, ver `voice/style.ts`).
   * Omitido ou desconhecido = neutra, que é o padrão do produto.
   */
  voiceStyle?: string | null;
};

export type SpokenReply =
  | { spoken: true; audio: Buffer; mime: string }
  /** `reason` é para o log/sandbox entender o silêncio — não vai para o contato. */
  | {
      spoken: false;
      reason: "off" | "no_voice" | "not_audio" | "too_long" | "nothing_to_say" | "failed";
    };

/**
 * Decide e produz o áudio da resposta.
 *
 * `incomingWasAudio` é o espelho: só falamos de volta para quem falou. O
 * sandbox passa `true` explicitamente para deixar a pessoa ouvir a própria voz
 * do agente sem precisar do WhatsApp.
 */
export async function speakReply(input: {
  text: string;
  settings: VoiceSettings;
  incomingWasAudio: boolean;
}): Promise<SpokenReply> {
  const { settings, text } = input;

  if (!settings.speakReplies || !isFishAudioConfigured()) return { spoken: false, reason: "off" };
  if (!settings.voiceId) return { spoken: false, reason: "no_voice" };
  if (!input.incomingWasAudio) return { spoken: false, reason: "not_audio" };

  // Resposta longa vai em texto: um áudio de vários minutos é pior de consumir
  // que o mesmo conteúdo escrito, e custa proporcionalmente.
  if (text.trim().length > MAX_TTS_CHARS) return { spoken: false, reason: "too_long" };

  // Resposta que só tem risada escrita e emoji ("kkkk 😄") não tem áudio
  // possível: `toSpeech()` a esvazia inteira (ver speech-text.ts). Sai em
  // texto, como o WhatsApp já esperava, e sem gastar uma síntese paga para
  // descobrir isso — a mesma lógica do corte por tamanho logo acima.
  const blocklist = settings.speechBlocklist ?? "";
  if (!toSpeech(text, blocklist)) return { spoken: false, reason: "nothing_to_say" };

  const audio = await synthesize({
    text,
    referenceId: settings.voiceId,
    blocklist,
    style: settings.voiceStyle,
  });
  if (!audio) return { spoken: false, reason: "failed" };

  return { spoken: true, audio: audio.audio, mime: audio.mime };
}
