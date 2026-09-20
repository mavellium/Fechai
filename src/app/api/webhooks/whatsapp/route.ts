import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { processIncomingWhatsapp } from "@/modules/whatsapp/process-incoming";

/** Webhook exclusivo da Evolution. A Cloud API oficial usa `/meta/[tenantId]`. */
const SECRET_HEADER = "x-webhook-secret";

function isAuthorized(req: Request): boolean {
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!expected) {
    console.error(
      "[whatsapp webhook] WHATSAPP_WEBHOOK_SECRET não configurada — recusando. " +
        "Gere uma com: openssl rand -base64 32",
    );
    return false;
  }
  const received = req.headers.get(SECRET_HEADER) ?? "";
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const provider = getWhatsAppProvider("evolution");
  const incoming = provider.parseWebhook(payload);
  if (!incoming) return NextResponse.json({ ignored: true });

  const result = await processIncomingWhatsapp(incoming, provider);
  return NextResponse.json(result.body, { status: result.status ?? 200 });
}
