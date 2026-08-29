"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, Lock, Mail, Phone, IdCard, CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LabeledField } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { maskCpfCnpj, maskPhone, isValidCpfCnpj, isValidPhone } from "@/lib/br-lead";

// O `LabeledField` local virou o `Field` de `components/ui` — mesmo contrato,
// uma implementação só para (auth), onboarding e painel. Reexportado aqui para
// as telas de (auth) não precisarem trocar o import.
export { LabeledField };

export function EmailField({
  error,
  onValidate,
  defaultValue,
  value,
  onValueChange,
  autoFocus,
}: {
  error?: string | null;
  onValidate?: (err: string | null) => void;
  defaultValue?: string;
  /** Controlado quando o valor precisa sobreviver a uma troca de passo. */
  value?: string;
  onValueChange?: (value: string) => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <LabeledField label="E-mail" htmlFor={id} error={error}>
      <div className="relative">
        <Mail
          size={16}
          className="pointer-events-none absolute inset-y-0 left-3 my-auto text-neutral"
          aria-hidden
        />
        <Input
          id={id}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="voce@seunegocio.com.br"
          defaultValue={value === undefined ? defaultValue : undefined}
          value={value}
          autoFocus={autoFocus}
          required
          aria-invalid={Boolean(error)}
          className={cn("pl-10", error && "border-danger focus-visible:ring-danger")}
          onChange={(e) => onValueChange?.(e.currentTarget.value)}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            onValidate?.(
              !v ? null : /.+@.+\..+/.test(v) ? null : "Esse e-mail não parece completo — confira o @ e o domínio.",
            );
          }}
        />
      </div>
    </LabeledField>
  );
}

export function PasswordField({
  label = "Senha",
  name = "password",
  minLength,
  error,
  onValidate,
  autoComplete,
  hint,
  value,
  onValueChange,
}: {
  label?: string;
  /** Permite dois campos de senha no mesmo formulário (senha + confirmação). */
  name?: string;
  minLength?: number;
  error?: string | null;
  onValidate?: (err: string | null) => void;
  autoComplete: string;
  hint?: string;
  /** Controlado quando o formulário precisa comparar as duas senhas. */
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const id = useId();
  // Sempre nasce oculta: o valor é sensível e quem está de lado não deve ler a
  // senha sem o usuário pedir. O olho é o opt-in, nunca o padrão.
  const [visible, setVisible] = useState(false);
  const resolvedHint = hint ?? (minLength ? `Mínimo de ${minLength} caracteres.` : undefined);

  return (
    <LabeledField label={label} htmlFor={id} error={error} hint={resolvedHint}>
      <div className="relative">
        <Lock
          size={16}
          className="pointer-events-none absolute inset-y-0 left-3 my-auto text-neutral"
          aria-hidden
        />
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          value={value}
          aria-invalid={Boolean(error)}
          className={cn("pl-10 pr-10", error && "border-danger focus-visible:ring-danger")}
          onChange={(e) => {
            const v = e.currentTarget.value;
            onValueChange?.(v);
            if (!minLength || !onValidate) return;
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
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-control text-neutral transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
    </LabeledField>
  );
}

/*
 * Os campos abaixo são CONTROLADOS de propósito. O cadastro virou um wizard de
 * 3 passos: um passo que sai da tela desmonta seus campos, e estado interno
 * morreria junto — voltar para o passo anterior mostraria tudo em branco. Com o
 * valor morando no wizard, ele sobrevive à navegação entre passos.
 */

export function DocumentField({
  value,
  onChange,
  error,
  onValidate,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  onValidate?: (err: string | null) => void;
}) {
  const id = useId();
  return (
    <LabeledField label="CPF ou CNPJ" htmlFor={id} error={error}>
      <div className="relative">
        <IdCard
          size={16}
          className="pointer-events-none absolute inset-y-0 left-3 my-auto text-neutral"
          aria-hidden
        />
        <Input
          id={id}
          name="document"
          inputMode="numeric"
          autoComplete="off"
          placeholder="000.000.000-00"
          value={value}
          required
          aria-invalid={Boolean(error)}
          className={cn("pl-10", error && "border-danger focus-visible:ring-danger")}
          onChange={(e) => onChange(maskCpfCnpj(e.currentTarget.value))}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            onValidate?.(!v ? null : isValidCpfCnpj(v) ? null : "CPF ou CNPJ inválido — confira os números.");
          }}
        />
      </div>
    </LabeledField>
  );
}

export function PhoneField({
  name,
  label,
  value,
  onChange,
  error,
  onValidate,
  optional,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  onValidate?: (err: string | null) => void;
  optional?: boolean;
}) {
  const id = useId();
  return (
    <LabeledField label={label} htmlFor={id} error={error} optional={optional}>
      <div className="relative">
        <Phone
          size={16}
          className="pointer-events-none absolute inset-y-0 left-3 my-auto text-neutral"
          aria-hidden
        />
        <Input
          id={id}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete={optional ? "tel-national" : "tel"}
          placeholder="(11) 98765-4321"
          value={value}
          required={!optional}
          aria-invalid={Boolean(error)}
          className={cn("pl-10", error && "border-danger focus-visible:ring-danger")}
          onChange={(e) => onChange(maskPhone(e.currentTarget.value))}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            onValidate?.(!v ? null : isValidPhone(v) ? null : "Telefone inválido — inclua o DDD.");
          }}
        />
      </div>
    </LabeledField>
  );
}

export function DateField({
  label,
  name,
  value,
  onChange,
  hint,
  max,
  error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  max?: string;
  error?: string | null;
}) {
  const id = useId();
  return (
    <LabeledField label={label} htmlFor={id} error={error} hint={hint}>
      <div className="relative">
        <CalendarDays
          size={16}
          className="pointer-events-none absolute inset-y-0 left-3 my-auto text-neutral"
          aria-hidden
        />
        <Input
          id={id}
          name={name}
          type="date"
          value={value}
          max={max}
          required
          aria-invalid={Boolean(error)}
          className={cn("pl-10", error && "border-danger focus-visible:ring-danger")}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      </div>
    </LabeledField>
  );
}

export function SelectField({
  label,
  name,
  options,
  value,
  onChange,
  icon,
  placeholder = "Selecione",
  optional,
  className,
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  placeholder?: string;
  optional?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <LabeledField label={label} htmlFor={id} optional={optional} className={className}>
      <Select
        id={id}
        name={name}
        icon={icon}
        required={!optional}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </LabeledField>
  );
}
