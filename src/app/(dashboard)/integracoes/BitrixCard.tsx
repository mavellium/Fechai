"use client";

import { useActionState, useEffect, useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ContactRound } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { useActionToast } from "@/components/ui/toast/use-save-feedback";
import type { getBitrixStatus } from "@/modules/bitrix/integration";
import { manageBitrixAction, saveBitrixAction } from "./bitrix-actions";

type State = Awaited<ReturnType<typeof getBitrixStatus>>;
export function BitrixCard({ state, available }: { state: State; available: boolean }) {
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  const [result, action, pending] = useActionState(manageBitrixAction, null);
  useActionToast(result, pending, { entity: "conexão Bitrix24", gender: "f" });
  useEffect(() => { if (result?.ok) router.refresh(); }, [result, router]);
  const waiting = (state?.counts.queued ?? 0) + (state?.counts.processing ?? 0);
  return (
    <Card className="max-w-3xl">
      <CardTitle hint="Envia os registros do Fechai para o CRM e o calendário do Bitrix24.">
        <ContactRound aria-hidden className="h-5 w-5" /> Bitrix24
      </CardTitle>
      <p className="mb-4 text-sm text-white/60">
        Cada conta conecta seu próprio portal. Contatos são identificados pelo telefone;
        os agendamentos aparecem como reuniões no CRM e no calendário do responsável.
      </p>
      {!available && <Alert tone="warn">A conexão ainda não está disponível nesta instalação. Avise o suporte.</Alert>}
      {state && (
        <div className="mb-5 space-y-3 rounded-surface border border-white/10 p-4">
          <p className="text-sm text-white/80">{state.portalHost} · {state.connected ? state.enabled ? "Sincronização ativa" : "Sincronização pausada" : "Desconectado"}</p>
          <p className="text-sm text-white/55">
            {state.counts.synced ?? 0} registros sincronizados · {waiting} aguardando envio · {state.counts.retry ?? 0} em conferência
          </p>
          {(state.counts.skipped ?? 0) > 0 && <p className="text-sm text-white/55">
            {state.counts.skipped} registros sem envio: excluídos, testes, consultas sem contato ou canceladas antes do primeiro envio.
          </p>}
          {state.lastSyncAt && <p className="text-xs text-white/45">Já houve envio confirmado ao Bitrix24. Atualize o status para acompanhar os próximos.</p>}
          {state.crmMode === 2 && <p className="text-sm text-white/55">Este portal usa CRM simples: os leads são enviados como negócios vinculados ao contato.</p>}
          {state.errors.map((error) => <Alert tone="warn" key={error}>{error}</Alert>)}
          <form action={action} className="flex flex-wrap gap-2">
            {state.connected && <>
              <Button size="sm" variant="outline" name="operation" value="test" loading={pending}>Testar conexão</Button>
              <Button size="sm" variant="outline" name="operation" value={state.enabled ? "pause" : "resume"} disabled={pending}>
                {state.enabled ? "Pausar" : "Retomar"}
              </Button>
              {(state.counts.retry ?? 0) > 0 && <Button size="sm" variant="outline" name="operation" value="retry" disabled={pending}>Conferir envios</Button>}
              <Button size="sm" variant="destructive" name="operation" value="disconnect" disabled={pending}>Desconectar</Button>
            </>}
            <Button type="button" size="sm" variant="ghost" loading={refreshing} onClick={() => refresh(() => router.refresh())}>Atualizar status</Button>
          </form>
        </div>
      )}
      {state?.connected && state.enabled && state.uncertain.length > 0 && (
        <details className="mb-5 rounded-surface border border-white/10 p-4">
          <summary className="cursor-pointer text-sm text-white/80">Resolver envios sem confirmação</summary>
          <p className="mt-3 text-sm text-white/60">Um envio pode ter chegado ao Bitrix24 mesmo sem resposta. Confira o portal antes de permitir uma nova tentativa.</p>
          <p className="mt-2 text-sm text-white/55">Se o registro já existir, o botão abaixo procura a referência e retoma o envio. Se não existir, marque a confirmação após conferir o CRM.</p>
          <div className="mt-3 space-y-3">
            {state.uncertain.map((job) => <UncertainJob key={job.id} job={job} />)}
          </div>
        </details>
      )}
      {available && <BitrixForm state={state} />}
    </Card>
  );
}
function BitrixForm({ state }: { state: State }) {
  const router = useRouter();
  const id = useId();
  const [result, action, pending] = useActionState(saveBitrixAction, null);
  useActionToast(result, pending, { entity: "conexão Bitrix24", gender: "f" });
  useEffect(() => { if (result?.ok) router.refresh(); }, [result, router]);
  return (
    <UnsavedForm action={action} result={result} label="Conexão Bitrix24" className="space-y-4" resetOnSuccess>
      <details className="rounded-surface border border-white/10 bg-white/5 p-3">
        <summary className="cursor-pointer text-sm font-medium text-white/80">Como conectar o Bitrix24?</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-white/60">
          <li>No Bitrix24, abra Aplicativos → Recursos do desenvolvedor → Outros → Webhook de entrada.</li>
          <li>Autorize o acesso ao CRM e crie o webhook com um usuário que possa ler todos os contatos e cadastrar contatos, leads e reuniões.</li>
          <li>Copie a URL base completa, no formato https://suaempresa.bitrix24.com.br/rest/1/codigo-secreto/.</li>
          <li>Cole abaixo e conecte. Seu plano do Bitrix24 precisa permitir o uso da API.</li>
        </ol>
        <a className="mt-3 inline-block text-sm text-white/70 underline underline-offset-4" href="https://apidocs.bitrix24.com/local-integrations/local-webhooks.html" target="_blank" rel="noopener noreferrer">Ver instruções oficiais</a>
      </details>
      <Field label="URL do webhook de entrada" htmlFor={`${id}-webhook`} hint={state?.connected ? "Deixe vazio para manter a credencial atual. Cole outra URL para renovar o webhook do mesmo portal." : "Use o endereço original do portal Bitrix24 na nuvem. A URL será guardada com criptografia."}>
        <Input {...fieldProps(`${id}-webhook`, { hint: true })} name="webhook" type="password" autoComplete="new-password" maxLength={512} required={!state?.connected} />
      </Field>
      <Field label="ID do responsável (opcional)" htmlFor={`${id}-responsible`} hint="Se deixar vazio, usamos o usuário que criou o webhook. As reuniões aparecem no calendário desse responsável.">
        <Input {...fieldProps(`${id}-responsible`, { hint: true })} name="responsibleId" inputMode="numeric" maxLength={15} defaultValue={state?.responsibleId ?? ""} />
      </Field>
      <p className="text-sm text-white/60">Contatos são enviados sempre que a conexão está ativa.</p>
      <label className="flex items-center gap-2 text-sm text-white/80"><input type="checkbox" className="accent-iris" name="syncLeads" defaultChecked={state?.syncLeads ?? true} /> Enviar leads (negócios no CRM simples)</label>
      <label className="flex items-center gap-2 text-sm text-white/80"><input type="checkbox" className="accent-iris" name="syncAppointments" defaultChecked={state?.syncAppointments ?? true} /> Enviar agendamentos ao calendário</label>
      <p className="text-sm text-white/55">
        Ao conectar, enviamos os contatos existentes e as próximas consultas. Novos registros e alterações seguem automaticamente.
        Cancelamentos mantêm a reunião identificada como cancelada, com a informação nas observações.
        Alterações feitas no Bitrix24 não voltam para o Fechai; a disponibilidade continua sendo consultada pela agenda do Fechai e pelo Clinicorp conectado.
      </p>
      <Button type="submit" loading={pending}>{state?.connected ? "Salvar e ativar" : "Conectar Bitrix24"}</Button>
    </UnsavedForm>
  );
}

function UncertainJob({ job }: { job: { id: string; label: string } }) {
  const router = useRouter();
  const [result, action, pending] = useActionState(manageBitrixAction, null);
  useActionToast(result, pending, { entity: "envio Bitrix24" });
  useEffect(() => { if (result?.ok) router.refresh(); }, [result, router]);
  return <form action={action} className="space-y-2 rounded-control border border-white/10 p-3">
    <input type="hidden" name="operation" value="resolve" />
    <input type="hidden" name="jobId" value={job.id} />
    <p className="text-sm text-white/75">{job.label}</p>
    <label className="flex items-start gap-2 text-sm text-white/60">
      <input type="checkbox" name="confirmedMissing" className="mt-1 accent-iris" />
      Conferi o Bitrix24 e este registro não existe lá. Permitir nova tentativa.
    </label>
    <Button size="sm" variant="outline" loading={pending}>Conferir e retomar este envio</Button>
  </form>;
}
