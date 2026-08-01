import { deployTenantWidget } from "../src/lib/widget/deploy";
import { prisma } from "../src/lib/prisma";

// Cada tenant já publica o próprio widget.js sozinho (ensureTenantWidgetDeployed,
// chamado ao abrir /onboarding ou /whatsapp; updateWidgetConfig republica ao
// salvar personalização). NENHUM passo manual é necessário no dia a dia.
//
// Este script só serve pra manutenção: rode-o quando o CÓDIGO do widget mudar
// (src/lib/widget/widget-template.js) — aí é preciso republicar o arquivo de
// todo mundo de uma vez, já que cada tenant tem sua própria cópia na CDN.
async function main() {
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) {
    console.error("[widget:deploy] defina NEXTAUTH_URL no .env (é a origem que o widget chama).");
    process.exit(1);
  }

  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      widgetColor: true,
      widgetGreeting: true,
      widgetIconType: true,
      widgetIconEmoji: true,
      widgetIconUrl: true,
      widgetShape: true,
      widgetBorderColor: true,
    },
  });

  const deployedIds: string[] = [];
  let failed = 0;
  for (const tenant of tenants) {
    const result = await deployTenantWidget({
      tenantId: tenant.id,
      color: tenant.widgetColor,
      greeting: tenant.widgetGreeting,
      iconType: tenant.widgetIconType,
      iconEmoji: tenant.widgetIconEmoji,
      iconUrl: tenant.widgetIconUrl,
      shape: tenant.widgetShape,
      borderColor: tenant.widgetBorderColor,
    });
    if (result.ok) {
      deployedIds.push(tenant.id);
    } else {
      failed++;
      console.error(`[widget:deploy] falhou pro tenant ${tenant.id}:`, result.error);
    }
  }

  if (deployedIds.length > 0) {
    await prisma.tenant.updateMany({
      where: { id: { in: deployedIds } },
      data: { widgetDeployedAt: new Date() },
    });
  }
  console.log(
    `[widget:deploy] concluído — ${deployedIds.length} publicados, ${failed} falharam, de ${tenants.length} tenants.`,
  );
}

main()
  .catch((err) => {
    console.error("[widget:deploy] fatal", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
