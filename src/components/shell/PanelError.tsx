"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Tela de erro dos painéis. O `digest` aparece porque é a única pista que o
 * usuário consegue nos passar quando abre um chamado — a mensagem real do erro
 * fica no servidor de propósito.
 */
export function PanelError({
  error,
  reset,
  supportHref = "/configuracoes",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  supportHref?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="font-display text-xl font-semibold text-white">Algo deu errado</h1>
      <p className="mt-2 text-sm text-white/65">
        Não conseguimos carregar esta tela. Tente de novo — se continuar, nos avise que a gente
        investiga.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw size={15} aria-hidden />
          Tentar de novo
        </Button>
        <ButtonLink href={supportHref} variant="outline">
          Enviar feedback
        </ButtonLink>
      </div>

      {error.digest && (
        <p className="mt-6 font-mono text-micro uppercase tracking-[0.15em] text-white/50">
          código do erro · {error.digest}
        </p>
      )}
    </div>
  );
}
