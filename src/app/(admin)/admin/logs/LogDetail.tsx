"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LogRow } from "./LogList";

/**
 * O detalhe de um evento: o que mudou, campo a campo.
 *
 * Duas colunas — antes e depois — em vez de dois blocos de JSON: ler dois JSON
 * lado a lado para achar a linha diferente é exatamente o trabalho que esta
 * tela deveria estar poupando. Como `recordChange` já guarda só os campos
 * alterados, cada linha aqui é uma alteração real.
 */
export function LogDetail({ row }: { row: LogRow }) {
  const before = asRecord(row.before);
  const after = asRecord(row.after);
  const meta = asRecord(row.meta);

  // A união dos dois lados: um `create` só tem `after`, um `delete` só tem
  // `before`, e um `update` tem os dois com as mesmas chaves.
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];

  const isDelete = row.kind === "delete";

  return (
    <div className="space-y-6">
      {row.revertedAt && (
        <p className="rounded-surface border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
          Desfeito em {new Date(row.revertedAt).toLocaleString("pt-BR")}
          {row.revertedByEmail ? ` por ${row.revertedByEmail}` : ""}.
        </p>
      )}

      {/* O aviso vem ANTES do botão de desfazer (que fica no rodapé do painel),
          não depois: quem restaura um registro excluído precisa saber o que
          não volta antes de clicar, não descobrir depois no resultado. */}
      {isDelete && row.revertible && !row.revertedAt && (
        <p className="flex gap-2 rounded-surface border border-warn/30 bg-warn/10 px-3 py-2 text-sm leading-relaxed text-white/80">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-warn" />
          <span>
            Restaurar recria o registro com o mesmo identificador, então o que apontava para ele
            volta a apontar. <strong className="text-white">Não volta</strong> o que foi apagado
            junto (itens ligados a ele) nem o que já saiu de serviços externos — arquivo removido
            da CDN, voz apagada, sessão de WhatsApp derrubada.
          </span>
        </p>
      )}

      <section>
        <h3 className="font-mono text-micro uppercase tracking-wide text-white/55">Evento</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <Row label="Quando">{new Date(row.createdAt).toLocaleString("pt-BR")}</Row>
          <Row label="Autor">
            {row.actorEmail ?? "sistema"}
            {row.impersonated && (
              <Badge tone="warn" className="ml-2">
                agindo como o cliente
              </Badge>
            )}
          </Row>
          <Row label="Conta">{row.tenantName ?? "—"}</Row>
          {row.targetLabel && <Row label="Alvo">{row.targetLabel}</Row>}
          {row.targetType && (
            <Row label="Registro">
              <span className="font-mono text-micro text-white/60">
                {row.targetType} · {row.targetId}
              </span>
            </Row>
          )}
          {row.ip && (
            <Row label="IP">
              <span className="font-mono text-micro text-white/60">{row.ip}</span>
            </Row>
          )}
        </dl>
      </section>

      {fields.length > 0 && (
        <section className="border-t border-white/10 pt-5">
          <h3 className="font-mono text-micro uppercase tracking-wide text-white/55">
            {isDelete ? "Registro excluído" : row.kind === "create" ? "Criado com" : "O que mudou"}
          </h3>

          <ul className="mt-2 space-y-2">
            {fields.map((field) => (
              <li key={field} className="rounded-surface border border-white/10 bg-white/5 p-3">
                <p className="font-mono text-micro uppercase tracking-wide text-white/55">
                  {field}
                </p>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {before && field in before && (
                    <Value label="antes" value={before[field]} tone="danger" />
                  )}
                  {after && field in after && (
                    <Value label="depois" value={after[field]} tone="success" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {meta && Object.keys(meta).length > 0 && (
        <section className="border-t border-white/10 pt-5">
          <h3 className="font-mono text-micro uppercase tracking-wide text-white/55">Contexto</h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {Object.entries(meta).map(([key, value]) => (
              <Row key={key} label={key}>
                <span className="font-mono text-micro text-white/70">{stringify(value)}</span>
              </Row>
            ))}
          </dl>
        </section>
      )}

      {!row.revertible && !row.revertedAt && (
        <p className="border-t border-white/10 pt-5 text-sm leading-relaxed text-white/55">
          Este evento não pode ser desfeito — ou porque não altera um estado que se possa
          regravar (uma entrada na conta), ou porque desfazê-lo dependeria de algo fora do nosso
          banco.
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-micro uppercase tracking-wide text-white/45">{label}</dt>
      <dd className="min-w-0 break-words text-white/80">{children}</dd>
    </>
  );
}

/**
 * Um valor do snapshot. Texto longo fica com altura limitada e rolagem própria
 * — um `systemPrompt` de 3 mil caracteres empurraria todo o resto do painel
 * para fora da tela.
 */
function Value({
  label,
  value,
  tone,
}: {
  label: string;
  value: unknown;
  tone: "danger" | "success";
}) {
  const text = stringify(value);
  return (
    <div>
      <p className={`font-mono text-micro uppercase tracking-wide ${
        tone === "danger" ? "text-danger" : "text-success"
      }`}>
        {label}
      </p>
      <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-micro leading-relaxed text-white/75">
        {text}
      </pre>
    </div>
  );
}

/** Valores legíveis: nada de "[object Object]" nem de `null` cru na tela. */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (typeof value === "string") return value || "(vazio)";
  if (typeof value === "number") return value.toLocaleString("pt-BR");
  // Marca deixada pelo redator quando o texto passou do teto do snapshot.
  if (typeof value === "object" && value !== null && "__truncated" in value) {
    const t = value as unknown as { length: number; preview: string };
    return `${t.preview}…\n\n[texto cortado no registro — ${t.length.toLocaleString("pt-BR")} caracteres no total]`;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
