import { cn } from "@/lib/utils";

/**
 * Os 3 pontos da assinatura "digitando → check", em versão só-CSS.
 *
 * Existe separado do `TypingToCheck` porque este não usa hook nenhum: pode ser
 * renderizado dentro de Server Components (ex.: `<Button loading>`). A animação
 * é a mesma classe `.ttc-dot` do globals.css, então respeita
 * `prefers-reduced-motion` sem JS.
 */
export function LoadingDots({
  size = 4,
  className,
  label = "Carregando",
}: {
  size?: number;
  className?: string;
  /** Passe `null` quando o texto ao lado já anuncia o estado (evita leitura dupla). */
  label?: string | null;
}) {
  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={{ gap: size * 0.8 }}
      role={label ? "status" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="ttc-dot rounded-full bg-current"
          style={{ width: size, height: size, animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}
