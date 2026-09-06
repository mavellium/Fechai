"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { unblockIpAddress } from "../../actions";

export type BlockedRow = {
  id: string;
  ip: string;
  reason: string;
  blockedByEmail: string | null;
  /** ISO; null = permanente. */
  expiresAt: string | null;
  lastEmail: string | null;
  attemptsAtBlock: number;
  createdAt: string;
  expired: boolean;
};

/**
 * Os IPs bloqueados.
 *
 * Os vencidos aparecem junto, marcados como "expirou", em vez de sumirem: quem
 * bloqueou por 24 horas e não encontrasse mais a linha depois concluiria que
 * outro admin desfez a ação dele. Vencido não barra mais ninguém — o botão
 * passa a ser "remover da lista", que é limpeza, não liberação.
 *
 * O motivo fica na linha, não escondido: é o que permite decidir meses depois
 * se o bloqueio ainda faz sentido. Um bloqueio sem motivo à vista tende a ficar
 * para sempre, porque ninguém se arrisca a tirar o que não entende.
 */
export function BlockedList({ rows }: { rows: BlockedRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ ip: string; text: string } | null>(null);

  function unblock(ip: string) {
    setError(null);
    start(async () => {
      const result = await unblockIpAddress(ip);
      if (!result.ok) {
        setError({ ip, text: result.error ?? "Não foi possível desbloquear." });
        return;
      }
      router.refresh();
    });
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const message = error?.ip === row.ip ? error.text : null;

        return (
          <li key={row.id}>
            <Card className="p-0">
              <div className="flex items-stretch">
                <span
                  aria-hidden
                  className={`w-1 shrink-0 rounded-l-surface ${
                    row.expired ? "bg-white/15" : "bg-danger/70"
                  }`}
                />

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-white">{row.ip}</span>
                      {row.expired ? (
                        <Badge tone="neutral">expirou</Badge>
                      ) : row.expiresAt ? (
                        <Badge tone="warn">até {formatWhen(row.expiresAt)}</Badge>
                      ) : (
                        <Badge tone="danger">permanente</Badge>
                      )}
                    </p>

                    <p className="mt-1 text-sm leading-relaxed text-white/75">{row.reason}</p>

                    <p className="mt-1 truncate font-mono text-micro uppercase tracking-wide text-white/45">
                      {formatWhen(row.createdAt)}
                      {row.blockedByEmail ? ` · por ${row.blockedByEmail}` : ""}
                      {row.attemptsAtBlock > 0 ? ` · ${row.attemptsAtBlock} tentativas` : ""}
                      {row.lastEmail ? ` · ${row.lastEmail}` : ""}
                    </p>

                    {message && (
                      <p role="alert" className="mt-1.5 font-mono text-micro text-danger">
                        {message}
                      </p>
                    )}
                  </div>

                  <ConfirmButton
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    confirm={
                      row.expired
                        ? {
                            title: `Remover ${row.ip} da lista?`,
                            description:
                              "Este bloqueio já venceu e não barra mais ninguém — tirá-lo da lista é só limpeza.",
                            confirmLabel: "Remover",
                          }
                        : {
                            title: `Desbloquear ${row.ip}?`,
                            description: `Este endereço volta a conseguir entrar. Motivo do bloqueio: “${row.reason}”.`,
                            confirmLabel: "Desbloquear",
                          }
                    }
                    onConfirm={() => unblock(row.ip)}
                  >
                    <ShieldCheck size={14} aria-hidden />
                    {row.expired ? "Remover" : "Desbloquear"}
                  </ConfirmButton>
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
