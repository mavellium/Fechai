import type { CommissionStatus, ReferralStatus } from "@prisma/client";

/**
 * Rótulos em português dos estados de indicação e comissão.
 *
 * Ficam fora dos componentes porque a mesma tradução é usada no painel do
 * afiliado e na aba de Relatórios — e um enum traduzido de dois jeitos
 * diferentes na mesma conta parece bug.
 */

export const REFERRAL_LABELS: Record<ReferralStatus, { label: string; tone: "neutral" | "iris" | "success" | "warn" }> = {
  CLICK: { label: "Clicou", tone: "neutral" },
  SIGNED_UP: { label: "Criou conta", tone: "iris" },
  CONVERTED: { label: "Assinante", tone: "success" },
  CHURNED: { label: "Cancelou", tone: "warn" },
};

export const COMMISSION_LABELS: Record<
  CommissionStatus,
  { label: string; tone: "neutral" | "iris" | "success" | "warn"; hint: string }
> = {
  PENDING: {
    label: "Em análise",
    tone: "neutral",
    hint: "Aguardando a janela de 30 dias para estorno.",
  },
  APPROVED: {
    label: "Liberada",
    tone: "iris",
    hint: "Disponível para saque.",
  },
  PAID: {
    label: "Paga",
    tone: "success",
    hint: "Já transferida via Pix.",
  },
  CANCELED: {
    label: "Cancelada",
    tone: "warn",
    hint: "O pagamento de origem foi estornado.",
  },
};
