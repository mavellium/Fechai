"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, Square, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { sendRecordedAudioMessage } from "./actions";

/**
 * Gravar a SUA voz e mandar como mensagem de voz na conversa.
 *
 * Diferente do "enviar como áudio" (que é texto→voz do agente), aqui vai a voz
 * real da pessoa — para quando o assunto é mais rápido de falar que de digitar,
 * ou quando o tom importa. O áudio é transcrito no servidor antes de sair, para
 * o histórico não ficar cego (ver `sendRecordedAudioMessage`).
 */

const MAX_SECONDS = 120;

export function VoiceMessageRecorder({
  conversationId,
  onDone,
  onCancel,
}: {
  conversationId: string;
  /** Chamado após enviar com sucesso — a tela fecha o modo gravação. */
  onDone: () => void;
  onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [recorded, setRecorded] = useState<{ blob: Blob; url: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Lido só na limpeza da desmontagem, onde o estado mais recente não chega.
  const urlRef = useRef<string | null>(null);

  /**
   * Guarda contra a montagem dupla do Strict Mode (dev).
   *
   * Em dev o React monta → desmonta → monta. Como este componente pedia o
   * microfone no mount, a limpeza da PRIMEIRA montagem parava as tracks do
   * stream que a segunda ainda estava esperando do `getUserMedia` — e o
   * resultado era sempre "Não foi possível usar o microfone", com o popup de
   * permissão sumindo sozinho. Só a montagem que ainda está viva mexe no
   * microfone.
   */
  const aliveRef = useRef(true);
  /**
   * Identifica CADA montagem. Um booleano não bastava: a segunda montagem do
   * Strict Mode devolvia `alive` para `true` antes de o `getUserMedia` da
   * primeira resolver, então os dois streams eram aceitos e o segundo
   * sobrescrevia o primeiro — deixando um microfone aberto e órfão. Com um
   * token, cada `start()` só aplica o resultado se ainda for o dono da vez.
   */
  const mountRef = useRef(0);

  // Começa a gravar assim que abre: a pessoa já clicou no microfone, pedir
  // um segundo clique para começar seria um passo a mais sem função.
  useEffect(() => {
    aliveRef.current = true;
    const token = ++mountRef.current;
    void start(token);
    return () => {
      aliveRef.current = false;
      // Invalida esta montagem: um getUserMedia ainda pendente dela vira no-op.
      // A regra do lint pede para copiar o ref numa variável — aqui é o
      // contrário: o valor ATUAL (compartilhado) é justamente o que precisa
      // mudar, para o `start()` pendente perceber que perdeu a vez.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      mountRef.current++;
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(token = mountRef.current) {
    setError(null);

    // `getUserMedia` só existe em contexto seguro (https ou localhost). Sem
    // esta checagem o erro genérico de microfone esconderia a causa real —
    // abrir o painel por IP da rede (http://192.168...) cai exatamente aqui.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Seu navegador não libera o microfone nesta página. Acesse por https ou localhost e tente de novo.",
      );
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // A permissão pode voltar depois de a tela já ter fechado, ou vinda de uma
      // montagem que o Strict Mode descartou: solta o microfone e não toca em
      // estado nenhum — senão sobra um stream aberto sem dono.
      if (token !== mountRef.current || !aliveRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setRecorded({ blob, url });
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);

      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      // Erro de uma montagem descartada não vira mensagem na tela: era esse
      // ruído que aparecia como "microfone bloqueado" mesmo com permissão dada.
      if (token !== mountRef.current || !aliveRef.current) return;
      // O nome do erro diz o que a pessoa precisa fazer — "não foi possível"
      // sozinho manda ela procurar no lugar errado (ex.: microfone ocupado por
      // outro app não se resolve mexendo em permissão).
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "O navegador negou o microfone. Verifique o cadeado na barra de endereço e, se já estiver permitido, feche as outras abas que estejam usando o microfone."
          : name === "NotFoundError"
            ? "Nenhum microfone encontrado neste computador."
            : name === "NotReadableError"
              ? "O microfone está sendo usado por outro programa. Feche-o e tente de novo."
              : "Não foi possível usar o microfone. Tente de novo.",
      );
      setRecording(false);
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  function discard() {
    stop();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setRecorded(null);
    onCancel();
  }

  async function send() {
    if (!recorded) return;
    setSending(true);
    setError(null);

    const form = new FormData();
    form.append("conversationId", conversationId);
    form.append("audio", recorded.blob, fileNameFor(recorded.blob.type));

    const res = await sendRecordedAudioMessage(null, form);
    setSending(false);

    if (res.ok) {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      setRecorded(null);
      onDone();
    } else {
      setError(res.error ?? "Não foi possível enviar o áudio.");
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <Alert tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            {/* Depois de liberar no cadeado, tentar de novo tem que ser um
                clique — sem isto a saída é fechar e reabrir a gravação. */}
            <Button type="button" size="sm" variant="ghost" onClick={() => void start()}>
              Tentar de novo
            </Button>
          </div>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-control border border-white/15 px-3 py-2">
        {recording ? (
          <>
            <span
              role="status"
              className="inline-flex items-center gap-2 font-mono text-sm tabular-nums text-white"
            >
              <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
              Gravando {formatSeconds(seconds)}
            </span>
            <div className="ml-auto flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={discard}>
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={stop}>
                <Square size={14} aria-hidden />
                Parar
              </Button>
            </div>
          </>
        ) : recorded ? (
          <>
            <audio controls src={recorded.url} className="h-9 min-w-0 flex-1" />
            <div className="flex gap-2">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={discard}
                disabled={sending}
                aria-label="Descartar áudio"
              >
                <Trash2 size={15} aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                onClick={send}
                loading={sending}
                loadingLabel="Enviando áudio"
                aria-label="Enviar áudio"
              >
                <Send size={15} aria-hidden />
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-sm text-white/60">Preparando o microfone…</span>
            <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={discard}>
              Cancelar
            </Button>
          </>
        )}
      </div>

      {recording && (
        <p className="text-xs text-white/50">
          O áudio vai na sua voz e é transcrito para o histórico. Máximo de 2 minutos.
        </p>
      )}
    </div>
  );
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fileNameFor(mime: string): string {
  const type = mime.split(";")[0];
  if (type.includes("mp4") || type.includes("m4a")) return "audio.m4a";
  if (type.includes("ogg")) return "audio.ogg";
  return "audio.webm";
}

/** Botão que abre a gravação — fica no composer, ao lado do campo de texto. */
export function RecordButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      aria-label="Gravar mensagem de voz"
      title="Gravar mensagem de voz"
    >
      <Mic size={16} aria-hidden />
    </Button>
  );
}
