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

  async sendMessage(externalId: string, toPhone: string, text: string): Promise<string | null> {
    const res = await fetch(`${this.baseUrl}/message/sendText/${externalId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ number: toPhone, text }),
    });
    if (!res.ok) throw new Error(`Evolution sendMessage falhou (${res.status})`);
    // A resposta traz o key.id da mensagem criada — usado pelo webhook para
    // não gravar duas vezes o que a própria instância enviou (fromMe).
    const data = (await res.json()) as { key?: { id?: string } };
    return data.key?.id ?? null;
  }

  async sendAudio(
    externalId: string,
    toPhone: string,
    audio: { base64: string; mime: string },
  ): Promise<string | null> {
    // `/message/sendWhatsAppAudio` (e não `sendMedia`) é o que produz uma
    // mensagem de VOZ: a Evolution converte para o opus/ogg do PTT e o WhatsApp
    // mostra a onda com play. `sendMedia` com o mesmo arquivo entregaria um
    // anexo de áudio — que toca, mas parece um documento na conversa.
    const res = await fetch(`${this.baseUrl}/message/sendWhatsAppAudio/${externalId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ number: toPhone, audio: audio.base64 }),
    });
    if (!res.ok) {
      throw new Error(
        `Evolution sendWhatsAppAudio falhou (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as { key?: { id?: string } };
    return data.key?.id ?? null;
  }

  async addParticipantToGroup(externalId: string, groupId: string, phone: string): Promise<void> {
    // `/group/updateParticipant` com action "add" — mesma família de
    // endpoints de grupo da Evolution v2. O número vai sem sufixo de JID (a
    // API monta o `@s.whatsapp.net` internamente, igual sendText).
    const res = await fetch(
      `${this.baseUrl}/group/updateParticipant/${externalId}?groupJid=${encodeURIComponent(groupId)}`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ action: "add", participants: [phone] }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Evolution updateParticipant falhou (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
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
          reactionMessage?: { text?: string; key?: { remoteJid?: string } };
        };
      };
    };
    const data = p?.data;
    // Sem data não dá para processar nada. `fromMe` agora DESCE até o webhook:
    // o dono respondendo pelo próprio WhatsApp é uma mensagem de ida, mas o
    // painel precisa dela no histórico — quem decide é a rota, que deduplica
    // pelo key.id contra o que o app já gravou ao enviar.
    if (!data) return null;

    // Reação (emoji sobreposta a uma mensagem): não é uma mensagem do cliente.
    // O webhook encerra a conversa com a opção "Encerrar conversa com emoji",
    // mas nunca dispara turno do agente (nem entra no histórico).
    const reaction = data.message?.reactionMessage;
    const text =
      reaction?.text ??
      data.message?.conversation ??
      data.message?.extendedTextMessage?.text ??
      "";
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
      isReaction: Boolean(reaction),
      isFromMe: Boolean(data.key?.fromMe),
    };
  }
}
