import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getWhatsAppProviderForInstance,
  readMetaWebhookSecrets,
  verifyMetaWebhookSignature,
  WHATSAPP_PROVIDER_SELECT,
} from "@/modules/whatsapp/meta-config";
import { processIncomingWhatsapp } from "@/modules/whatsapp/process-incoming";
import {
  parseMetaMessages,
  parseMetaStatuses,
} from "@/modules/whatsapp/meta-events";
import { receiveBroadcastReceipt } from "@/modules/broadcasts/receipts";
import { recordBroadcastResponse } from "@/modules/broadcasts/outcomes";

function sameSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function metaInstance(tenantId: string) {
  return prisma.whatsappInstance.findFirst({
    where: {
      tenantId,
      provider: "meta",
      tenant: { metaWhatsappEnabled: true },
    },
    select: { status: true, ...WHATSAPP_PROVIDER_SELECT },
  });
}

/** Handshake que a Meta faz ao salvar a Callback URL no painel do app. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;
  const query = new URL(req.url).searchParams;
  const mode = query.get("hub.mode") ?? "";
  const received = query.get("hub.verify_token") ?? "";
  const challenge = query.get("hub.challenge") ?? "";
  const instance = await metaInstance(tenantId);
  if (!instance) return new Response("Not found", { status: 404 });

  const { verifyToken } = readMetaWebhookSecrets(instance);
  if (
    mode !== "subscribe" ||
    !verifyToken ||
    !sameSecret(received, verifyToken)
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/** Eventos assinados com o App Secret da conta Meta deste tenant. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;
  const instance = await metaInstance(tenantId);
  if (!instance) {
    return NextResponse.json({
      ignored: "instância desconhecida ou desconectada",
    });
  }

  const rawBody = await req.text();
  const { appSecret } = readMetaWebhookSecrets(instance);
  if (
    !appSecret ||
    !verifyMetaWebhookSignature(
      rawBody,
      req.headers.get("x-hub-signature-256"),
      appSecret,
    )
  ) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  const payload = (() => {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return null;
    }
  })();
  const provider = getWhatsAppProviderForInstance(instance);
  let failed = false;
  const receipts = parseMetaStatuses(payload).filter(
    (r) => r.phoneNumberId === instance.metaPhoneNumberId,
  );
  for (const receipt of receipts) {
    try {
      await receiveBroadcastReceipt(tenantId, receipt);
    } catch {
      failed = true;
    }
  }
  const messages =
    instance.status === "connected"
      ? parseMetaMessages(payload).filter(
          (m) => m.instanceExternalId === instance.metaPhoneNumberId,
        )
      : [];
  // Um evento com falha não impede os demais. A reentrega usa o id de cada mensagem.
  for (const incoming of messages) {
    try {
      const result = await processIncomingWhatsapp(incoming, provider);
      if ((result.status ?? 200) >= 400) failed = true;
      else if (!incoming.isReaction && incoming.messageKeyId)
        await recordBroadcastResponse(
          tenantId,
          incoming.fromPhone,
          incoming.messageKeyId,
          incoming.occurredAt,
        );
    } catch {
      failed = true;
    }
  }
  return NextResponse.json(
    { ok: !failed, messages: messages.length, receipts: receipts.length },
    { status: failed ? 500 : 200 },
  );
}
