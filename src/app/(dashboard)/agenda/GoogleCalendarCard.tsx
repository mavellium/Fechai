"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { disconnectGoogleAction, setGoogleSyncEnabled } from "./actions";

export type GoogleState =
  | { configured: false }
  | { configured: true; connected: false }
  | { configured: true; connected: true; accountEmail: string | null; syncEnabled: boolean };

/**
 * Conexão opcional com o Google Agenda.
 *
 * A agenda do fechai funciona sozinha; o Google é espelho. Por isso a tela
 * mostra os três estados possíveis com clareza — a plataforma não tem as
 * credenciais, a conta não conectou, a conta conectou — em vez de esconder o
 * botão e deixar a pessoa achando que a integração não existe.
 */
export function GoogleCalendarCard({ state }: { state: GoogleState }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [, startTransition] = useTransition();

  if (!state.configured) {
    return (
      <div className="rounded-surface border border-white/10 bg-white/5 p-4">
        <p className="font-medium text-white">Google Agenda</p>
        <p className="mt-1 text-sm text-white/55">
          Integração indisponível nesta instalação — faltam as credenciais do Google no servidor.
          Seus horários continuam sendo salvos aqui normalmente.
        </p>
      </div>
    );
  }

  if (!state.connected) {
    return (
      <div className="rounded-surface border border-white/10 bg-white/5 p-4">
        <p className="font-medium text-white">Google Agenda</p>
        <p className="mt-1 text-sm text-white/55">
          Conecte para que todo horário marcado aqui apareça também na sua agenda do Google.
        </p>
        {/* `<a>` puro, não `<Link>`: o destino é uma rota de API que redireciona
            para o Google, e o prefetch do Link dispararia esse redirecionamento
            sozinho ao passar o mouse. O fluxo OAuth é navegação de página
            inteira, ida e volta. */}
        <a
          href="/api/integrations/google/connect"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
        >
          <ExternalLink size={14} aria-hidden />
          Conectar Google Agenda
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-surface border border-success/30 bg-success/10 p-4">
      <div className="flex items-start gap-2">
        <CalendarCheck2 size={18} aria-hidden className="mt-0.5 shrink-0 text-success" />
        <div className="min-w-0">
          <p className="font-medium text-white">Google Agenda conectado</p>
          <p className="mt-0.5 truncate text-sm text-white/60">
            {state.accountEmail ?? "conta do Google"}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p id="google-sync-desc" className="text-sm text-white/65">
          Espelhar novos horários no Google
        </p>
        <Switch
          checked={state.syncEnabled}
          loading={syncing}
          label={`Espelhar no Google: ${state.syncEnabled ? "ligado" : "desligado"}`}
          describedBy="google-sync-desc"
          onCheckedChange={(next) => {
            setSyncing(true);
            setError(null);
            startTransition(async () => {
              const res = await setGoogleSyncEnabled(next);
              if (!res.ok) setError(res.error ?? "Falha ao atualizar.");
              setSyncing(false);
              router.refresh();
            });
          }}
        />
      </div>

      <ConfirmButton
        size="sm"
        confirm={{
          title: "Desconectar o Google Agenda?",
          description:
            "Os horários já espelhados continuam lá; os novos deixam de ser enviados. Sua agenda aqui não muda.",
          confirmLabel: "Desconectar",
          tone: "danger",
        }}
        onConfirm={async () => {
          const res = await disconnectGoogleAction();
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
