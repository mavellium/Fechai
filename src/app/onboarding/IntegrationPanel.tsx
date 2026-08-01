"use client";

import { useState, useTransition } from "react";
import { Globe, MessageCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { StatusDot } from "@/components/ui/badge";
import { connectWhatsapp, refreshWhatsappStatus } from "@/app/(dashboard)/whatsapp/actions";

/**
 * Passo 4 — as duas portas de entrada do agente: o site do cliente (snippet) e
 * o WhatsApp dele (QR code). Nenhuma das duas trava o onboarding: dá pra
 * concluir e conectar depois pelo painel.
 */

const STATUS: Record<string, { label: string; tone: "success" | "warn" | "neutral" }> = {
  connected: { label: "Conectado", tone: "success" },
  pending_qr: { label: "Aguardando leitura do QR", tone: "warn" },
  disconnected: { label: "Ainda não conectado", tone: "neutral" },
};

export function IntegrationPanel({
  tenantId,
  initialWhatsappStatus,
}: {
  tenantId: string;
  initialWhatsappStatus: string;
}) {
  const pullZone = process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE;
  const snippet = pullZone ? `<script src="https://${pullZone}/widget/${tenantId}/widget.js" defer></script>` : null;

  const [status, setStatus] = useState(initialWhatsappStatus);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function runWhatsapp(action: typeof connectWhatsapp) {
    setError(null);
    start(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error ?? "Não conseguimos conectar agora. Tente de novo em instantes.");
        return;
      }
      if (res.status) setStatus(res.status);
      setQr(res.qrCode ?? null);
    });
  }

  const s = STATUS[status] ?? STATUS.disconnected;

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- no site */}
      <section className="rounded-xl border border-neutral/20 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Globe size={18} className="mt-0.5 shrink-0 text-iris" aria-hidden />
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-ink">No seu site</h3>
            <p className="mt-1 text-sm text-neutral">
              Cole este trecho no seu site, antes de fechar a página. O atendente aparece como uma
              janelinha de conversa no canto.
            </p>
          </div>
        </div>

        {snippet ? (
          <>
            <div className="mt-4 overflow-x-auto rounded-lg bg-ink px-4 py-3">
              <code className="font-mono text-xs whitespace-pre text-white/80">{snippet}</code>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <CopyButton value={snippet} label="Copiar código" onCopyError={setError} />
              <span className="text-xs text-neutral">
                Não sabe onde colar? Envie para quem cuida do seu site.
              </span>
            </div>
          </>
        ) : (
          <Alert tone="warn" className="mt-4">
            A CDN do widget ainda não está configurada nesta conta.
          </Alert>
        )}
      </section>

      {/* ------------------------------------------------------- no whatsapp */}
      <section className="rounded-xl border border-neutral/20 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <MessageCircle size={18} className="mt-0.5 shrink-0 text-iris" aria-hidden />
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-semibold text-ink">No seu WhatsApp</h3>
            <p className="mt-1 text-sm text-neutral">
              Conecte o número que seus clientes já usam. O atendente passa a responder por lá.
            </p>
          </div>
        </div>

        <div className="mt-4" aria-live="polite">
          <StatusDot tone={s.tone}>{s.label}</StatusDot>
        </div>

        {qr && status !== "connected" && (
          <div className="mt-4 w-fit rounded-lg border border-neutral/20 bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`}
              alt="Código QR para conectar o WhatsApp"
              width={200}
              height={200}
            />
            <p className="mt-2 max-w-[200px] text-center text-xs text-neutral">
              No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runWhatsapp(connectWhatsapp)}
            loading={pending}
            loadingLabel="Conectando"
          >
            {status === "connected" ? "Reconectar" : "Conectar WhatsApp"}
          </Button>
          {status !== "disconnected" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => runWhatsapp(refreshWhatsappStatus)}
              disabled={pending}
            >
              Já conectei, verificar
            </Button>
          )}
        </div>
      </section>

      {error && <Alert tone="warn">{error}</Alert>}
    </div>
  );
}
