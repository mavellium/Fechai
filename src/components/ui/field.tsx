import { cn } from "@/lib/utils";

/**
 * Campo de formulário do produto: label sempre visível, dica opcional acima do
 * controle e erro em texto junto do campo (skill design-ui, seção 5).
 *
 * Antes existiam três implementações disso — `LabeledField` em (auth), `Field`
 * no onboarding e `<label className="...">` solto no painel (sem `htmlFor`, ou
 * seja, sem associação com o input). Esta é a única.
 *
 * Server-safe de propósito (nenhum hook): o `id` vem de quem chama, via `useId()`
 * em componentes client ou de uma string estável em Server Components.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: string;
  /** Precisa bater com o `id` do controle — use `fieldProps()` para garantir. */
  htmlFor: string;
  hint?: string;
  error?: string | null;
  /** Marca o campo como opcional em texto (não só visualmente). */
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-ink panel:text-white/85"
      >
        {label}
        {optional && (
          <span className="ml-2 font-normal text-neutral panel:text-white/50">(opcional)</span>
        )}
      </label>

      {hint && (
        <p id={`${htmlFor}-hint`} className="mt-1 text-sm text-neutral panel:text-white/55">
          {hint}
        </p>
      )}

      <div className="mt-2">{children}</div>

      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Props de acessibilidade do controle dentro de um `<Field>`: liga o input à
 * dica e ao erro e marca `aria-invalid`. Sempre espalhe no controle:
 *
 * ```tsx
 * <Field label="E-mail" htmlFor={id} hint="..." error={error}>
 *   <Input {...fieldProps(id, { hint: true, error })} name="email" />
 * </Field>
 * ```
 *
 * `hint` aqui é só um "o Field tem dica?" — o texto em si fica no `<Field>`.
 */
export function fieldProps(
  id: string,
  { hint, error }: { hint?: boolean; error?: string | null } = {},
) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  return {
    id,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": describedBy || undefined,
  };
}

/** Alias mantido para as telas de (auth), que já usavam este nome. */
export { Field as LabeledField };

/** Agrupa campos relacionados com um título — usado nos formulários maiores. */
export function Fieldset({
  legend,
  hint,
  className,
  children,
}: {
  legend: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="text-sm font-medium text-ink panel:text-white/85">{legend}</legend>
      {hint && <p className="mt-1 text-sm text-neutral panel:text-white/55">{hint}</p>}
      <div className="mt-2">{children}</div>
    </fieldset>
  );
}
