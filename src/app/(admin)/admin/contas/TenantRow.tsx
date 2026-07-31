"use client";

import { useState, useTransition } from "react";
import type { PlanKey } from "@prisma/client";
import { PLANS } from "@/modules/billing/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { suspendTenant, changePlan } from "../../actions";

type Props = {
  id: string;
  name: string;
  planKey: PlanKey;
  status: string;
  whatsappStatus: string;
  /** Tenant que contém um SUPERADMIN — conta de plataforma, não cliente. */
  isAdminAccount?: boolean;
  createdAt: string;
  counts: { users: number; leads: number; conversations: number };
};

const WHATSAPP_PT: Record<string, string> = {
  connected: "conectado",
  pending_qr: "aguardando QR",
  disconnected: "desconectado",
};

export function TenantRow(t: Props) {
  const [pending, start] = useTransition();
  const [plan, setPlan] = useState<PlanKey>(t.planKey);
  const suspended = t.status === "suspended";
  const planDirty = plan !== t.planKey;

  return (
    <tr className={`border-t border-white/5 ${suspended ? "bg-danger/10" : ""}`}>
      <td className="px-4 py-4">
        <p className="flex flex-wrap items-center gap-2 font-medium text-white">
          {t.name}
          {t.isAdminAccount && <Badge tone="signal">admin</Badge>}
        </p>
        <p className="font-mono text-micro uppercase tracking-wide text-white/55">
          {t.counts.users} usr · {t.counts.leads} leads · {t.counts.conversations} conv ·{" "}
          {t.createdAt}
        </p>
      </td>

      <td className="px-4 py-4">
        {/*
          Antes o `onChange` do select gravava direto. Além de não ter
          confirmação, no teclado isso troca o plano do cliente a cada seta:
          o navegador dispara `change` em cada opção percorrida. Agora a troca
          só vai ao servidor quando o admin confirma.
        */}
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            value={plan}
            disabled={pending}
            aria-label={`Plano de ${t.name}`}
            onChange={(e) => setPlan(e.target.value as PlanKey)}
            className="w-32"
          >
            {PLANS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>

          {planDirty && (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                loading={pending}
                loadingLabel="Salvando plano"
                onClick={() => start(() => changePlan(t.id, plan))}
              >
                Salvar
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPlan(t.planKey)}>
                Desfazer
              </Button>
            </div>
          )}
        </div>
      </td>

      <td className="px-4 py-4">
        <span className="font-mono text-micro uppercase tracking-wide text-white/60">
          {WHATSAPP_PT[t.whatsappStatus] ?? t.whatsappStatus}
        </span>
      </td>

      <td className="px-4 py-4">
        <Badge tone={suspended ? "danger" : "success"}>{suspended ? "Suspenso" : "Ativo"}</Badge>
      </td>

      <td className="px-4 py-4 text-right">
        <ConfirmButton
          size="sm"
          variant={suspended ? "outline" : "destructive"}
          disabled={pending}
          confirm={
            suspended
              ? {
                  title: `Reativar ${t.name}?`,
                  description:
                    "A conta volta a acessar o painel e o agente volta a responder os leads.",
                  confirmLabel: "Reativar conta",
                }
              : {
                  title: `Suspender ${t.name}?`,
                  description:
                    "A pessoa é bloqueada do painel na próxima navegação e o agente para de atender. Dá para reativar depois.",
                  confirmLabel: "Suspender conta",
                  tone: "danger",
                }
          }
          onConfirm={() => start(() => suspendTenant(t.id, !suspended))}
        >
          {suspended ? "Reativar" : "Suspender"}
        </ConfirmButton>
      </td>
    </tr>
  );
}
