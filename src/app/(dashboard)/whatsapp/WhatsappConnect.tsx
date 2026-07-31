"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
import { connectWhatsapp, refreshWhatsappStatus } from "./actions";

/** De quanto em quanto tempo perguntamos ao provedor se o QR já foi lido. */
const POLL_MS = 5000;
/**
 * Validade do código. O provedor não devolve a expiração, mas o QR do WhatsApp
 * Web gira em torno de um minuto — antes disso a tela ficava dizendo
 * "aguardando" para sempre sobre um código que já tinha morrido.
 */
const QR_TTL_S = 60;

const STEPS = [
  <>Abra o WhatsApp no seu celular.</>,
  <>
    Toque em <strong className="font-medium text-white">Aparelhos conectados</strong> (no menu ou
    nas configurações).
  </>,
  <>
    Toque em <strong className="font-medium text-white">Conectar aparelho</strong> e aponte a
    câmera para o código ao lado.
  </>,
];

/**
 * Conexão do número. A tela é orientada a estado: conectada, ela não tem motivo
 * para mostrar código nenhum; desconectada, o código é a única coisa que importa
 * — e por isso é gerado sozinho, sem exigir um clique antes.
 */
export function WhatsappConnect({
  initialStatus,
  configured,
  connectedSince,
  inboundLast7,
}: {
  initialStatus: string;
  /** Sem Evolution API configurada não há o que conectar nem o que consultar. */
  configured: boolean;
  /** Desde quando o número está conectado (última mudança de status). */
  connectedSince?: string;
  /** Mensagens recebidas de clientes nos últimos 7 dias. */
  inboundLast7?: number;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [qr, setQr] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const autoRan = useRef(false);

  // Todo o `setState` fica depois do `await`: chamar `setError(null)` de forma
  // síncrona aqui faria a chamada automática de montagem cair na regra
  // `react-hooks/set-state-in-effect` (cascata de renders no efeito).
  const run = useCallback((action: typeof connectWhatsapp) => {
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error ?? "Não foi possível falar com o WhatsApp agora. Tente de novo.");
        return;
      }
      setError(null);
      if (res.status) setStatus(res.status);
      setQr(res.qrCode ?? null);
      if (res.qrCode) setSecondsLeft(QR_TTL_S);
    });
  }, []);

  // Gera o código sozinho ao abrir a tela. Era um clique a mais para fazer a
  // única coisa pela qual a pessoa entrou aqui.
  useEffect(() => {
    if (autoRan.current || !configured) return;
    if (initialStatus === "connected") return;
    autoRan.current = true;
    run(connectWhatsapp);
  }, [configured, initialStatus, run]);

  // Conta a validade do código na tela, em vez de deixá-lo expirar em silêncio.
  useEffect(() => {
    if (!qr || secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [qr, secondsLeft]);

  // Enquanto o código é válido, confere sozinho se já foi lido — quem escaneia
  // não precisa voltar ao computador para clicar em nada.
  useEffect(() => {
    if (!configured || !qr || secondsLeft <= 0 || status === "connected") return;
    const id = setInterval(() => {
      void refreshWhatsappStatus().then((res) => {
        if (res.ok && res.status) setStatus(res.status);
      });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [configured, qr, secondsLeft, status]);

  if (status === "connected") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-display text-xl font-semibold text-white">Seu número está atendendo</p>
          {connectedSince && (
            <p className="text-sm text-white/55">conectado desde {connectedSince}</p>
          )}
        </div>

        {inboundLast7 !== undefined && (
          <p className="text-sm text-white/70">
            <span className="font-mono tabular-nums text-white">{inboundLast7}</span>{" "}
            {inboundLast7 === 1 ? "mensagem recebida" : "mensagens recebidas"} de clientes nos
            últimos 7 dias.
          </p>
        )}

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => run(refreshWhatsappStatus)}
            loading={pending}
            loadingLabel="Verificando"
          >
            Verificar conexão
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setStatus("disconnected");
              autoRan.current = true;
              run(connectWhatsapp);
            }}
            disabled={pending}
          >
            Conectar outro número
          </Button>
        </div>
      </div>
    );
  }

  const expired = Boolean(qr) && secondsLeft <= 0;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
      <div className="mx-auto w-fit md:mx-0">
        <div className="flex h-[264px] w-[264px] items-center justify-center rounded-surface bg-white p-3">
          {qr && !expired ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`}
              alt="Código para conectar o WhatsApp"
              width={240}
              height={240}
            />
          ) : (
            // `text-neutral` no container: os pontos usam `bg-current` e ficariam
            // brancos-no-branco herdando a cor do painel escuro.
            <div className="px-6 text-center text-neutral">
              {pending ? (
                <>
                  <LoadingDots size={6} label={null} />
                  <p className="mt-3 text-sm">Gerando seu código…</p>
                </>
              ) : (
                <p className="text-sm">
                  {expired
                    ? "O código expirou. Gere um novo para continuar."
                    : configured
                      ? "Gere um código para conectar seu número."
                      : "Conexão indisponível neste ambiente."}
                </p>
              )}
            </div>
          )}
        </div>

        <div aria-live="polite" className="mt-3 text-center md:text-left">
          {qr && !expired ? (
            <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
              expira em {minutes}:{seconds} · aguardando leitura
            </p>
          ) : (
            <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/40">
              {expired ? "código expirado" : "nenhum código ativo"}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <ol className="space-y-3 text-sm text-white/80">
          {STEPS.map((text, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-iris font-mono text-xs font-semibold text-white"
              >
                {i + 1}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ol>

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => run(connectWhatsapp)}
            loading={pending}
            loadingLabel="Gerando o código"
            disabled={!configured}
            variant={expired || !qr ? "default" : "outline"}
          >
            {expired || !qr ? "Gerar código" : "Gerar novo código"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => run(refreshWhatsappStatus)}
            disabled={pending || !configured}
          >
            Já escaneei, verificar
          </Button>
        </div>
      </div>
    </div>
  );
}
