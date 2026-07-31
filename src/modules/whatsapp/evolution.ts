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

  parseWebhook(payload: unknown): IncomingMessage | null {
    // Formato do evento messages.upsert da Evolution API.
    const p = payload as {
      instance?: string;
      data?: {
        key?: { remoteJid?: string; fromMe?: boolean };
        pushName?: string;
        message?: { conversation?: string; extendedTextMessage?: { text?: string } };
      };
    };
    const data = p?.data;
    if (!data || data.key?.fromMe) return null; // ignora o que nós mesmos enviamos

    const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? "";
    const jid = data.key?.remoteJid ?? "";
    const fromPhone = jid.split("@")[0];
    if (!text || !fromPhone) return null;

    return {
      instanceExternalId: p.instance ?? "",
      fromPhone,
      fromName: data.pushName,
      text,
    };
  }
}
