import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldBase } from "./input";

/**
 * `<select>` nativo com a mesma casca dos outros campos.
 *
 * Nativo de propósito: entrega teclado, busca por digitação e o seletor do
 * sistema no mobile de graça — nada disso viria de graça num dropdown custom.
 * Antes havia três selects estilizados à mão (admin/contas, admin/feedbacks e
 * NewAccountForm), cada um com um tamanho e um foco diferente.
 *
 * A seta vem da classe `.ui-select` (globals.css) como background-image, não de
 * um ícone irmão num wrapper — ver o comentário lá para o porquê.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  // `size` nativo do <select> é o número de linhas visíveis — não se aplica a
  // um select estilizado, então o nome fica livre para a escala visual.
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
    size?: "default" | "sm";
    /**
     * Ícone decorativo à esquerda (um componente do lucide). Só afeta o visual:
     * o controle continua sendo o `<select>` nativo, e o ícone é `aria-hidden`
     * porque a informação já está no `<label>` do `<Field>`.
     */
    icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  }
>(({ className, size = "default", icon: Icon, children, ...props }, ref) => {
  const select = (
    <select
      ref={ref}
      className={cn(
        fieldBase,
        "ui-select appearance-none pr-9",
        size === "sm" ? "h-8 py-1 text-xs" : "h-10",
        // abre espaço para o ícone à esquerda, quando houver
        Icon && (size === "sm" ? "pl-8" : "pl-10"),
        // a opção-placeholder fica cinza enquanto nada foi escolhido, como um
        // `placeholder:` de input — sem isso ela parece um valor já preenchido
        "[&:invalid]:text-neutral panel:[&:invalid]:text-white/50",
        // no painel escuro o menu aberto é desenhado pelo SO: sem isto as
        // opções saem em texto branco sobre fundo branco em alguns navegadores
        "panel:[&>option]:bg-ink panel:[&>option]:text-white",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );

  if (!Icon) return select;

  return (
    <div className="relative">
      <Icon
        size={size === "sm" ? 14 : 16}
        className={cn(
          "pointer-events-none absolute inset-y-0 my-auto text-neutral panel:text-white/50",
          size === "sm" ? "left-2.5" : "left-3",
        )}
        aria-hidden
      />
      {select}
    </div>
  );
});
Select.displayName = "Select";
