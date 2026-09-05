"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, Square, Trash2, Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { dateLabel } from "@/lib/format";
import { deleteAgentVoice, saveAgentVoice } from "./actions";
import { CatalogVoicePicker } from "./CatalogVoicePicker";

/**
 * Grava a voz do dono da conta e a envia para clonagem (Fish Audio).
 *
 * A gravação acontece no NAVEGADOR (`MediaRecorder`) e o áudio vai direto para
 * a action — nunca é guardado por nós depois que o modelo é criado (ver
 * `saveAgentVoice`). O upload de arquivo existe ao lado porque `MediaRecorder`
 * e permissão de microfone falham de formas que não dá para consertar na tela
 * (navegador antigo, microfone bloqueado no sistema, iOS em contexto inseguro);
 * sem a alternativa, essas pessoas simplesmente não teriam a funcionalidade.
 */

/** Roteiro sugerido: ~25s de fala contínua, que é o que a clonagem precisa. */
const SCRIPT =
  "Oi! Aqui é do atendimento. Tudo bem com você? Recebi sua mensagem e já vou te ajudar com isso. " +
  "Me conta um pouco melhor o que você precisa, assim consigo te passar os valores certinhos e ver " +
  "o melhor horário pra gente conversar. Qualquer dúvida é só me chamar por aqui, tá bom? Um abraço!";

const MIN_SECONDS = 10;
const MAX_SECONDS = 60;

type Recorded = { blob: Blob; url: string; seconds: number };

