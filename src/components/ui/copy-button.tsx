"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "./button";

/**
 * Copiar para a área de transferência com confirmação visível.
 *
 * Terceira cópia do mesmo `navigator.clipboard.writeText` + `setTimeout` que já
 * existia no admin (senha provisória) e no onboarding (snippet do site) — as
 * duas sem tratamento de erro em contexto sem permissão de clipboard.
 */
export function CopyButton({
  value,
  label = "Copiar",
  copiedLabel = "Copiado",
  onCopyError,
  ...props
}: Omit<ButtonProps, "onClick" | "children" | "value"> & {
  value: string;
  label?: string;
  copiedLabel?: string;
  /** Não se chama `onError`: esse nome colide com o evento DOM de `<button>`. */
  onCopyError?: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      onCopyError?.("Não conseguimos copiar automaticamente. Selecione o texto e use Ctrl+C.");
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} {...props}>
      {copied ? (
        <Check size={14} strokeWidth={3} className="text-success" aria-hidden />
      ) : (
        <Copy size={14} aria-hidden />
      )}
      {copied ? copiedLabel : label}
      {/* o ícone muda, mas leitor de tela precisa ouvir a confirmação */}
      <span role="status" className="sr-only">
        {copied ? "Copiado para a área de transferência" : ""}
      </span>
    </Button>
  );
}
