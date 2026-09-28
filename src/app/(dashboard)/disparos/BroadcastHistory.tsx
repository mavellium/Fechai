"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Alert } from "@/components/ui/alert";
import type {
  BroadcastPage,
  BroadcastFilter,
} from "@/modules/broadcasts/queries";
import type { Review, RunAction } from "./BroadcastReview";
import { RecipientTable, STATUS } from "./RecipientTable";
import {
  cancelBroadcast,
  pauseBroadcast,
  resumeBroadcast,
  getBroadcastReview,
  getBroadcastDetails,
  exportBroadcast,
} from "./actions";
import { downloadBase64 } from "./download";
const timeLabel = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function BroadcastHistory({
  data,
  filter,
  onFilter,
  pending,
  run,
  refresh,
  notify,
  onReview,
}: {
  data: BroadcastPage;
  filter: BroadcastFilter;
  onFilter: (filter: BroadcastFilter) => void;
  pending: boolean;
  run: RunAction;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  onReview: (review: Review) => void;
}) {
  const [query, setQuery] = useState(filter.query ?? "");
  const [status, setStatus] = useState(filter.status ?? "");
  const [details, setDetails] = useState<{
    id: string;
    name: string;
    rows: Awaited<ReturnType<typeof getBroadcastDetails>>;
  } | null>(null);
  return (
    <>
      <Alert
        tone={data.health.online && !data.health.error ? "success" : "warn"}
        title={
          data.health.online
            ? "Serviço de envios ativo"
            : "Serviço de envios sem sinal recente"
        }
      >
        {data.health.error ??
          (data.health.online
            ? "A fila respeita o horário de cada disparo. Entrega e leitura dependem dos retornos da Meta."
            : "Os disparos confirmados ficam preservados. Verifique o processo de envios antes do horário programado.")}
        {data.health.lastSeenAt && (
          <span className="block mt-1 text-xs">
            Último sinal:{" "}
            {new Date(data.health.lastSeenAt).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}{" "}
            · Brasília
          </span>
        )}
      </Alert>
      <Card className="space-y-5">
        <div className="flex flex-wrap justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-white">
            Histórico de disparos
          </h2>
          <Button
            variant="ghost"
            size="sm"
            loading={pending}
            onClick={() => run(refresh)}
          >
            Atualizar
          </Button>
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onFilter({ query, status, page: 1 });
          }}
        >
          <label className="min-w-40 flex-1 text-sm text-white/70">
            Buscar por nome
            <Input
              className="mt-2"
              value={query}
              maxLength={100}
              onChange={(e) => setQuery(e.target.value)}
              disabled={pending}
            />
          </label>
          <SelectMenu
            label="Filtrar por situação"
            value={status}
            onChange={setStatus}
            disabled={pending}
            options={[
              { value: "", label: "Todas as situações" },
              ...["draft", "queued", "paused", "completed", "cancelled"].map(
                (value) => ({ value, label: STATUS[value] }),
              ),
            ]}
          />
          <Button type="submit" variant="outline" disabled={pending}>
            Filtrar
          </Button>
        </form>
        {!data.items.length && (
          <p className="py-8 text-center text-sm text-white/60">
            Nenhum disparo encontrado.
          </p>
        )}
        {data.items.map((c) => (
          <article
            key={c.id}
            className="space-y-3 rounded-control border border-white/10 p-4"
          >
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h3 className="font-medium text-white">{c.name}</h3>
                <p className="mt-1 text-xs text-white/60">
                  {STATUS[c.status]} · criado em{" "}
                  {new Date(c.createdAt).toLocaleString("pt-BR", {
                    timeZone: c.timezone,
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.status === "draft" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const result = await getBroadcastReview(c.id);
                        if (result) onReview(result);
                        else notify("Rascunho indisponível.", true);
                      })
                    }
                  >
                    Revisar
                  </Button>
                )}
                {c.status === "queued" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        await pauseBroadcast(c.id);
                        await refresh();
                        notify(
                          "Disparo pausado. Um envio que já estava em andamento pode concluir.",
                        );
                      })
                    }
                  >
                    Pausar
                  </Button>
                )}
                {c.status === "paused" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const result = await resumeBroadcast(c.id);
                        if (!result.ok)
                          notify(
                            result.error ?? "Não foi possível retomar.",
                            true,
                          );
                        else {
                          await refresh();
                          notify(
                            "Disparo retomado, preservando os resultados anteriores.",
                          );
                        }
                      })
                    }
                  >
                    Retomar
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(async () =>
                      setDetails({
                        id: c.id,
                        name: c.name,
                        rows: await getBroadcastDetails(c.id),
                      }),
                    )
                  }
                >
                  Ver contatos
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(async () =>
                      downloadBase64(
                        await exportBroadcast(c.id),
                        `disparo-${c.id}.csv`,
                        "text/csv;charset=utf-8",
                      ),
                    )
                  }
                >
                  Exportar CSV
                </Button>
                {["draft", "queued", "paused"].includes(c.status) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        await cancelBroadcast(c.id);
                        await refresh();
                        notify(
                          "Pendentes cancelados. Envios que já estavam em andamento podem concluir.",
                        );
                      })
                    }
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
            <p className="text-sm text-white/70">
              {c.sent}/{c.total} aceitos · {c.delivered} entregues · {c.read}{" "}
              lidos · {c.failed} recusados · {c.deliveryFailed} falhas de
              entrega · {c.unknown} a conferir · {c.skipped}{" "}
              ignorados/cancelados
            </p>
            <progress
              className="h-1.5 w-full accent-iris"
              aria-label={`Andamento de ${c.name}`}
              value={c.sent + c.failed + c.unknown + c.skipped}
              max={Math.max(c.total, 1)}
            />
            <p className="text-sm text-signal">
              {c.replies} responderam · {c.opportunities} oportunidades ·{" "}
              {c.appointments} com agendamento
            </p>
            {c.status !== "draft" && (
              <p className="text-xs text-white/55">
                Faixa diária: {timeLabel(c.windowStart)}–
                {timeLabel(c.windowEnd)} · {c.timezone}
                {c.scheduledAt
                  ? ` · programado para ${new Date(c.scheduledAt).toLocaleString("pt-BR", { timeZone: c.timezone })}`
                  : ""}
              </p>
            )}
            {c.confirmedAt && (
              <p className="text-xs text-white/55">
                Confirmado por{" "}
                {c.confirmedByLabel ?? "conta (registro anterior)"} em{" "}
                {new Date(c.confirmedAt).toLocaleString("pt-BR", {
                  timeZone: c.timezone,
                })}
                .
              </p>
            )}
            {c.error && <p className="text-sm text-warn">{c.error}</p>}
          </article>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/60">
          <span>
            {data.total} disparos · página {data.page} de {data.pages}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || data.page <= 1}
              onClick={() => onFilter({ ...filter, page: data.page - 1 })}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || data.page >= data.pages}
              onClick={() => onFilter({ ...filter, page: data.page + 1 })}
            >
              Próxima
            </Button>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-white/55">
          Resultados por contato, sem testes: resposta em até 7 dias atribuída
          ao último disparo anterior. Oportunidade exige que o contato passe a
          quente/agendado; agendamento considera uma nova consulta encontrada ao
          processar a resposta. São registros históricos, não prova de que o
          disparo causou a conversão. Leituras podem não ser informadas pela
          Meta. Resultados incertos nunca são reenviados automaticamente.
        </p>
      </Card>
      {details && (
        <Card className="space-y-4">
          <div className="flex flex-wrap justify-between gap-3">
            <h2 className="font-semibold text-white">
              Contatos · {details.name}
            </h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(async () =>
                    setDetails({
                      ...details,
                      rows: await getBroadcastDetails(details.id),
                    }),
                  )
                }
              >
                Atualizar contatos
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDetails(null)}
              >
                Fechar
              </Button>
            </div>
          </div>
          <RecipientTable rows={details.rows} />
        </Card>
      )}
    </>
  );
}
