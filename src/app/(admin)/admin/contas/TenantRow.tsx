"use client";

import { useRef, useState, useTransition } from "react";
import { Eye, Trash2 } from "lucide-react";
import type { PlanKey } from "@prisma/client";
import { PLANS, planOf } from "@/modules/billing/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import {
  suspendTenant,
  changePlan,
  setTenantUsageLimit,
  setTenantTrial,
  impersonateUser,
  deleteTenantAccount,
} from "../../actions";

type Props = {
  id: string;
  name: string;
  planKey: PlanKey;
  status: string;
  whatsappStatus: string;
  /** Cota de mensagens/mês fixada fora do padrão do plano (null = usa o plano). */
  messageLimitOverride: number | null;
  /** Fim do período de teste (ISO); null = sem teste em andamento. */
  trialEndsAt: string | null;
  /** O plano da conta é de teste por tempo (hoje só o grátis). */
  planIsTrial: boolean;
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
    String(t.messageLimitOverride ?? planOf(t.planKey).messagesPerMonth),
  );
  const suspended = t.status === "suspended";
  const planDirty = plan !== t.planKey;
  const [impError, setImpError] = useState<string | null>(null);

  // Exclusão definitiva: diálogo próprio (em vez de ConfirmButton) porque aqui
  // não basta um "confirmar" — o admin digita o nome da conta. A lista tem
  // nomes parecidos e não há desfazer.
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteArmed = deleteTyped.trim() === t.name.trim();

  function openDelete() {
    setDeleteTyped("");
    setDeleteError(null);
    deleteDialog.current?.showModal();
  }

  function confirmDelete() {
    if (!deleteArmed) return;
    setDeleteError(null);
    start(async () => {
      const result = await deleteTenantAccount(t.id);
      if (result?.ok) {
        deleteDialog.current?.close();
        return;
      }
      // A conta continua na lista: mostra o motivo no próprio diálogo, onde o
      // admin está olhando, em vez de fechar como se tivesse dado certo.
      setDeleteError(result?.error ?? "Não foi possível excluir a conta.");
    });
  }

  function impersonate(userId: string) {
    setImpError(null);
    start(async () => {
      const result = await impersonateUser(userId);
      if (result && !result.ok) setImpError(result.error ?? "Não foi possível personificar.");
    });
  }

  const planDefault = planOf(t.planKey).messagesPerMonth;
  const limitValue = Math.trunc(Number(limitInput));
  const limitInvalid = !Number.isInteger(limitValue) || limitValue < 0;
  const limitDirty = limitInvalid || limitValue !== (t.messageLimitOverride ?? planDefault);

  const trialUntil = t.trialEndsAt ? new Date(t.trialEndsAt) : null;
  const trialActive = Boolean(trialUntil && trialUntil > new Date());
  const trialDaysLeft = trialActive
    ? Math.ceil((trialUntil!.getTime() - new Date().getTime()) / 86_400_000)
    : 0;

  function saveLimits() {
    if (limitInvalid) return;
    // Valor igual ao padrão do plano não precisa virar override — volta a seguir o plano.
    start(() => setTenantUsageLimit(t.id, limitValue === planDefault ? null : limitValue));
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
            <label className="sr-only" htmlFor={`${t.id}-mensagens`}>
              Cota de mensagens de {t.name}
            </label>
            <input
              id={`${t.id}-mensagens`}
              type="number"
              min={0}
              step={1}
              value={limitInput}
              disabled={pending}
              aria-label={`Cota de mensagens por mês de ${t.name}`}
              onChange={(e) => setLimitInput(e.target.value)}
              className="w-24 rounded-control border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs text-white focus:border-iris focus:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            />
            <span className="font-mono text-micro uppercase tracking-wide text-white/55">msg/mês</span>
          </div>

          {limitDirty && (
            <div className="flex items-center gap-1">
              <Button size="sm" loading={pending} loadingLabel="Salvando cota" onClick={saveLimits}>
                Salvar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setLimitInput(String(t.messageLimitOverride ?? planDefault))}
              >
                Desfazer
              </Button>
            </div>
          )}
        </div>
        <p className="mt-1 font-mono text-micro uppercase tracking-wide text-white/55">
          padrão: {planDefault.toLocaleString("pt-BR")} msg
          {t.messageLimitOverride != null && (
            <>
              {" · "}
              <button
                type="button"
                disabled={pending}
                onClick={() => start(() => setTenantUsageLimit(t.id, null))}
                className="underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
              >
                restaurar padrão
              </button>
            </>
          )}
        </p>

        {/* Período de teste: só faz sentido em plano de teste (grátis). Passada
            a data, a IA para e a conta só volta assinando. */}
        {t.planIsTrial && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {trialActive ? (
              <>
                <Badge tone="signal">
                  teste · {trialDaysLeft} dia{trialDaysLeft === 1 ? "" : "s"}
                </Badge>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(() => setTenantTrial(t.id, null))}
                  className="font-mono text-micro uppercase tracking-wide text-white/55 underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                >
                  encerrar
                </button>
              </>
            ) : (
              <>
                <Badge tone="danger">teste encerrado</Badge>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(() => setTenantTrial(t.id, 7))}
                  className="font-mono text-micro uppercase tracking-wide text-white/55 underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                >
                  dar +7 dias
                </button>
              </>
            )}
          </div>
        )}
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

            {/* Só depois de suspensa — e nunca para conta de admin. A action
                revalida as duas coisas no servidor; isto é só a tela. */}
            {suspended && !t.isAdminAccount && (
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                title="Excluir esta conta e todos os seus dados, definitivamente"
                aria-label={`Excluir definitivamente a conta ${t.name}`}
                onClick={openDelete}
              >
                <Trash2 size={15} aria-hidden />
                Excluir
              </Button>
            )}
          </div>
          {impError && (
            <p role="alert" className="max-w-56 text-right font-mono text-micro text-danger">
              {impError}
            </p>
          )}
        </div>

        <dialog
          ref={deleteDialog}
          aria-labelledby={`${t.id}-excluir-titulo`}
          className="m-auto w-[calc(100%-2rem)] max-w-md rounded-surface border border-white/15 bg-ink p-6 text-left text-white backdrop:bg-ink/70"
          onClose={() => {
            setDeleteTyped("");
            setDeleteError(null);
          }}
        >
          <h2 id={`${t.id}-excluir-titulo`} className="font-display text-lg font-semibold">
            Excluir {t.name} definitivamente?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/65">
            Apaga a conta e tudo que pertence a ela: {t.counts.users} usuário
            {t.counts.users === 1 ? "" : "s"}, {t.counts.leads} lead
            {t.counts.leads === 1 ? "" : "s"}, {t.counts.conversations} conversa
            {t.counts.conversations === 1 ? "" : "s"} com todo o histórico, agentes, base de
            conhecimento, agendamentos e credenciais de integração. O WhatsApp é desconectado e os
            arquivos saem da CDN. <strong className="text-white">Não há como desfazer.</strong>
          </p>

          <label
            htmlFor={`${t.id}-excluir-nome`}
            className="mt-4 block font-mono text-micro uppercase tracking-wide text-white/55"
          >
            Digite <span className="text-white">{t.name}</span> para confirmar
          </label>
          <input
            id={`${t.id}-excluir-nome`}
            type="text"
            autoComplete="off"
            value={deleteTyped}
            disabled={pending}
            onChange={(e) => setDeleteTyped(e.target.value)}
            className="mt-1.5 w-full rounded-control border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          />

          {deleteError && (
            <p role="alert" className="mt-3 font-mono text-micro text-danger">
              {deleteError}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => deleteDialog.current?.close()}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteArmed}
              loading={pending}
              loadingLabel="Excluindo conta"
              onClick={confirmDelete}
            >
              Excluir para sempre
            </Button>
          </div>
        </dialog>
      </td>
    </tr>
  );
}
