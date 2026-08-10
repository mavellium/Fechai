// Interface do provedor de WhatsApp. Abstrai a Evolution API para permitir
// trocar por WhatsApp Cloud API depois sem tocar no motor de conversa.

export type WhatsAppStatus = "disconnected" | "pending_qr" | "connected";

export type CreateInstanceResult = {
  externalId: string;
  status: WhatsAppStatus;
  qrCode?: string; // data URL ou base64 do QR, quando pending_qr
};

export type IncomingMessage = {
  instanceExternalId: string;
  fromPhone: string;
  fromName?: string;
  text: string;
  /** true quando a mensagem veio de um grupo do WhatsApp (@g.us). */
  isGroup: boolean;
  /** A mensagem é de áudio (voz ou arquivo) — transcrita antes do turno. */
  hasAudio: boolean;
  /** Reação a uma mensagem (emoji sobreposta) — não é uma mensagem do cliente. */
  isReaction?: boolean;
  /** id da mensagem no WhatsApp (key.id) — necessário para baixar a mídia. */
  messageKeyId?: string;
};

export interface WhatsAppProvider {
  readonly name: string;
  isConfigured(): boolean;
  createInstance(tenantId: string): Promise<CreateInstanceResult>;
  getQrCode(externalId: string): Promise<{ status: WhatsAppStatus; qrCode?: string }>;
  sendMessage(externalId: string, toPhone: string, text: string): Promise<void>;
  /** Desloga o número da instância (exige novo QR para voltar). */
  disconnect(externalId: string): Promise<void>;
  /** Baixa a mídia de uma mensagem recebida em base64 (ex.: mensagem de voz). */
  getMediaAsBase64(
    externalId: string,
    messageKeyId: string,
  ): Promise<{ base64: string; mime: string }>;
  // onMessageReceived é implementado via webhook (ver api/webhooks/whatsapp).
  // O provider expõe apenas o parser do payload recebido.
  parseWebhook(payload: unknown): IncomingMessage | null;
}
