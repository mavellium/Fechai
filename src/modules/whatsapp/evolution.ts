import type {
  WhatsAppProvider,
  CreateInstanceResult,
  IncomingMessage,
  WhatsAppStatus,
} from "./provider";

// Adapter da Evolution API (self-hosted). Docs variam por versão; os endpoints
// abaixo seguem a v2 (/instance/create, /instance/connect, /message/sendText).
export class EvolutionProvider implements WhatsAppProvider {
  readonly name = "evolution";
  private baseUrl = process.env.EVOLUTION_API_URL ?? "";
  private apiKey = process.env.EVOLUTION_API_KEY ?? "";

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  private headers() {
    return { "Content-Type": "application/json", apikey: this.apiKey };
  }

  private instanceName(tenantId: string) {
    return `tenant_${tenantId}`;
  }

  async createInstance(tenantId: string): Promise<CreateInstanceResult> {
    const instanceName = this.instanceName(tenantId);
    const res = await fetch(`${this.baseUrl}/instance/create`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
    });
    // 403 = instância já existe; conectar nela em vez de tentar recriar.
    if (res.status === 403) {
      const { status, qrCode } = await this.getQrCode(instanceName);
      return { externalId: instanceName, status, qrCode };
    }
    if (!res.ok) throw new Error(`Evolution createInstance falhou (${res.status})`);
    const data = await res.json();
    const qrCode: string | undefined = data?.qrcode?.base64 ?? data?.qrcode?.code;
    return {
      externalId: instanceName,
      status: qrCode ? "pending_qr" : "disconnected",
      qrCode,
    };
  }

  async getQrCode(externalId: string): Promise<{ status: WhatsAppStatus; qrCode?: string }> {
    const res = await fetch(`${this.baseUrl}/instance/connect/${externalId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Evolution connect falhou (${res.status})`);
    const data = await res.json();
    const qrCode: string | undefined = data?.base64 ?? data?.qrcode?.base64;
    const connected = data?.instance?.state === "open" || data?.state === "open";
    return { status: connected ? "connected" : qrCode ? "pending_qr" : "disconnected", qrCode };
  }

  async sendMessage(externalId: string, toPhone: string, text: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/message/sendText/${externalId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ number: toPhone, text }),
    });
    if (!res.ok) throw new Error(`Evolution sendMessage falhou (${res.status})`);
  }

  async disconnect(externalId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/logout/${externalId}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Evolution logout falhou (${res.status})`);
  }

  async getMediaAsBase64(
    externalId: string,
    messageKeyId: string,
  ): Promise<{ base64: string; mime: string }> {
    // Endpoint oficial da v2 para extrair a mídia de uma mensagem recebida.
    // Precisa do id da mensagem (key.id) e de a mídia estar salva no banco —
    // os dois valem aqui (ver DATABASE_SAVE_DATA_NEW_MESSAGE no docker-compose).
    const res = await fetch(`${this.baseUrl}/chat/getBase64FromMediaMessage/${externalId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ message: { key: { id: messageKeyId } }, convertToMp4: false }),
    });
    if (!res.ok) throw new Error(`Evolution getBase64FromMediaMessage falhou (${res.status})`);
    const data = (await res.json()) as { base64?: string; mimetype?: string };
    if (!data.base64) throw new Error("Evolution não devolveu a mídia da mensagem");
    return { base64: data.base64, mime: data.mimetype ?? "audio/ogg" };
  }

  parseWebhook(payload: unknown): IncomingMessage | null {
    // Formato do evento messages.upsert da Evolution API.
    const p = payload as {
      instance?: string;
      data?: {
        key?: { remoteJid?: string; fromMe?: boolean; id?: string };
        pushName?: string;
        message?: {
          conversation?: string;
          extendedTextMessage?: { text?: string };
          audioMessage?: unknown;
          pttMessage?: unknown;
        };
      };
    };
    const data = p?.data;
    if (!data || data.key?.fromMe) return null; // ignora o que nós mesmos enviamos

    const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? "";
    // Voz (pttMessage) e arquivo de áudio (audioMessage) têm a mesma forma.
    const hasAudio = Boolean(data.message?.audioMessage ?? data.message?.pttMessage);
    const jid = data.key?.remoteJid ?? "";
    const fromPhone = jid.split("@")[0];
    if ((!text && !hasAudio) || !fromPhone) return null;

    return {
      instanceExternalId: p.instance ?? "",
      fromPhone,
      fromName: data.pushName,
      text,
      // Grupos têm JID com sufixo @g.us (ex: 5511999999999-1615000000@g.us).
      isGroup: jid.endsWith("@g.us"),
      hasAudio,
      messageKeyId: data.key?.id,
    };
  }
}
