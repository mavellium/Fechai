"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, Lock, Mail, Phone, Building2, MapPin, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { LabeledField } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { maskCnpj, maskPhone, maskCep, isValidCnpj, isValidPhone, isValidCep } from "@/lib/br-lead";

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

/**
 * Documento da empresa. **Só CNPJ**: o fechai é vendido para negócios, e um
 * campo que aceitasse CPF prometeria um cadastro que o servidor recusa.
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
    <LabeledField label="CNPJ" htmlFor={id} error={error} hint="Só aceitamos cadastro de empresas.">
      <div className="relative">
        <Building2
          size={16}
          className="pointer-events-none absolute inset-y-0 left-3 my-auto text-neutral"
          aria-hidden
        />
        <Input
          id={id}
          name="document"
          inputMode="numeric"
          autoComplete="off"
          placeholder="00.000.000/0000-00"
          value={value}
          required
          aria-invalid={Boolean(error)}
          className={cn("pl-10", error && "border-danger focus-visible:ring-danger")}
          onChange={(e) => onChange(maskCnpj(e.currentTarget.value))}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            onValidate?.(!v ? null : isValidCnpj(v) ? null : "CNPJ inválido — confira os números.");
          }}
        />
      </div>
    </LabeledField>
  );
}

/**
 * CEP do negócio, com a busca de endereço pendurada no campo.
 *
 * Quem dispara a busca é o formulário (prop `onComplete`, chamada quando os 8
 * dígitos entram) — este componente não conhece o ViaCEP. O `loading` vem de
 * fora pelo mesmo motivo: é o formulário que sabe se a busca está em curso.
 */
export function CepField({
  value,
  onChange,
  onComplete,
  loading,
  hint,
  error,
  onValidate,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Chamada assim que o CEP fica completo (8 dígitos). */
  onComplete?: (cep: string) => void;
  loading?: boolean;
  hint?: string;
  error?: string | null;
  onValidate?: (err: string | null) => void;
}) {
  const id = useId();
  return (
    <LabeledField label="CEP" htmlFor={id} error={error} hint={hint}>
      <div className="relative">
        <MapPin
          size={16}
          className="pointer-events-none absolute inset-y-0 left-3 my-auto text-neutral"
          aria-hidden
        />
        <Input
          id={id}
          name="zipCode"
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="00000-000"
          value={value}
          required
          aria-invalid={Boolean(error)}
          aria-busy={loading || undefined}
          className={cn("pl-10 pr-10", error && "border-danger focus-visible:ring-danger")}
          onChange={(e) => {
            const masked = maskCep(e.currentTarget.value);
            onChange(masked);
            if (isValidCep(masked)) onComplete?.(masked);
          }}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            onValidate?.(!v ? null : isValidCep(v) ? null : "CEP inválido — são 8 dígitos.");
          }}
        />
        {loading && (
          <Loader2
            size={16}
            className="pointer-events-none absolute inset-y-0 right-3 my-auto animate-spin text-iris"
            aria-hidden
          />
        )}
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

/**
 * Campo de escolha do cadastro.
 *
 * Usa o `SelectMenu` do produto, não o `<select>` nativo: o menu nativo é
 * pintado pelo sistema operacional e abre com a fonte, o realce e as cores
 * dele, fora dos tokens da marca — e não há CSS que alcance aquele popup.
 *
 * O menu do produto é `position: fixed`, então ele também escapa de qualquer
 * ancestral com `overflow` (o passo do wizard, que anima altura) em vez de
 * nascer cortado dentro dele.
 */
export function SelectField({
  label,
  name,
  options,
  value,
  onChange,
  icon,
  placeholder = "Selecione",
  optional,
  disabled,
  about,
  error,
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
  /** Desabilita o controle — use junto de `about` dizendo o que falta. */
  disabled?: boolean;
  /**
   * Explicação na bolinha ao lado do rótulo (hover, clique e teclado). É o
   * lugar de "por que este campo está assim" — a dica de preenchimento, que a
   * pessoa precisa ler antes de digitar, continua sendo `hint` e fica visível.
   */
  about?: React.ReactNode;
  error?: string | null;
  className?: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <LabeledField
      label={label}
      htmlFor={id}
      optional={optional}
      about={about}
      error={error}
      labelId={labelId}
      className={className}
    >
      <SelectMenu
        name={name}
        label={label}
        // O rótulo visível é quem nomeia o controle; repetir o texto em
        // `aria-label` faria o leitor de tela ignorar o que está na tela.
        labelledBy={labelId}
        icon={icon}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={onChange}
        options={options.map((o) => ({ value: o.value, label: o.label }))}
      />
    </LabeledField>
  );
}
