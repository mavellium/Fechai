"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2, ShieldAlert, ShieldBan, UserCog, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SidePanel } from "@/components/ui/side-panel";
import { revertAuditEvent } from "../../actions";
import { LogDetail } from "./LogDetail";
import { BlockIpDialog, type IpSummary } from "./BlockIpDialog";
import { ipSummaryFor } from "./actions";
import { filtersToHrefWithCursor, type LogFilterValues } from "./filter-url";

export type LogRow = {
  id: string;
  createdAt: string;
  event: string;
  label: string;
  kind: string;
  tenantId: string | null;
  tenantName: string | null;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string;
  impersonated: boolean;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  ip: string | null;
  revertible: boolean;
  revertedAt: string | null;
  revertedByEmail: string | null;
};

/**
 * A lista de eventos.
 *
 * Uma linha por evento, com o que responde a pergunta de imediato — quando,
 * quem, em qual conta, o quê — e o resto (o diff campo a campo) atrás de um
 * clique. O diff aberto em todas as linhas transformaria a página numa parede
 * de JSON: a maioria das visitas é para varrer a cronologia, não para ler um
 * evento específico.
 *
 * O `kind` é sinalizado por texto no rótulo e por uma barra colorida à
 * esquerda — nunca só pela cor (design-ui, §4).
 */
