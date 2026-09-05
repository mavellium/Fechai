/**
 * Onde mora o áudio de uma mensagem de voz depois de enviada.
 *
 * O arquivo vai para a CDN (Bunny), a mesma que já guarda os documentos da base
 * de conhecimento, e a `Message` guarda só a URL. Binário no Postgres incharia
 * o banco e todos os backups — o projeto já evitou esse caminho uma vez, no
 * upload da base de conhecimento.
 *
 * Guardar é **best-effort**: falhar aqui não pode cancelar um envio que já
 * chegou no WhatsApp do cliente. Sem URL, a mensagem existe no histórico com o
 * texto (transcrito ou ditado) e sem player — o que se perde é reouvir, não a
 * conversa.
 */

import { uploadToBunny } from "@/lib/bunny";

/**
 * Sobe o áudio e devolve a URL pública, ou `null` se não deu (CDN não
 * configurada, upload falhou). Nunca lança.
 *
 * O caminho leva `tenantId` para o arquivo ficar rastreável até a conta e para
 * nunca colidir entre tenants.
 */
export async function storeVoiceMessage(input: {
  tenantId: string;
  conversationId: string;
  audio: Buffer;
  /** `audio/ogg` para o que sai daqui; o gravado à mão pode ser webm/mp4. */
  mime: string;
}): Promise<string | null> {
  const ext = extensionFor(input.mime);
  const path = `voz/${input.tenantId}/${input.conversationId}/${Date.now()}.${ext}`;

  try {
    const uploaded = await uploadToBunny(path, input.audio, input.mime);
    if (uploaded.ok) return uploaded.url;
    console.error("[voice] falha ao guardar áudio na CDN", uploaded.error);
    return null;
  } catch (err) {
    console.error("[voice] erro ao guardar áudio na CDN", err);
    return null;
  }
}

function extensionFor(mime: string): string {
  const type = mime.split(";")[0].trim();
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";
  if (type.includes("webm")) return "webm";
  return "ogg";
}
