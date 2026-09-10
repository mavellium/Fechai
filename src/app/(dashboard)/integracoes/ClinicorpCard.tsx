"use client";

import { useActionState, useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Stethoscope } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  connectClinicorpAction,
  disconnectClinicorpAction,
  loadClinicorpCategoriesAction,
  loadClinicorpProfessionalsAction,
  saveClinicorpSettingsAction,
  setClinicorpToggle,
  testClinicorpConnectionAction,
} from "./actions";

export type ClinicorpBusinessOption = { id: string; name: string };

export type ClinicorpState =
  | { connected: false }
  | {
      connected: true;
      subscriberId: string;
      businessId: string | null;
      dentistId: string | null;
      categoryDescription: string | null;
      syncEnabled: boolean;
      checkAvailability: boolean;
      lastError: string | null;
      businesses: ClinicorpBusinessOption[];
    };

/**
 * Conexão com o Clinicorp (sistema de gestão da clínica).
 *
 * Diferente do Google, que tem botão de consentimento: aqui a pessoa cola o
 * usuário e o token que ela mesma gera no Clinicorp, então a tela precisa dizer
 * ONDE encontrar isso — sem esse caminho, a integração trava na primeira tela e
 * vira chamado de suporte.
 */
export function ClinicorpCard({ state }: { state: ClinicorpState }) {
  if (!state.connected) return <ClinicorpConnectForm />;
  return <ClinicorpConnected state={state} />;
}

function ClinicorpConnectForm() {
  const router = useRouter();
  const id = useId();
  const [result, action, pending] = useActionState(connectClinicorpAction, null);

  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);

  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-white/55">
        Conecte para que os horários marcados aqui entrem na agenda da clínica, já ligados à ficha
        do paciente — e para o agente não oferecer um horário que a recepção já ocupou.
      </p>

      <details className="rounded-surface border border-white/10 bg-white/5 p-3">
        <summary className="cursor-pointer text-sm font-medium text-white/80">
          Onde encontro essas credenciais?
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-white/60">
          <li>Entre no Clinicorp.</li>
          <li>Abra <span className="text-white/80">Gerenciar Assinatura</span>.</li>
          <li>Clique em <span className="text-white/80">Acesso Externo e Integrações</span>.</li>
          <li>
            Copie <span className="text-white/80">Usuário API</span> e{" "}
            <span className="text-white/80">Token API</span>.
          </li>
        </ol>
      </details>

      <Field label="Usuário API" htmlFor={`${id}-user`}>
        <Input {...fieldProps(`${id}-user`)} name="apiUser" autoComplete="off" required />
      </Field>

      <Field label="Token API" htmlFor={`${id}-token`}>
        {/* `password`: é uma credencial e a tela pode estar sendo compartilhada. */}
        <Input
          {...fieldProps(`${id}-token`)}
          name="apiToken"
          type="password"
          autoComplete="off"
          required
        />
      </Field>

      <Field
        label="Id do assinante"
        htmlFor={`${id}-subscriber`}
        hint="O identificador da sua conta no Clinicorp (subscriber_id)."
      >
        <Input
          {...fieldProps(`${id}-subscriber`, { hint: true })}
          name="subscriberId"
          autoComplete="off"
          required
        />
      </Field>

      <Button type="submit" size="sm" loading={pending}>
        Conectar Clinicorp
      </Button>

      {result && !result.ok && <Alert tone="danger">{result.error}</Alert>}
    </form>
  );
}

