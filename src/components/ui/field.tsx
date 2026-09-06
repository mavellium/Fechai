import { cn } from "@/lib/utils";
import { InfoHint } from "./info-hint";

/**
 * Campo de formulário do produto: label sempre visível, dica opcional acima do
 * controle e erro em texto junto do campo (skill design-ui, seção 5).
 *
 * Antes existiam três implementações disso — `LabeledField` em (auth), `Field`
 * no onboarding e `<label className="...">` solto no painel (sem `htmlFor`, ou
 * seja, sem associação com o input). Esta é a única.
 *
 * Renderizável a partir de um Server Component (nenhum hook aqui): o `id` vem
 * de quem chama, via `useId()` em componentes client ou de uma string estável
 * no servidor. O `about` traz um filho `"use client"` (`InfoHint`), o que é
 * válido — o servidor só o referencia, não o executa.
 */
export function Field({
  label,
  htmlFor,
  hint,
  about,
  error,
  optional,
  className,
  children,
}: {
  label: string;
  /** Precisa bater com o `id` do controle — use `fieldProps()` para garantir. */
  htmlFor: string;
  /**
   * Dica de preenchimento: unidade, formato, exemplo. Fica **visível** de
   * propósito — quem está digitando precisa dela antes de digitar, e um texto
   * que exige passar o mouse não existe para quem usa toque.
   */
  hint?: string;
  /**
   * Explicação de o que o campo faz no produto — contexto, não instrução. Vai
   * para a bolinha de dúvida ao lado do rótulo, fora do caminho de quem já sabe.
   */
  about?: React.ReactNode;
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
        className="flex items-center gap-1.5 text-sm font-medium text-ink panel:text-white/85"
      >
        {label}
        {optional && (
          <span className="font-normal text-neutral panel:text-white/50">(opcional)</span>
        )}
        {about && <InfoHint label={label}>{about}</InfoHint>}
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
