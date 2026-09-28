"use client";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import type { BroadcastTemplate } from "@/modules/broadcasts/template";
import type { ImportedRecipient } from "@/modules/broadcasts/import";
import { startBroadcast, sendBroadcastTest } from "./actions";
import { RecipientTable } from "./RecipientTable";
export type Review = {
  id: string;
  name: string;
  template: BroadcastTemplate;
  recipients: ImportedRecipient[];
  duplicates: number;
  recentPhones: string[];
};
export type RunAction = (action: () => Promise<void>) => void;

export function BroadcastReview({
  review,
  connected,
  pending,
  run,
  notify,
  onBack,
  onStarted,
}: {
  review: Review;
  connected: boolean;
  pending: boolean;
  run: RunAction;
  notify: (message: string, error?: boolean) => void;
  onBack: () => void;
  onStarted: () => Promise<void>;
}) {
  const [consent, setConsent] = useState(false);
  const [recent, setRecent] = useState(review.recentPhones);
  const [acknowledge, setAcknowledge] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [scheduled, setScheduled] = useState("now");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  return (
    <Card className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-widest text-signal">
          Revise antes de enviar
        </p>
        <h2 className="mt-2 font-display text-xl font-semibold text-white">
          {review.name}
        </h2>
        <p className="mt-2 text-sm text-white/65">
          {review.recipients.length} contatos únicos · {review.template.name} ·{" "}
          {review.duplicates} duplicados removidos
        </p>
      </div>
      <RecipientTable
        rows={review.recipients.map((r) => ({
          ...r,
          id: String(r.row),
          status: "pending",
          error: null,
        }))}
      />
      <div className="space-y-3 rounded-control border border-white/10 p-4">
        <h3 className="font-medium text-white">Experimente a mensagem</h3>
        <p className="text-sm text-white/60">
          Envia uma mensagem real com os dados do primeiro contato para o número
          informado. Use um número seu ou autorizado. Um teste por número neste
          rascunho, até 5 números; intervalo de 30 segundos.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm text-white/80">
            Número de teste (DDI + DDD)
            <Input
              className="mt-2"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="5511987654321"
              disabled={pending}
            />
          </label>
          <Button
            variant="outline"
            disabled={pending || !connected || !testPhone.trim()}
            onClick={() =>
              run(async () => {
                const result = await sendBroadcastTest(review.id, testPhone);
                notify(
                  result.ok
                    ? "Teste aceito pela Meta. Confira a mensagem no WhatsApp e a entrega em Ver contatos."
                    : (result.error ?? "Não foi possível enviar o teste."),
                  !result.ok,
                );
              })
            }
          >
            Enviar teste
          </Button>
        </div>
      </div>
      <div className="space-y-4 rounded-control border border-white/10 p-4">
        <h3 className="font-medium text-white">Quando enviar</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectMenu
            label="Início do disparo"
            value={scheduled}
            onChange={setScheduled}
            disabled={pending}
            options={[
              { value: "now", label: "Próxima faixa permitida" },
              { value: "scheduled", label: "Escolher data e hora" },
            ]}
          />
          <SelectMenu
            label="Fuso horário"
            value={timezone}
            onChange={setTimezone}
            disabled={pending}
            options={[
              { value: "America/Sao_Paulo", label: "Horário de Brasília" },
              { value: "America/Manaus", label: "Manaus" },
              { value: "America/Rio_Branco", label: "Rio Branco" },
              { value: "America/Noronha", label: "Fernando de Noronha" },
              { value: "UTC", label: "UTC" },
            ]}
          />
          {scheduled === "scheduled" && (
            <>
              <label className="text-sm text-white/80">
                Data
                <Input
                  type="date"
                  className="mt-2"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={pending}
                />
              </label>
              <label className="text-sm text-white/80">
                Hora de início
                <Input
                  type="time"
                  className="mt-2"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={pending}
                />
              </label>
            </>
          )}
          <label className="text-sm text-white/80">
            Enviar diariamente a partir de
            <Input
              type="time"
              className="mt-2"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="text-sm text-white/80">
            Até (sem incluir este horário)
            <Input
              type="time"
              className="mt-2"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              disabled={pending}
            />
          </label>
        </div>
        <p className="text-xs text-white/60">
          Se a lista não terminar dentro da faixa, os pendentes continuam no dia
          seguinte, inclusive fins de semana. O início depende da fila de
          envios.
        </p>
      </div>
      {recent.length > 0 && (
        <Alert tone="warn">
          <p>
            {recent.length} contatos desta lista tiveram envios aceitos pela
            Meta nos últimos 7 dias.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer">Ver números</summary>
            <p className="mt-2 max-h-32 overflow-auto break-words">
              {recent.map((p) => `+${p}`).join(", ")}
            </p>
          </details>
          <label className="mt-3 flex gap-3">
            <input
              type="checkbox"
              className="accent-iris"
              checked={acknowledge}
              onChange={(e) => setAcknowledge(e.target.checked)}
              disabled={pending}
            />
            Revisei a frequência e quero continuar com estes contatos.
          </label>
        </Alert>
      )}
      <Alert>
        Bloqueados e contatos que pediram para parar serão ignorados. Aceitação,
        entrega e leitura aparecem separadamente. As cobranças da Meta seguem as
        condições da sua conta.
      </Alert>
      <label className="flex items-start gap-3 text-sm text-white/80">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={pending}
          className="mt-1 accent-iris"
        />
        <span>
          Confirmo que estes contatos autorizaram mensagens pelo WhatsApp e que
          revisei os destinatários e o conteúdo. A confirmação será registrada
          com meu usuário, data e hora.
        </span>
      </label>
      <div className="flex flex-wrap gap-3">
        <Button
          loading={pending}
          disabled={
            !connected ||
            !consent ||
            (recent.length > 0 && !acknowledge) ||
            !windowStart ||
            !windowEnd ||
            (scheduled === "scheduled" && (!date || !time))
          }
          onClick={() =>
            run(async () => {
              const result = await startBroadcast(
                review.id,
                consent,
                {
                  timezone,
                  windowStart,
                  windowEnd,
                  ...(scheduled === "scheduled" ? { date, time } : {}),
                },
                acknowledge,
              );
              if (!result.ok) {
                if (result.recentPhones) {
                  setRecent(result.recentPhones);
                  setAcknowledge(false);
                }
                notify(result.error ?? "Não foi possível confirmar.", true);
                return;
              }
              await onStarted();
            })
          }
        >
          Confirmar {review.recipients.length} envios
        </Button>
        <Button variant="outline" disabled={pending} onClick={onBack}>
          Voltar · manter rascunho
        </Button>
      </div>
    </Card>
  );
}
