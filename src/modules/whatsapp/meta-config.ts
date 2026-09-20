import { createHmac, timingSafeEqual } from "node:crypto";
import { decryptSecret } from "@/lib/crypto";
import { getWhatsAppProvider } from "./index";
import type { WhatsAppProvider } from "./provider";

/** Campos mínimos para resolver o adapter sem fazer outra consulta ao banco. */
export type WhatsappProviderInstance = {
  provider: string;
  externalId: string | null;
  metaPhoneNumberId: string | null;
  metaBusinessAccountId: string | null;
  metaAccessTokenEncrypted: string | null;
  metaAppSecretEncrypted?: string | null;
  metaVerifyTokenEncrypted?: string | null;
};

export const WHATSAPP_PROVIDER_SELECT = {
  provider: true,
  externalId: true,
  metaPhoneNumberId: true,
  metaBusinessAccountId: true,
  metaAccessTokenEncrypted: true,
  metaAppSecretEncrypted: true,
  metaVerifyTokenEncrypted: true,
} as const;

/**
 * Resolve o provider da linha. Credencial Meta ilegível produz adapter não
 * configurado, nunca token cifrado no header Authorization.
 */
export function getWhatsAppProviderForInstance(
  instance: WhatsappProviderInstance,
): WhatsAppProvider {
  const name = instance.provider === "meta" ? "meta" : "evolution";
  if (name === "evolution") return getWhatsAppProvider("evolution");

  const accessToken = instance.metaAccessTokenEncrypted
    ? decryptSecret(instance.metaAccessTokenEncrypted)
    : null;
  return getWhatsAppProvider("meta", {
    phoneNumberId: instance.metaPhoneNumberId ?? instance.externalId ?? "",
    accessToken: accessToken ?? "",
    businessAccountId: instance.metaBusinessAccountId,
  });
}

export function readMetaWebhookSecrets(instance: WhatsappProviderInstance): {
  appSecret: string | null;
  verifyToken: string | null;
} {
  return {
    appSecret: instance.metaAppSecretEncrypted
      ? decryptSecret(instance.metaAppSecretEncrypted)
      : null,
    verifyToken: instance.metaVerifyTokenEncrypted
      ? decryptSecret(instance.metaVerifyTokenEncrypted)
      : null,
  };
}

/** Valida `X-Hub-Signature-256` sobre os bytes exatos recebidos. */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !appSecret) return false;
  const receivedHex = signatureHeader.slice("sha256=".length);
  if (!/^[a-f\d]{64}$/i.test(receivedHex)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(receivedHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function metaWebhookUrl(tenantId: string): string {
  const base = (
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3001"
  ).replace(/\/$/, "");
  return `${base}/api/webhooks/whatsapp/meta/${tenantId}`;
}
