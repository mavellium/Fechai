"use client";

import { useState, useTransition } from "react";
import { Eye } from "lucide-react";
import type { PlanKey } from "@prisma/client";
import { PLANS, planOf } from "@/modules/billing/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { suspendTenant, changePlan, setTenantUsageLimit, impersonateUser } from "../../actions";

type Props = {
  id: string;
  name: string;
  planKey: PlanKey;
  status: string;
  whatsappStatus: string;
  /** Limite de conversas/mês fixado fora do padrão do plano (null = usa o plano). */
  conversationLimitOverride: number | null;
  /** Teto de respostas da IA por conversa fixado fora do padrão (null = limite × 3). */
  perConversationCapOverride: number | null;
  /** Tenant que contém um SUPERADMIN — conta de plataforma, não cliente. */
  isAdminAccount?: boolean;
  /** Usuário usado ao clicar em "Ver como" (dono da conta). */
  ownerUserId?: string;
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
  const [limitInput, setLimitInput] = useState<string>(
    String(t.conversationLimitOverride ?? planOf(t.planKey).conversationsPerMonth),
  );
  const [capInput, setCapInput] = useState<string>(
    String(t.perConversationCapOverride ?? planOf(t.planKey).conversationsPerMonth * 3),
  );
  const suspended = t.status === "suspended";
  const planDirty = plan !== t.planKey;
  const [impError, setImpError] = useState<string | null>(null);

  function impersonate(userId: string) {
    setImpError(null);
    start(async () => {
      const result = await impersonateUser(userId);
      if (result && !result.ok) setImpError(result.error ?? "Não foi possível personificar.");
    });
  }

  const planDefault = planOf(t.planKey).conversationsPerMonth;
  const capDefault = planDefault * 3;
  const limitValue = Math.trunc(Number(limitInput));
  const limitDirty =
    !Number.isInteger(limitValue) || limitValue < 0 || limitValue !== (t.conversationLimitOverride ?? planDefault);
  const capValue = Math.trunc(Number(capInput));
  const capDirty =
    !Number.isInteger(capValue) || capValue < 0 || capValue !== (t.perConversationCapOverride ?? capDefault);

  function saveLimits() {
    if (limitDirty || capDirty) return;
    // Valor igual ao padrão do plano não precisa virar override — volta a seguir o plano.
    start(() =>
      setTenantUsageLimit(
        t.id,
        limitValue === planDefault ? null : limitValue,
        capValue === capDefault ? null : capValue,
      ),
    );
  }

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
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`${t.id}-conversas`}>
              Limite de conversas de {t.name}
            </label>
            <input
              id={`${t.id}-conversas`}
              type="number"
              min={0}
              step={1}
              value={limitInput}
              disabled={pending}
              aria-label={`Limite de conversas de ${t.name}`}
              onChange={(e) => setLimitInput(e.target.value)}
              className="w-24 rounded-control border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs text-white focus:border-iris focus:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            />
            <span className="font-mono text-micro uppercase tracking-wide text-white/55">conv</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`${t.id}-respostas`}>
              Teto de respostas da IA por conversa de {t.name}
            </label>
            <input
              id={`${t.id}-respostas`}
              type="number"
              min={0}
              step={1}
              value={capInput}
              disabled={pending}
              aria-label={`Teto de respostas da IA por conversa de ${t.name}`}
              onChange={(e) => setCapInput(e.target.value)}
              className="w-24 rounded-control border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs text-white focus:border-iris focus:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            />
            <span className="font-mono text-micro uppercase tracking-wide text-white/55">resp</span>
          </div>

          {(limitDirty || capDirty) && (
            <div className="flex items-center gap-1">
              <Button size="sm" loading={pending} loadingLabel="Salvando limites" onClick={saveLimits}>
                Salvar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setLimitInput(String(t.conversationLimitOverride ?? planDefault));
                  setCapInput(String(t.perConversationCapOverride ?? capDefault));
                }}
              >
                Desfazer
              </Button>
            </div>
          )}
        </div>
        <p className="mt-1 font-mono text-micro uppercase tracking-wide text-white/55">
          padrão: {planDefault.toLocaleString("pt-BR")} conv · {capDefault.toLocaleString("pt-BR")} resp
          {(t.conversationLimitOverride != null || t.perConversationCapOverride != null) && (
            <>
              {" · "}
              <button
                type="button"
                disabled={pending}
                onClick={() => start(() => setTenantUsageLimit(t.id, null, null))}
                className="underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
              >
                restaurar padrão
              </button>
            </>
          )}
        </p>
      </td>

      <td className="px-4 py-4">
        <span className="font-mono text-micro uppercase tracking-wide text-white/60">
          {WHATSAPP_PT[t.whatsappStatus] ?? t.whatsappStatus}
        </span>
      </td>

      <td className="px-4 py-4">
        <Badge tone={suspended ? "danger" : "success"}>{suspended ? "Suspenso" : "Ativo"}</Badge>
      </td>

      <td className="px-4 py-4">
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || !t.ownerUserId || Boolean(t.isAdminAccount)}
              title={
                t.isAdminAccount
                  ? "Conta do admin — não é possível personificar"
                  : t.ownerUserId
                    ? "Entrar no painel como essa conta"
                    : "Conta sem usuário para personificar"
              }
              aria-label={`Ver o painel como ${t.name}`}
              onClick={() => t.ownerUserId && impersonate(t.ownerUserId)}
            >
              <Eye size={15} aria-hidden />
              Ver como
            </Button>
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
          </div>
          {impError && (
            <p role="alert" className="max-w-56 text-right font-mono text-micro text-danger">
              {impError}
            </p>
          )}
        </div>
      </td>
    </tr>
  );
}
