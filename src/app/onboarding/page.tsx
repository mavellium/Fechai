import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PLAN_BY_KEY } from "@/modules/billing/plans";
import { isStepNumber, parseDraft, FIRST_STEP } from "@/modules/tenants/onboarding-wizard";
import { ensureTenantWidgetDeployed } from "@/lib/widget/deploy";
import { OnboardingWizard } from "./OnboardingWizard";

/**
 * Onboarding guiado do usuário comum (OWNER). Uma rota, uma página: os 4
 * passos são estado do client component — não há navegação entre rotas.
 *
 * requireOwner() já manda o SUPERADMIN para o painel dele, então o wizard
 * nunca aparece para o usuário avançado.
 */
export default async function OnboardingPage() {
  const session = await requireOwner();

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: {
      name: true,
      planKey: true,
      status: true,
      onboardingCompleted: true,
      onboardingStep: true,
      onboardingDraft: true,
      whatsappInstance: { select: { status: true } },
    },
  });

  if (!tenant) redirect("/login");
  // Já passou por aqui: o wizard não volta a aparecer.
  if (tenant.onboardingCompleted) redirect("/inicio");
  // Conta suspensa não configura nada — o painel mostra o aviso e o suporte.
  if (tenant.status === "suspended") redirect("/inicio");

  // Publica o widget.js do tenant na CDN sozinho — o snippet do passo 4 já
  // funciona sem precisar visitar /whatsapp antes.
  await ensureTenantWidgetDeployed(session.user.tenantId);

  return (
    <OnboardingWizard
      businessName={tenant.name}
      tenantId={session.user.tenantId}
      planLabel={PLAN_BY_KEY[tenant.planKey].name}
      actionLimit={PLAN_BY_KEY[tenant.planKey].maxActiveActions}
      whatsappStatus={tenant.whatsappInstance?.status ?? "disconnected"}
      initialStep={isStepNumber(tenant.onboardingStep) ? tenant.onboardingStep : FIRST_STEP}
      initialDraft={parseDraft(tenant.onboardingDraft)}
    />
  );
}
