"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/alert";
import { setWhatsappProvider } from "./actions";

export function WhatsappProviderSelector({
  provider,
  connected,
  metaEnabled,
}: {
  provider: "evolution" | "meta";
  connected: boolean;
  metaEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function select(next: "evolution" | "meta") {
    if (next === provider || connected) return;
    setError(null);
    start(async () => {
      const result = await setWhatsappProvider(next);
      if (!result.ok) setError(result.error ?? "Não foi possível trocar o provedor.");
      router.refresh();
    });
  }

  return (
    <div className="mb-6 space-y-2 border-b border-white/10 pb-6">
      <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/50">
        forma de conexão
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Provedor do WhatsApp">
        <Button
          type="button"
          variant={provider === "evolution" ? "default" : "outline"}
          onClick={() => select("evolution")}
          disabled={connected || pending}
        >
          Evolution · código QR
        </Button>
        {metaEnabled && (
          <Button
            type="button"
            variant={provider === "meta" ? "default" : "outline"}
            onClick={() => select("meta")}
            disabled={connected || pending}
          >
            Meta · API oficial
          </Button>
        )}
      </div>
      <p className="text-sm text-white/55">
        {connected
          ? "Para trocar de provedor, desconecte o número atual primeiro."
          : provider === "meta"
            ? "Conexão direta com a WhatsApp Business Platform, sem leitura de QR."
            : "Conecta um aparelho do WhatsApp à Evolution por código QR."}
      </p>
      <FormFeedback error={error} />
    </div>
  );
}
