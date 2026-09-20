import type {
  CreateInstanceResult,
  IncomingMessage,
  WhatsAppProvider,
  WhatsAppStatus,
} from "./provider";

/**
 * Credenciais de uma conta na WhatsApp Cloud API oficial.
 *
 * O token chega aqui já decifrado. Quem lê/grava o banco passa sempre por
 * `modules/whatsapp/meta-config.ts`; este adapter não conhece Prisma nem cifra.
 */
export type MetaCloudCredentials = {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId?: string | null;
};

const DEFAULT_GRAPH_VERSION = "v26.0";

type MetaErrorBody = {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
};

function graphVersion(): string {
  const configured = (process.env.META_GRAPH_API_VERSION ?? DEFAULT_GRAPH_VERSION).trim();
  return /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_GRAPH_VERSION;
}

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, "")}`;
}

async function metaError(label: string, res: Response): Promise<Error> {
  const raw = await res.text().catch(() => "");
  let detail = raw.slice(0, 300);
  try {
    const json = JSON.parse(raw) as MetaErrorBody;
    const code = json.error?.code ? ` (código ${json.error.code})` : "";
    detail = `${json.error?.message ?? detail}${code}`;
  } catch {
    // Corpo não JSON: a amostra limitada acima é mais útil que esconder tudo.
  }
  return new Error(`${label} falhou (${res.status})${detail ? `: ${detail}` : ""}`);
}

/** Adapter da API oficial da Meta (WhatsApp Business Platform / Cloud API). */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = "meta";

  constructor(private readonly credentials: MetaCloudCredentials) {}

  isConfigured(): boolean {
    return Boolean(this.credentials.phoneNumberId && this.credentials.accessToken);
  }

  private headers(json = true): HeadersInit {
    return {
      Authorization: `Bearer ${this.credentials.accessToken}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  async createInstance(tenantId: string): Promise<CreateInstanceResult> {
    void tenantId;
    const state = await this.getConnectionState(this.credentials.phoneNumberId);
    if (!state.reachable || !state.exists || state.status !== "connected") {
      throw new Error("A Meta não confirmou o Phone Number ID com este token.");
    }
    return { externalId: this.credentials.phoneNumberId, status: "connected" };
  }

  /** A Cloud API não usa QR; esta chamada apenas revalida as credenciais. */
  async getQrCode(externalId: string): Promise<{ status: WhatsAppStatus; qrCode?: string }> {
    const state = await this.getConnectionState(externalId);
    return { status: state.status };
  }

  async getConnectionState(
    externalId: string,
  ): Promise<{ status: WhatsAppStatus; exists: boolean; reachable: boolean }> {
    try {
      const fields = "id,display_phone_number,verified_name,quality_rating";
      const res = await fetch(`${graphUrl(externalId)}?fields=${encodeURIComponent(fields)}`, {
        headers: this.headers(false),
      });
      if (res.ok) return { status: "connected", exists: true, reachable: true };
      // A Meta respondeu: rede está de pé, mas o id/token não dá acesso ao
      // número. Para o produto isto é desconectado (e não indisponibilidade).
      return {
        status: "disconnected",
        exists: res.status !== 404,
        reachable: true,
      };
    } catch {
      return { status: "disconnected", exists: true, reachable: false };
    }
  }

  async getPhoneProfile(externalId = this.credentials.phoneNumberId): Promise<{
    displayPhone: string | null;
    verifiedName: string | null;
  }> {
    const fields = "id,display_phone_number,verified_name";
    const res = await fetch(`${graphUrl(externalId)}?fields=${encodeURIComponent(fields)}`, {
      headers: this.headers(false),
    });
    if (!res.ok) throw await metaError("Meta Cloud API", res);
    const data = (await res.json()) as {
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
    };
    if (data.id !== externalId) throw new Error("A Meta devolveu um Phone Number ID diferente.");
    return {
      displayPhone: data.display_phone_number ?? null,
      verifiedName: data.verified_name ?? null,
    };
  }

  async sendMessage(externalId: string, toPhone: string, text: string): Promise<string | null> {
    const res = await fetch(graphUrl(`${externalId}/messages`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhone,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
    if (!res.ok) throw await metaError("Meta sendMessage", res);
    const data = (await res.json()) as { messages?: { id?: string }[] };
    return data.messages?.[0]?.id ?? null;
  }

  async sendAudio(
    externalId: string,
    toPhone: string,
    audio: { base64: string; mime: string },
  ): Promise<string | null> {
    // A Cloud API envia mídia por id: primeiro sobe o OGG/Opus, depois
    // referencia o id no /messages. Não se usa URL temporária nem CDN pública.
    const bytes = Buffer.from(audio.base64, "base64");
    if (bytes.length === 0) throw new Error("Áudio vazio.");

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", audio.mime);
    form.append("file", new Blob([bytes], { type: audio.mime }), "resposta.ogg");

    const upload = await fetch(graphUrl(`${externalId}/media`), {
      method: "POST",
      headers: this.headers(false),
      body: form,
    });
    if (!upload.ok) throw await metaError("Meta uploadAudio", upload);
    const uploaded = (await upload.json()) as { id?: string };
    if (!uploaded.id) throw new Error("A Meta não devolveu o id do áudio enviado.");

    const res = await fetch(graphUrl(`${externalId}/messages`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhone,
        type: "audio",
        audio: { id: uploaded.id, voice: true },
      }),
    });
    if (!res.ok) throw await metaError("Meta sendAudio", res);
    const data = (await res.json()) as { messages?: { id?: string }[] };
    return data.messages?.[0]?.id ?? null;
  }

  /**
   * Não desregistra o número da Meta: isso removeria o telefone do WABA, uma
   * ação muito mais destrutiva que "desconectar do fechai". A action apenas
   * muda o estado local e o webhook passa a ignorar eventos desta conta.
   */
  async disconnect(externalId: string): Promise<void> {
    void externalId;
  }

  /** Inscreve o app no WABA quando o id foi informado. */
  async ensureWebhook(externalId: string): Promise<boolean> {
    void externalId;
    const wabaId = this.credentials.businessAccountId?.trim();
    if (!wabaId) return false;
    const res = await fetch(graphUrl(`${wabaId}/subscribed_apps`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    if (!res.ok) throw await metaError("Meta subscribed_apps", res);
    return true;
  }

  async getMediaAsBase64(
    externalId: string,
    mediaId: string,
  ): Promise<{ base64: string; mime: string }> {
    void externalId;
    const metadata = await fetch(graphUrl(mediaId), { headers: this.headers(false) });
    if (!metadata.ok) throw await metaError("Meta getMedia", metadata);
    const info = (await metadata.json()) as { url?: string; mime_type?: string };
    if (!info.url) throw new Error("A Meta não devolveu a URL temporária da mídia.");

    // A URL temporária continua exigindo o mesmo bearer token.
    const media = await fetch(info.url, { headers: this.headers(false) });
    if (!media.ok) throw await metaError("Meta downloadMedia", media);
    const bytes = Buffer.from(await media.arrayBuffer());
    if (bytes.length === 0) throw new Error("A Meta devolveu uma mídia vazia.");
    return {
      base64: bytes.toString("base64"),
      mime: info.mime_type ?? media.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async addParticipantToGroup(
    externalId: string,
    groupId: string,
    phone: string,
  ): Promise<void> {
    void externalId;
    void groupId;
    void phone;
    // A Cloud API oficial atende conversas individuais; ela não expõe a gestão
    // de participantes de grupos que a Evolution/Baileys oferece.
    throw new Error("A API oficial da Meta não permite adicionar participantes a grupos.");
  }

  parseWebhook(payload: unknown): IncomingMessage | null {
    const p = payload as {
      object?: string;
      entry?: Array<{
        changes?: Array<{
          field?: string;
          value?: {
            metadata?: { phone_number_id?: string };
            contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
            messages?: Array<{
              id?: string;
              from?: string;
              type?: string;
              text?: { body?: string };
              audio?: { id?: string; mime_type?: string; voice?: boolean };
              reaction?: { message_id?: string; emoji?: string };
            }>;
          };
        }>;
      }>;
    };

    if (p?.object !== "whatsapp_business_account") return null;
    const change = p.entry?.flatMap((entry) => entry.changes ?? []).find((c) => {
      return c.field === "messages" && Boolean(c.value?.messages?.[0]);
    });
    const value = change?.value;
    const message = value?.messages?.[0];
    const phoneNumberId = value?.metadata?.phone_number_id ?? "";
    const fromPhone = message?.from ?? value?.contacts?.[0]?.wa_id ?? "";
    if (!message || !phoneNumberId || !fromPhone) return null;

    const isAudio = message.type === "audio" && Boolean(message.audio?.id);
    const isReaction = message.type === "reaction";
    const text = isReaction ? (message.reaction?.emoji ?? "") : (message.text?.body ?? "");
    if (!text && !isAudio) return null;

    return {
      instanceExternalId: phoneNumberId,
      fromPhone,
      fromName: value?.contacts?.[0]?.profile?.name,
      text,
      isGroup: false,
      hasAudio: isAudio,
      mediaId: message.audio?.id,
      messageKeyId: message.id,
      isReaction,
      // A Meta não ecoa mensagens de saída como `messages`; entrega status em
      // outro bloco. Toda mensagem parseável aqui veio do contato.
      isFromMe: false,
    };
  }
}
