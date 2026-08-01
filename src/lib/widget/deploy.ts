import { readFileSync } from "fs";
import { join } from "path";
import { uploadToBunny } from "@/lib/bunny";
import { prisma } from "@/lib/prisma";

export type WidgetConfig = {
  color: string;
  greeting: string;
  iconType: string; // "emoji" | "image"
  iconEmoji: string;
  iconUrl: string | null;
  shape: string; // "circle" | "rounded" | "square"
  borderColor: string | null;
};

const WIDGET_CONFIG_SELECT = {
  widgetColor: true,
  widgetGreeting: true,
  widgetIconType: true,
  widgetIconEmoji: true,
  widgetIconUrl: true,
  widgetShape: true,
  widgetBorderColor: true,
} as const;

/**
 * Gera e publica o widget.js de UM tenant na CDN — sem passo manual. Cada
 * tenant tem seu próprio arquivo (`widget/{tenantId}/widget.js`) com toda a
 * personalização já embutida no código, então o snippet no site do cliente
 * não precisa de `data-*` nem de uma chamada extra pra buscar config.
 *
 * Chamado automaticamente: na primeira vez que a tela de instalação é aberta
 * (whatsapp/page.tsx) e sempre que a personalização é salva (updateWidgetConfig).
 */
export async function deployTenantWidget(
  input: { tenantId: string } & WidgetConfig,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) return { ok: false, error: "NEXTAUTH_URL não configurada" };

  const templatePath = join(process.cwd(), "src", "lib", "widget", "widget-template.js");
  const template = readFileSync(templatePath, "utf-8");

  const content = template
    .replace("__API_ORIGIN__", JSON.stringify(origin.replace(/\/$/, "")))
    .replace("__TENANT_ID__", JSON.stringify(input.tenantId))
    .replace("__WIDGET_COLOR__", JSON.stringify(input.color))
    .replace("__WIDGET_GREETING__", JSON.stringify(input.greeting))
    .replace("__WIDGET_ICON_TYPE__", JSON.stringify(input.iconType))
    .replace("__WIDGET_ICON_EMOJI__", JSON.stringify(input.iconEmoji))
    .replace("__WIDGET_ICON_URL__", JSON.stringify(input.iconUrl))
    .replace("__WIDGET_SHAPE__", JSON.stringify(input.shape))
    .replace("__WIDGET_BORDER_COLOR__", JSON.stringify(input.borderColor));

  return uploadToBunny(
    `widget/${input.tenantId}/widget.js`,
    Buffer.from(content, "utf-8"),
    "application/javascript",
  );
}

/**
 * Publica o widget.js do tenant na primeira vez que alguma tela que mostra o
 * snippet é aberta (onboarding, whatsapp) — no-op se já foi publicado antes.
 * É o que elimina qualquer passo manual: o tenant nunca precisa saber que
 * existe um arquivo pra gerar.
 */
export async function ensureTenantWidgetDeployed(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { ...WIDGET_CONFIG_SELECT, widgetDeployedAt: true },
  });
  if (!tenant || tenant.widgetDeployedAt) return;

  const deployed = await deployTenantWidget({
    tenantId,
    color: tenant.widgetColor,
    greeting: tenant.widgetGreeting,
    iconType: tenant.widgetIconType,
    iconEmoji: tenant.widgetIconEmoji,
    iconUrl: tenant.widgetIconUrl,
    shape: tenant.widgetShape,
    borderColor: tenant.widgetBorderColor,
  });
  if (deployed.ok) {
    await prisma.tenant.update({ where: { id: tenantId }, data: { widgetDeployedAt: new Date() } });
  } else {
    console.error("[widget] falha ao publicar automaticamente", deployed.error);
  }
}
