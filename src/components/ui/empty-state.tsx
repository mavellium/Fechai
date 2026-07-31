import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Estado vazio padrão. `action` é obrigatório no espírito da regra: um vazio
 * sem próximo passo é um beco sem saída (skill design-ui, §5.4). Quando não há
 * ação possível, passe um texto explicando por quê.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {Icon && (
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-ink/5 text-neutral panel:bg-white/5 panel:text-white/50">
          <Icon size={20} aria-hidden />
        </span>
      )}
      <p className="font-display text-base font-semibold text-ink panel:text-white">{title}</p>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-neutral panel:text-white/60">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
