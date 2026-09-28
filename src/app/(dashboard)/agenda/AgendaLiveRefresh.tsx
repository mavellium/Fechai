"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * De quanto em quanto tempo a agenda se relê sozinha.
 *
 * O Clinicorp não tem webhook de agendamento (o único da API é de upload de
 * arquivo), então "aparecer em tempo real" é reler: cada volta refaz a página no
 * servidor, que chama `/appointment/list` de novo. 15s é rápido o bastante para
 * a recepção marcar lá e ver aqui, e com a aba escondida nada é chamado.
 */
const LIVE_INTERVAL_MS = 15_000;

/**
 * "Ao vivo · atualizado às 18:47" + botão Atualizar da `/agenda`.
 *
 * `router.refresh()` refaz os Server Components sem perder o estado dos
 * componentes de cliente, então a leitura do Clinicorp e a do nosso banco
 * (o que o agente marcou no WhatsApp) chegam juntas.
 *
 * A volta automática **pula** quando há um `<dialog>` aberto: a lista do dia
 * pode trocar de forma no refresh (o "Marcar horário neste dia" do estado vazio
 * some quando chega a primeira consulta) e levaria junto o formulário que a
 * pessoa estava preenchendo. O clique no botão não pula — foi pedido.
 */
export function AgendaLiveRefresh({ updatedAt }: { updatedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Só o clique mostra carregando no botão: a volta automática piscando a cada
  // 15s chamaria atenção para algo que a pessoa não pediu.
  const [manual, setManual] = useState(false);
  const lastRun = useRef(0);
  // O intervalo lê pela ref: um Clinicorp lento não pode empilhar releituras.
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const refresh = useCallback(
    (fromClick: boolean) => {
      if (!fromClick && pendingRef.current) return;
      setManual(fromClick);
      lastRun.current = Date.now();
      startTransition(() => router.refresh());
    },
    [router],
  );

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector("dialog[open]")) return;
      refresh(false);
    };
    const timer = window.setInterval(tick, LIVE_INTERVAL_MS);
    // Voltou para a aba depois de um tempo fora: atualiza já, sem esperar a volta.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRun.current >= LIVE_INTERVAL_MS) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return (
    <div className="flex items-center gap-3">
      {/* Sem aria-live: o texto troca a cada 15s e seria lido toda vez. */}
      <p className="flex items-center gap-1.5 font-mono text-micro uppercase tracking-wider text-white/50">
        <span aria-hidden className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-success/60 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        {/* No celular o bloco de ações do cabeçalho não quebra linha: fica só a hora. */}
        {pending ? (
          "Atualizando…"
        ) : (
          <>
            <span className="hidden sm:inline">Ao vivo · atualizado às </span>
            <span className="sr-only sm:hidden">Atualizado às </span>
            {updatedAt}
          </>
        )}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => refresh(true)}
        loading={manual && pending}
        loadingLabel="Atualizando a agenda"
      >
        <RefreshCw size={14} aria-hidden />
        <span className="sr-only sm:not-sr-only">Atualizar</span>
      </Button>
    </div>
  );
}
