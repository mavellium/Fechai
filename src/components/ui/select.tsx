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
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: "default" | "sm" }
>(({ className, size = "default", children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      fieldBase,
      "ui-select appearance-none pr-9",
      size === "sm" ? "h-8 py-1 text-xs" : "h-10",
      // no painel escuro o menu aberto é desenhado pelo SO: sem isto as
      // opções saem em texto branco sobre fundo branco em alguns navegadores
      "panel:[&>option]:bg-ink panel:[&>option]:text-white",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