function ClinicorpConnected({ state }: { state: Extract<ClinicorpState, { connected: true }> }) {
  const router = useRouter();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sync" | "availability" | null>(null);
  const [, startTransition] = useTransition();
  const [settings, saveSettings, savingSettings] = useActionState(
    saveClinicorpSettingsAction,
    null,
  );
  // Campos controlados preservam a seleção quando as opções chegam depois da
  // montagem. O envio abaixo evita também o reset nativo após Server Actions.
  const [businessId, setBusinessId] = useState(state.businessId ?? (state.businesses.length === 1 ? state.businesses[0].id : ""));
  const [dentistId, setDentistId] = useState(state.dentistId ?? "");
  const [category, setCategory] = useState(state.categoryDescription ?? "");

  // Os profissionais só são buscados quando a pessoa abre o seletor: são uma
  // chamada de rede ao Clinicorp, e a agenda carrega em toda navegação.
  const [professionals, setProfessionals] = useState<{ id: string; name: string }[] | null>(null);
  const [loadingPros, setLoadingPros] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string }[] | null>(null);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [testing, startTest] = useTransition();
  const [testResult, setTestResult] = useState<{ ok: boolean; info?: string; error?: string } | null>(null);

  function loadProfessionals() {
    if (professionals || loadingPros) return;
    setLoadingPros(true);
    startTransition(async () => {
      const result = await loadClinicorpProfessionalsAction().catch(() => ({ ok: false as const, error: "Não foi possível carregar os profissionais. Tente novamente." }));
      if (result.ok) { setProfessionals(result.data); setError(null); }
      else setError(result.error);
      setLoadingPros(false);
    });
  }

  function loadCategories() {
    if (categories || loadingCategories) return;
    setLoadingCategories(true);
    startTransition(async () => {
      const result = await loadClinicorpCategoriesAction().catch(() => ({ ok: false as const, error: "Não foi possível carregar as categorias. Tente novamente." }));
      if (result.ok) { setCategories(result.data); setError(null); }
      else setError(result.error);
      setLoadingCategories(false);
    });
  }

  function toggle(field: "syncEnabled" | "checkAvailability", next: boolean) {
    setBusy(field === "syncEnabled" ? "sync" : "availability");
    setError(null);
    startTransition(async () => {
      const res = await setClinicorpToggle(field, next);
      if (!res.ok) setError(res.error ?? "Falha ao atualizar.");
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Stethoscope size={16} aria-hidden className="mt-0.5 shrink-0 text-success" />
        <p className="min-w-0 truncate text-sm text-white/70">
          assinante {state.subscriberId}
        </p>
      </div>

      <Button type="button" size="sm" variant="outline" loading={testing} onClick={() => startTest(async () => {
        setTestResult(await testClinicorpConnectionAction().catch(() => ({ ok: false, error: "Não foi possível testar a conexão. Tente novamente." })));
      })}>
        Testar conexão
      </Button>
      {testResult && <Alert tone={testResult.ok ? "success" : "danger"}>{testResult.info ?? testResult.error}</Alert>}

      {/* A credencial pode vencer sem ninguém perceber: o último erro fica à
          vista em vez de só no log do servidor. */}
      {state.lastError && (
        <Alert tone="warn">
          Última tentativa falhou: {state.lastError}
        </Alert>
      )}

      {/* Via onSubmit + transition, pois <form action> dispara um reset nativo
          no commit do React (até selects controlados voltam à primeira opção).
          Preferências devem continuar preenchidas após sucesso ou erro. */}
      <form onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => saveSettings(data));
      }} className="space-y-3">
        <Field
            label="Clínica"
            htmlFor={`${id}-business`}
            hint="Onde os horários marcados aqui vão entrar."
          >
            <Select
              {...fieldProps(`${id}-business`, { hint: true })}
              name="businessId"
              size="sm"
              value={businessId}
              onChange={(event) => setBusinessId(event.target.value)}
              required
            >
              <option value="">Escolha a clínica</option>
              {businessId && !state.businesses.some((b) => b.id === businessId) && (
                <option value={businessId}>Clínica selecionada · {businessId}</option>
              )}
              {state.businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
        </Field>

        <Field
          label="Profissional padrão"
          htmlFor={`${id}-dentist`}
          hint="Escolha quem vai atender para o horário aparecer na agenda desse profissional."
          optional
        >
          <Select
            {...fieldProps(`${id}-dentist`, { hint: true })}
            name="dentistId"
            size="sm"
            value={dentistId}
            onChange={(event) => setDentistId(event.target.value)}
            onFocus={loadProfessionals}
            onMouseDown={loadProfessionals}
          >
            <option value="">Nenhum</option>
            {/* Antes de carregar a lista, o valor já salvo precisa existir como
                opção — senão o select "esquece" a escolha ao renderizar. */}
            {dentistId && !professionals?.some((p) => p.id === dentistId) && (
              <option value={dentistId}>Profissional selecionado · {dentistId}</option>
            )}
            {professionals?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {loadingPros && <p className="text-xs text-white/50" role="status">Carregando profissionais…</p>}
        </Field>

        <Field
          label="Categoria do agendamento"
          htmlFor={`${id}-category`}
          hint="Selecione Avaliação para usar essa categoria e cor na agenda. O procedimento é um campo separado no Clinicorp."
          optional
        >
          <Select
            {...fieldProps(`${id}-category`, { hint: true })}
            name="categoryDescription"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            onFocus={loadCategories}
            onMouseDown={loadCategories}
          >
            <option value="">Sem categoria</option>
            {category && !categories?.some((c) => c.name === category) && (
              <option value={category}>{category} (salva)</option>
            )}
            {categories?.map((c) => (
              <option key={c.id} value={c.name} disabled={categories.filter((other) => other.name === c.name).length > 1}>
                {c.name}{categories.filter((other) => other.name === c.name).length > 1 ? " (nome duplicado no Clinicorp)" : ""}
              </option>
            ))}
          </Select>
          {loadingCategories && <p className="text-xs text-white/50" role="status">Carregando categorias…</p>}
        </Field>

        <Button type="submit" size="sm" variant="outline" loading={savingSettings}>
          Salvar preferências
        </Button>
        {settings && !settings.ok && <Alert tone="danger">{settings.error}</Alert>}
        {settings?.ok && <Alert tone="success">{settings.info}</Alert>}
      </form>

      <div className="space-y-3 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between gap-3">
          <p id="clinicorp-sync-desc" className="text-sm text-white/65">
            Enviar novos horários para o Clinicorp
          </p>
          <Switch
            checked={state.syncEnabled}
            loading={busy === "sync"}
            label={`Enviar para o Clinicorp: ${state.syncEnabled ? "ligado" : "desligado"}`}
            describedBy="clinicorp-sync-desc"
            onCheckedChange={(next) => toggle("syncEnabled", next)}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p id="clinicorp-avail-desc" className="text-sm text-white/65">
            Consultar a agenda da clínica antes de marcar
          </p>
          <Switch
            checked={state.checkAvailability}
            loading={busy === "availability"}
            label={`Consultar a agenda do Clinicorp: ${state.checkAvailability ? "ligado" : "desligado"}`}
            describedBy="clinicorp-avail-desc"
            onCheckedChange={(next) => toggle("checkAvailability", next)}
          />
        </div>
      </div>

      <ConfirmButton
        size="sm"
        confirm={{
          title: "Desconectar o Clinicorp?",
          description:
            "Os horários já enviados continuam lá; os novos deixam de ser enviados e o agente volta a olhar só a agenda daqui. Suas credenciais são apagadas.",
          confirmLabel: "Desconectar",
          tone: "danger",
        }}
        onConfirm={async () => {
          const res = await disconnectClinicorpAction();
          if (!res.ok) setError(res.error ?? "Falha ao desconectar.");
          else router.refresh();
        }}
      >
        Desconectar
      </ConfirmButton>

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
