"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldBan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { blockIpAddress } from "../../actions";

/** Espelha `BLOCK_DURATIONS` do módulo — o servidor é quem decide de verdade. */
const DURATIONS = [
  { value: "permanente", label: "Até eu desbloquear" },
  { value: "1h", label: "1 hora" },
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 dias" },
];

export type IpSummary = {
  ip: string;
  /** Tentativas de login desse IP nos últimos dias. */
  total: number;
  failures: number;
  distinctEmails: number;
  lastEmail: string | null;
  days: number;
};

/**
 * O diálogo de bloquear um IP.
 *
 * Mostra o que aquele endereço andou fazendo ANTES de pedir a confirmação —
 * quantas tentativas, quantas falharam, quantas contas diferentes tentou. Sem
 * isso o admin decide olhando só para um número de IP, que não diz nada: dois
 * endereços parecidos podem ser um ataque de dicionário e o escritório de um
 * cliente, e a diferença está justamente nesses contadores.
 *
 * "Contas diferentes tentadas" é o sinal mais forte de todos: um cliente que
 * esqueceu a senha erra na conta DELE muitas vezes; quem varre e-mails tenta
 * vinte contas uma vez cada.
 */
export function BlockIpDialog({
  summary,
  open,
  onClose,
}: {
  summary: IpSummary | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("permanente");

  function submit() {
    if (!summary) return;
    setError(null);

    const data = new FormData();
    data.set("ip", summary.ip);
    data.set("reason", reason);
    data.set("duration", duration);

    start(async () => {
      const result = await blockIpAddress(data);
      if (!result.ok) {
        // Erro dentro do diálogo, onde o admin está olhando — fechar como se
        // tivesse dado certo deixaria o IP solto sem ninguém perceber.
        setError(result.error ?? "Não foi possível bloquear.");
        return;
      }
      setReason("");
      setDuration("permanente");
      onClose();
      router.refresh();
    });
  }

  if (!summary) return null;

  const spray = summary.distinctEmails >= 5;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bloquear ${summary.ip}?`}
      description="Este endereço deixa de conseguir entrar — por e-mail e senha ou pelo Google. O resto do site continua acessível a ele."
    >
      <div className="space-y-5">
        <section className="rounded-surface border border-white/10 bg-white/5 p-4">
          <p className="font-mono text-micro uppercase tracking-wide text-white/55">
            Últimos {summary.days} dias
          </p>
          <dl className="mt-2 grid grid-cols-3 gap-3 text-center">
            <div>
              <dd className="font-mono text-lg tabular-nums text-white">{summary.total}</dd>
              <dt className="font-mono text-micro uppercase tracking-wide text-white/45">
                tentativas
              </dt>
            </div>
            <div>
              <dd className="font-mono text-lg tabular-nums text-white">{summary.failures}</dd>
              <dt className="font-mono text-micro uppercase tracking-wide text-white/45">
                falharam
              </dt>
            </div>
            <div>
              <dd
                className={`font-mono text-lg tabular-nums ${spray ? "text-danger" : "text-white"}`}
              >
                {summary.distinctEmails}
              </dd>
              <dt className="font-mono text-micro uppercase tracking-wide text-white/45">
                contas
              </dt>
            </div>
          </dl>

          {summary.lastEmail && (
            <p className="mt-3 truncate border-t border-white/10 pt-3 text-sm text-white/65">
              Último e-mail tentado:{" "}
              <span className="font-mono text-micro text-white/80">{summary.lastEmail}</span>
            </p>
          )}

          {/* O padrão que distingue ataque de cliente esquecido. Dito em texto,
              não só pela cor do número (design-ui, §4). */}
          {spray && (
            <p className="mt-2 text-sm leading-relaxed text-warn">
              Este IP tentou {summary.distinctEmails} contas diferentes — é o padrão de quem
              testa e-mails em lote, não de alguém que esqueceu a própria senha.
            </p>
          )}
        </section>

        <Field
          label="Por que está bloqueando"
          htmlFor="bloqueio-motivo"
          hint="Fica registrado na lista de bloqueados, para você (ou outro admin) decidir depois se ainda faz sentido."
        >
          <Textarea
            {...fieldProps("bloqueio-motivo", { hint: true })}
            rows={2}
            value={reason}
            maxLength={280}
            disabled={pending}
            placeholder="Ex.: tentou 40 contas diferentes em 10 minutos"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        <Field label="Por quanto tempo" htmlFor="bloqueio-prazo">
          <Select
            {...fieldProps("bloqueio-prazo")}
            value={duration}
            disabled={pending}
            onChange={(e) => setDuration(e.target.value)}
            className="w-56"
          >
            {DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>

        {error && (
          <p role="alert" className="font-mono text-micro text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-5">
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            loading={pending}
            loadingLabel="Bloqueando"
            disabled={reason.trim().length < 3}
            onClick={submit}
          >
            <ShieldBan size={15} aria-hidden />
            Bloquear IP
          </Button>
        </div>
      </div>
    </Modal>
  );
}
