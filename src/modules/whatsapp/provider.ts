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
};

export interface WhatsAppProvider {
  readonly name: string;
  isConfigured(): boolean;
  createInstance(tenantId: string): Promise<CreateInstanceResult>;
  getQrCode(externalId: string): Promise<{ status: WhatsAppStatus; qrCode?: string }>;
  sendMessage(externalId: string, toPhone: string, text: string): Promise<void>;
  // onMessageReceived é implementado via webhook (ver api/webhooks/whatsapp).
  // O provider expõe apenas o parser do payload recebido.
  parseWebhook(payload: unknown): IncomingMessage | null;
}
