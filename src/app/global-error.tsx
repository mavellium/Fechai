"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    posthog.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body>
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="font-display text-xl font-semibold text-ink">Algo deu errado</h1>
          <p className="mt-2 text-sm text-neutral">Não conseguimos carregar esta tela. Tente de novo.</p>
          <Button className="mt-6" type="button" onClick={reset}>
            Tentar de novo
          </Button>
        </main>
      </body>
    </html>
  );
}
