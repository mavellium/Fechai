import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Classe base compartilhada por Input, Textarea e Select — assim os três têm
 * exatamente a mesma altura, raio, foco e comportamento em fundo claro/escuro.
 */
export const fieldBase = [
  "w-full rounded-control border px-3 py-2 text-sm transition-colors",
  "border-ink/15 bg-white text-ink placeholder:text-neutral",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:border-iris",
  "disabled:cursor-not-allowed disabled:opacity-50",
  // erro: borda + anel próprios (a mensagem em texto fica no <Field>)
  "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger",
  // dentro do painel escuro
  "panel:border-white/20 panel:bg-white/5 panel:text-white panel:placeholder:text-white/50",
].join(" ");

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, "h-10", className)} {...props} />
  ),
);
Input.displayName = "Input";
