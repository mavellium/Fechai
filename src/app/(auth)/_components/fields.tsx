"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LabeledField } from "@/components/ui/field";
import { cn } from "@/lib/utils";

// O `LabeledField` local virou o `Field` de `components/ui` — mesmo contrato,
// uma implementação só para (auth), onboarding e painel. Reexportado aqui para
// as telas de (auth) não precisarem trocar o import.
export { LabeledField };

export function EmailField({
  error,
  onValidate,
  defaultValue,
  autoFocus,
}: {
  error?: string | null;
  onValidate?: (err: string | null) => void;
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <LabeledField label="E-mail" htmlFor={id} error={error}>
      <Input
        id={id}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="voce@seunegocio.com.br"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        required
        aria-invalid={Boolean(error)}
        className={cn(error && "border-danger focus-visible:ring-danger")}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          onValidate?.(
            !v ? null : /.+@.+\..+/.test(v) ? null : "Esse e-mail não parece completo — confira o @ e o domínio.",
          );
        }}
      />
    </LabeledField>
  );
}

export function PasswordField({
  label = "Senha",
  minLength,
  error,
  onValidate,
  autoComplete,
}: {
  label?: string;
  minLength?: number;
  error?: string | null;
  onValidate?: (err: string | null) => void;
  autoComplete: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <LabeledField
      label={label}
      htmlFor={id}
      error={error}
      hint={minLength ? `Mínimo de ${minLength} caracteres.` : undefined}
    >
      <div className="relative">
        <Input
          id={id}
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          aria-invalid={Boolean(error)}
          className={cn("pr-10", error && "border-danger focus-visible:ring-danger")}
          onChange={(e) => {
            if (!minLength || !onValidate) return;
            const v = e.currentTarget.value;
            onValidate(
              v.length === 0 || v.length >= minLength
                ? null
                : `Faltam ${minLength - v.length} caracteres para uma senha válida.`,
            );
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((s) => !s)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-neutral hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </LabeledField>
  );
}