export function VoiceRecorder({
  agentId,
  voice,
  catalogKey = null,
  available,
  onVoiceChange,
}: {
  agentId: string;
  /** Voz já gravada, se houver. */
  voice: { label: string | null; createdAt: Date | null; source: string | null } | null;
  /** Chave da voz do catálogo em uso, se a voz atual vier de lá. */
  catalogKey?: string | null;
  /** A instalação tem chave da Fish Audio? Sem ela, nada aqui funcionaria. */
  available: boolean;
  /** Avisa o passo Comportamento para destravar/travar "Responder com áudio". */
  onVoiceChange?: (hasVoice: boolean) => void;
}) {
  // Espelha a prop em estado: gravar e remover precisam repintar este card na
  // hora, sem esperar o `revalidatePath` da action chegar de volta.
  const [currentVoice, setCurrentVoice] = useState(voice);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [label, setLabel] = useState(voice?.label ?? "Minha voz");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  /**
   * Qual caminho a pessoa está usando. Abre em "prontas" para quem ainda não
   * tem voz: escolher uma da lista é 2 cliques, gravar exige microfone,
   * permissão e 30 segundos falando — a opção mais fácil vem primeiro.
   */
  const [tab, setTab] = useState<"catalog" | "record">(
    voice?.source === "recorded" ? "record" : "catalog",
  );

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // A URL do preview e o microfone são recursos do navegador: sem esta limpeza,
  // sair da tela gravando deixa o indicador de microfone aceso.
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recorded?.url) URL.revokeObjectURL(recorded.url);
    };
    // Só na desmontagem: `recorded` é lido pelo closure mais recente do React 19.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    if (recorded?.url) URL.revokeObjectURL(recorded.url);
    setRecorded(null);
    setSeconds(0);
  }

  async function startRecording() {
    setError(null);
    setInfo(null);
    reset();

    // Contexto inseguro (http por IP da rede) não expõe `mediaDevices`: dizer
    // isso evita a caçada por uma permissão que o navegador nem chegou a pedir.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Seu navegador não libera o microfone nesta página. Acesse por https ou localhost — ou envie um arquivo de áudio.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        setRecorded({ blob, url: URL.createObjectURL(blob), seconds });
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);

      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          // Corta sozinho no teto: a Fish Audio não precisa de mais que isso, e
          // um áudio esquecido gravando vira upload gigante.
          if (s + 1 >= MAX_SECONDS) stopRecording();
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      // Cada causa pede uma ação diferente da pessoa — ver VoiceMessageRecorder.
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "O acesso ao microfone foi bloqueado. Clique no cadeado na barra de endereço, permita o microfone e tente de novo — ou envie um arquivo de áudio."
          : name === "NotFoundError"
            ? "Nenhum microfone encontrado. Envie um arquivo de áudio no lugar."
            : name === "NotReadableError"
              ? "O microfone está sendo usado por outro programa. Feche-o e tente de novo."
              : "Não foi possível usar o microfone. Tente de novo ou envie um arquivo de áudio.",
      );
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setInfo(null);
    reset();
    setRecorded({ blob: file, url: URL.createObjectURL(file), seconds: 0 });
  }

  async function save() {
    if (!recorded) return;
    if (recorded.seconds > 0 && recorded.seconds < MIN_SECONDS) {
      setError(`A gravação ficou curta. Fale por pelo menos ${MIN_SECONDS} segundos.`);
      return;
    }

    setSaving(true);
    setError(null);
    setInfo(null);

    const form = new FormData();
    form.append("agentId", agentId);
    form.append("label", label);
    // O nome importa: a Fish Audio identifica o formato pela extensão.
    form.append("sample", recorded.blob, fileNameFor(recorded.blob.type));

    const res = await saveAgentVoice(null, form);
    if (res.ok) {
      reset();
      setCurrentVoice({ label, createdAt: new Date(), source: "recorded" });
      onVoiceChange?.(true);
      setInfo(res.info ?? "Voz gravada.");
    } else {
      setError(res.error ?? "Não foi possível salvar a voz.");
    }
    setSaving(false);
  }

  async function remove() {
    setRemoving(true);
    setError(null);
    setInfo(null);
    const res = await deleteAgentVoice(agentId);
    if (res.ok) {
      setCurrentVoice(null);
      onVoiceChange?.(false);
      setInfo(res.info ?? "Voz removida.");
    } else {
      setError(res.error ?? "Não foi possível remover a voz.");
    }
    setRemoving(false);
    
  }

  if (!available) {
    return (
      <Alert tone="warn">
        A resposta em áudio não está disponível nesta instalação — falta a chave da Fish Audio no
        servidor. Fale com o suporte para habilitar.
      </Alert>
    );
  }

  const tooShort = recorded !== null && recorded.seconds > 0 && recorded.seconds < MIN_SECONDS;

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {info && <Alert tone="success">{info}</Alert>}

      {/* Voz já no ar: o estado atual vem antes da gravação, senão a pessoa não
          sabe se já tem voz configurada nem qual é. */}
      {currentVoice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-iris/40 bg-iris/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-iris/25 text-white"
            >
              <AudioLines size={18} />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-white">{currentVoice.label ?? "Minha voz"}</p>
              <p className="text-sm text-white/60">
                {currentVoice.source === "catalog"
                  ? "Voz pronta"
                  : currentVoice.createdAt
                    ? `Gravada em ${dateLabel(currentVoice.createdAt)}`
                    : "Voz configurada"}
              </p>
            </div>
          </div>
          <ConfirmButton
            size="sm"
            disabled={removing}
            confirm={{
              title: "Remover a voz do agente?",
              description:
                "O agente volta a responder só em texto, e a resposta em áudio é desligada. Você pode gravar outra voz depois.",
              confirmLabel: "Remover voz",
              tone: "danger",
            }}
            onConfirm={remove}
          >
            <Trash2 size={14} aria-hidden />
            Remover
          </ConfirmButton>
        </div>
      )}

      {/* Duas formas de ter voz, uma decisão só — por isso abas no mesmo card,
          e não dois blocos concorrendo. */}
      <div role="tablist" aria-label="Origem da voz" className="flex gap-2 border-b border-white/10">
        {([
          { key: "catalog" as const, label: "Vozes prontas" },
          { key: "record" as const, label: "Gravar minha voz" },
        ]).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px rounded-t-control border-b-2 px-3 py-2 font-mono text-micro uppercase tracking-[0.15em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris ${
              tab === t.key
                ? "border-iris text-white"
                : "border-transparent text-white/50 hover:text-white/80"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "catalog" && (
        <CatalogVoicePicker
          agentId={agentId}
          selectedKey={catalogKey}
          onSelected={(name) => {
            setCurrentVoice({ label: name, createdAt: new Date(), source: "catalog" });
            onVoiceChange?.(true);
            setInfo(`Voz ${name} selecionada.`);
          }}
        />
      )}

      <div className={tab === "record" ? "rounded-surface border border-white/10 p-4" : "hidden"}>
        <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/55">
          {currentVoice?.source === "recorded" ? "Regravar" : "Gravar sua voz"}
        </p>

        <p className="mt-2 max-w-prose text-sm text-white/60">
          A gravação é usada só para criar a voz e não fica guardada no fechaí.
        </p>

        <p className="mt-3 text-sm text-white/70">
          Leia este texto em voz alta, do jeito que você falaria com um cliente:
        </p>
        <blockquote className="mt-2 max-w-prose rounded-control border-l-2 border-iris/60 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white/80">
          {SCRIPT}
        </blockquote>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {recording ? (
            <Button type="button" variant="destructive" onClick={stopRecording}>
              <Square size={15} aria-hidden />
              Parar
            </Button>
          ) : (
            <Button type="button" onClick={startRecording} disabled={saving}>
              <Mic size={15} aria-hidden />
              {recorded ? "Gravar de novo" : "Gravar"}
            </Button>
          )}

          {/* Alternativa ao microfone — rótulo é o próprio input, para o teclado
              chegar nele como em qualquer botão. */}
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-control border border-white/20 px-4 text-sm font-medium text-white/80 transition-colors hover:text-white focus-within:ring-2 focus-within:ring-iris">
            <Upload size={15} aria-hidden />
            Enviar arquivo
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              onChange={pickFile}
              disabled={recording || saving}
            />
          </label>

          {recording && (
            <span
              role="status"
              className="inline-flex items-center gap-2 font-mono text-sm tabular-nums text-white"
            >
              <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
              {formatSeconds(seconds)}
              <span className="text-white/50">/ {formatSeconds(MAX_SECONDS)}</span>
            </span>
          )}
        </div>

        {recorded && !recording && (
          <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
            <p className="text-sm text-white/70">
              Ouça antes de salvar — a voz do agente vai soar assim.
            </p>
            <audio controls src={recorded.url} className="w-full max-w-md" />

            {tooShort && (
              <Alert tone="warn">
                A gravação tem {recorded.seconds}s. Grave pelo menos {MIN_SECONDS}s — amostras
                curtas produzem uma voz robótica.
              </Alert>
            )}

            <Field label="Nome desta voz" htmlFor="voice-label">
              <Input
                id="voice-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                placeholder="Minha voz"
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={save} loading={saving} disabled={tooShort}>
                Salvar voz
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={saving}>
                Descartar
              </Button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** O `MediaRecorder` entrega webm (Chrome/Firefox) ou mp4 (Safari). */
function fileNameFor(mime: string): string {
  const type = mime.split(";")[0];
  if (type.includes("mp4") || type.includes("m4a")) return "amostra.m4a";
  if (type.includes("mpeg") || type.includes("mp3")) return "amostra.mp3";
  if (type.includes("wav")) return "amostra.wav";
  if (type.includes("ogg")) return "amostra.ogg";
  return "amostra.webm";
}
