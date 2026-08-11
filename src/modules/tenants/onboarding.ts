import { prisma } from "@/lib/prisma";
import { AVAILABLE_ACTIONS } from "@/modules/agent-engine/actions";

export type OnboardingStep = {
  key: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
  /**
   * Passo que não trava a conclusão do setup.
   *
   * Existe porque um passo cujo `done` é fixo em `false` prendia a conta em modo
   * "configuração" para sempre: o progresso nunca chegava a 100% e a home nunca
   * podia virar tela de uso diário. Opcional continua aparecendo na lista — só
   * não conta para o "terminei".
   */
  optional?: boolean;
};

/** Passos que precisam estar feitos para a conta ser considerada no ar. */
export function requiredSteps(steps: OnboardingStep[]) {
  return steps.filter((s) => !s.optional);
}

export function setupComplete(steps: OnboardingStep[]) {
  const required = requiredSteps(steps);
  return required.length > 0 && required.every((s) => s.done);
}

// Calcula o status de cada passo do onboarding a partir do estado real no banco.
// Alguns passos (site/sandbox) só ficam "done" nos milestones seguintes.
export async function getOnboardingSteps(tenantId: string): Promise<OnboardingStep[]> {
  const [agentWithPrompt, docCount, enabledActions, whatsapp, messageCount] = await Promise.all([
    // Basta UM agente configurado para o passo contar como feito — a conta
    // pode ter vários, e exigir todos travaria o checklist para sempre.
    prisma.agent.findFirst({
      where: { tenantId, archived: false, NOT: { systemPrompt: "" } },
      select: { id: true },
    }),
    prisma.knowledgeDocument.count({ where: { tenantId } }),
    prisma.tenantAction.count({
      where: { tenantId, enabled: true, key: { in: AVAILABLE_ACTIONS.map((a) => a.key) } },
    }),
    prisma.whatsappInstance.findUnique({ where: { tenantId }, select: { status: true } }),
    prisma.message.count({ where: { conversation: { tenantId } } }),
  ]);

  return [
    {
      key: "persona",
      title: "Ensinar o agente a falar do seu jeito",
      description: "Responda algumas perguntas para ele atender como você atenderia.",
      href: "/agentes",
      done: Boolean(agentWithPrompt),
    },
    {
      key: "knowledge",
      title: "Enviar informações do seu negócio",
      description: "Suba um documento (preços, horários, regras) para ele responder certinho.",
      href: "/agentes",
      done: docCount > 0,
    },
    {
      key: "actions",
      title: "Escolher o que o agente pode fazer",
      description: "Ative as tarefas que ele pode resolver sozinho, como agendar ou qualificar.",
      href: "/agentes",
      done: enabledActions > 0,
    },
    {
      key: "whatsapp",
      title: "Conectar seu número de WhatsApp",
      description: "Aponte a câmera do celular para o código e pronto.",
      href: "/integracoes",
      done: whatsapp?.status === "connected",
    },
    {
      key: "site",
      title: "Colocar o agente no seu site",
      description: "Copie um código pronto e envie para quem cuida do seu site.",
      href: "/integracoes",
      // Não há como detectar a instalação do widget no site do cliente (o
      // Milestone 5 é quem traz isso). Até lá o passo é opcional: contá-lo como
      // pendente travava o checklist em 5/6 para todo mundo, para sempre.
      done: false,
      optional: true,
    },
    {
      key: "sandbox",
      title: "Fazer um teste de conversa",
      description: "Converse com o agente aqui mesmo, sem precisar do WhatsApp.",
      href: "/conversas",
      done: messageCount > 0,
    },
  ];
}
