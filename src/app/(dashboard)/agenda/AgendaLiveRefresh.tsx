"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * De quanto em quanto tempo a agenda pergunta se algo mudou.
 *
 * O Clinicorp não tem webhook de agendamento (o único da API é de upload de
 * arquivo), então "aparecer em tempo real" é reler. Cada volta custa uma
 * chamada ao Clinicorp por aba aberta; com a aba escondida nada é chamado.
 */
const LIVE_INTERVAL_MS = 15_000;

type Pulse = { version: string; checkedAt: string };

/**
 * "Ao vivo · atualizado às 18:47:05" + botão Atualizar da `/agenda`.
 *
 * A volta **não** refaz a página: pergunta a versão do mês em
 * `/api/agenda/pulso` com `fetch` comum, fora da fila do roteador, e só chama
 * `router.refresh()` quando a versão mudou. O primeiro desenho refazia a
 * página toda a cada 15s, e o clique num dia ficava esperando a releitura do
 * Clinicorp. O pulso já reabastece o cache do servidor, então a página refeita
 * sai rápida.
 *
 * Com um `<dialog>` aberto a volta **pula**: a lista do dia pode trocar de
 * forma no refresh e levar junto o formulário que a pessoa estava preenchendo.
 * O clique no botão não pula — foi pedido.
 */
export function AgendaLiveRefresh({
  year,
  month,
  version,
  updatedAt,
}: {
  year: number;
  month: number;
  /** `agendaVersion` do que a página desenhou. */
  version: string;
  /** Hora (no fuso da agenda) em que a página foi desenhada. */
  updatedAt: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [checking, setChecking] = useState(false);
  const [manual, setManual] = useState(false);
  const [failed, setFailed] = useState(false);
  // Hora da última pergunta, presa à versão que ela confirmou: quando a página
  // é refeita com outra versão, volta a valer a hora do desenho (`updatedAt`).
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const checkedAt = pulse && pulse.version === version ? pulse.checkedAt : updatedAt;

  // O intervalo é criado uma vez; o que ele lê muda a cada página desenhada.
  const current = useRef({ year, month, version });
  const inFlight = useRef(false);
  const lastRun = useRef(0);
  useEffect(() => {
    current.current = { year, month, version };
  }, [year, month, version]);

  const check = useCallback(
    async (fromClick: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      lastRun.current = Date.now();
      setChecking(true);
      setManual(fromClick);
      const { year: y, month: m, version: shown } = current.current;
      try {
        const res = await fetch(`/api/agenda/pulso?ano=${y}&mes=${m}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as Pulse;
        setFailed(false);
        // A pessoa mudou de mês enquanto a pergunta ia: a resposta é de outro mês.
        const now = current.current;
        if (now.year !== y || now.month !== m) return;
        setPulse(next);
        if (fromClick || next.version !== shown) startTransition(() => router.refresh());
      } catch {
        setFailed(true);
      } finally {
        inFlight.current = false;
        setChecking(false);
      }
    },
    [router],
  );

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector("dialog[open]")) return;
      void check(false);
    };
    const timer = window.setInterval(tick, LIVE_INTERVAL_MS);
    // Voltou para a aba depois de um tempo fora: pergunta já, sem esperar a volta.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRun.current >= LIVE_INTERVAL_MS) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  const busy = checking || refreshing;

  return (
    <div className="flex items-center gap-3">
      {/* Sem aria-live: o texto troca a cada 15s e seria lido toda vez. */}
      <p className="flex items-center gap-1.5 font-mono text-micro uppercase tracking-wider text-white/50">
        <span aria-hidden className="relative flex h-2 w-2">
          {!failed && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-success/60 motion-safe:animate-ping" />
          )}
          <span className={cn("relative inline-flex h-2 w-2 rounded-full", failed ? "bg-warn" : "bg-success")} />
        </span>
        {/* No celular o bloco de ações do cabeçalho não quebra linha: fica só a hora. */}
        {failed ? (
          <>
            <span className="hidden sm:inline">Sem conexão · última às </span>
            <span className="sr-only sm:hidden">Sem conexão, última atualização às </span>
            {checkedAt}
          </>
        ) : (
          <>
            <span className="hidden sm:inline">Ao vivo · atualizado às </span>
            <span className="sr-only sm:hidden">Atualizado às </span>
            {checkedAt}
          </>
        )}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void check(true)}
        loading={manual && busy}
        loadingLabel="Atualizando a agenda"
      >
        <RefreshCw size={14} aria-hidden />
        <span className="sr-only sm:not-sr-only">Atualizar</span>
      </Button>
    </div>
  );
}