export function LogList({
  rows,
  nextCursor,
  filters,
  blockedIps,
}: {
  rows: LogRow[];
  nextCursor: string | null;
  /** O recorte em vigor — o "carregar mais" continua nele, não na lista toda. */
  filters: LogFilterValues;
  /** IPs desta página que já estão bloqueados — para não oferecer de novo. */
  blockedIps: string[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [blockTarget, setBlockTarget] = useState<IpSummary | null>(null);
  const router = useRouter();

  const open = rows.find((r) => r.id === openId) ?? null;
  const blocked = new Set(blockedIps);

  /**
   * Abre o diálogo já com o histórico do IP. O resumo é buscado no clique
   * (ver `ipSummaryFor`): calcular para as 50 linhas no carregamento seriam 50
   * agregações para números que quase sempre ninguém vai olhar.
   */
  function askBlock(ip: string, rowId: string) {
    setFeedback(null);
    start(async () => {
      const result = await ipSummaryFor(ip);
      if (!result.ok) {
        setFeedback({ id: rowId, ok: false, text: result.error });
        return;
      }
      setBlockTarget(result.summary);
    });
  }

  function revert(row: LogRow) {
    setFeedback(null);
    start(async () => {
      const result = await revertAuditEvent(row.id);
      setFeedback({
        id: row.id,
        ok: Boolean(result.ok),
        text: result.ok
          ? (result.info ?? "Evento desfeito.")
          : (result.error ?? "Não foi possível desfazer."),
      });
      // Deu certo: a linha vira "desfeito" e o alvo mudou de estado. Sem
      // recarregar, a tela seguiria oferecendo desfazer o que já foi desfeito.
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {rows.map((row) => {
          const done = Boolean(row.revertedAt);
          const canRevert = row.revertible && !done;
          const message = feedback?.id === row.id ? feedback : null;

          // Bloquear só faz sentido em evento de ACESSO (entrou, falhou ao
          // entrar, personificou): é onde o IP identifica quem está batendo na
          // porta. Numa alteração de persona o IP é do próprio cliente logado,
          // e oferecer "bloquear" ali convida a barrar um cliente pagante por
          // um clique fora de lugar.
          const ipActionable =
            Boolean(row.ip) &&
            row.ip !== "desconhecido" &&
            (row.kind === "auth" || row.kind === "access");
          const ipBlocked = Boolean(row.ip && blocked.has(row.ip));

          return (
            <li key={row.id}>
              <Card className="p-0">
                <div className="flex items-stretch">
                  {/* Faixa de tipo: reforço visual do rótulo, nunca o único
                      sinal — o texto do evento já diz o que aconteceu. */}
                  <span aria-hidden className={`w-1 shrink-0 rounded-l-surface ${kindBar(row.kind)}`} />

                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-white">{row.label}</span>

                        {row.targetLabel && (
                          <span className="truncate font-mono text-micro text-white/55">
                            {row.targetLabel}
                          </span>
                        )}

                        {row.impersonated && (
                          <Badge tone="warn" icon={<UserCog size={11} aria-hidden />}>
                            como cliente
                          </Badge>
                        )}
                        {row.actorRole === "SUPERADMIN" && !row.impersonated && (
                          <Badge tone="signal" icon={<ShieldAlert size={11} aria-hidden />}>
                            admin
                          </Badge>
                        )}
                        {done && <Badge tone="neutral">desfeito</Badge>}
                        {/* O IP já barrado aparece marcado na própria linha:
                            sem isso o admin abriria o diálogo para descobrir
                            que já tinha bloqueado aquele endereço ontem. */}
                        {ipBlocked && (
                          <Badge tone="danger" icon={<ShieldBan size={11} aria-hidden />}>
                            IP bloqueado
                          </Badge>
                        )}
                      </p>

                      <p className="mt-1 truncate font-mono text-micro uppercase tracking-wide text-white/45">
                        {formatWhen(row.createdAt)}
                        {" · "}
                        {row.actorEmail ?? "sistema"}
                        {row.tenantName ? ` · ${row.tenantName}` : ""}
                        {row.ip ? ` · ${row.ip}` : ""}
                      </p>

                      {message && (
                        <p
                          role="alert"
                          className={`mt-1.5 font-mono text-micro ${message.ok ? "text-success" : "text-danger"}`}
                        >
                          {message.text}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {ipActionable && !ipBlocked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => askBlock(row.ip!, row.id)}
                          title={`Bloquear ${row.ip} do login`}
                        >
                          <ShieldBan size={14} aria-hidden />
                          Bloquear IP
                        </Button>
                      )}

                      {canRevert && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setOpenId(row.id)}
                          title="Ver o que mudou e desfazer"
                        >
                          <Undo2 size={14} aria-hidden />
                          Desfazer
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpenId(row.id)}
                        aria-label={`Ver detalhes de: ${row.label}`}
                      >
                        Detalhes
                        <ChevronRight size={14} aria-hidden />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {nextCursor && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => router.push(filtersToHrefWithCursor(filters, nextCursor))}
          >
            Carregar mais
          </Button>
        </div>
      )}

      <SidePanel
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={open?.label ?? ""}
        subtitle={
          open ? (
            <span className="font-mono text-micro uppercase tracking-wide">
              {formatWhen(open.createdAt)} · {open.actorEmail ?? "sistema"}
              {open.tenantName ? ` · ${open.tenantName}` : ""}
            </span>
          ) : undefined
        }
        footer={
          open && open.revertible && !open.revertedAt ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => setOpenId(null)}>
                Fechar
              </Button>
              <Button
                variant="destructive"
                loading={pending}
                loadingLabel="Desfazendo"
                onClick={() => revert(open)}
              >
                <Undo2 size={15} aria-hidden />
                Desfazer este evento
              </Button>
            </div>
          ) : undefined
        }
      >
        {open && <LogDetail row={open} />}
      </SidePanel>

      <BlockIpDialog
        summary={blockTarget}
        open={Boolean(blockTarget)}
        onClose={() => setBlockTarget(null)}
      />
    </div>
  );
}

/** Cor da faixa por tipo. Acompanha o rótulo, nunca o substitui. */
function kindBar(kind: string): string {
  switch (kind) {
    case "delete":
      return "bg-danger/70";
    case "create":
      return "bg-success/70";
    case "update":
      return "bg-iris/70";
    case "access":
      return "bg-warn/70";
    default:
      return "bg-white/15";
  }
}

/**
 * Data e hora completas, sempre — nunca "há 3 horas". A trilha existe para
 * responder "quando exatamente?", e um tempo relativo obriga o admin a fazer a
 * conta de cabeça justamente quando ele está comparando com o horário de um
 * incidente.
 */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
