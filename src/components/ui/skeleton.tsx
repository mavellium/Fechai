import { cn } from "@/lib/utils";

/**
 * Bloco cinza pulsando para os `loading.tsx` das rotas. O painel é todo
 * server-rendered com consulta ao banco: sem isto a navegação fica alguns
 * instantes na tela anterior, sem sinal nenhum de que algo está acontecendo.
 *
 * `animate-pulse` do Tailwind já é desligado pelo bloco
 * `prefers-reduced-motion` do globals.css.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-control bg-ink/8 panel:bg-white/8", className)}
    />
  );
}

/** Casca de uma página do painel enquanto os dados chegam. */
export function PageSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="mx-auto max-w-3xl" role="status" aria-label="Carregando a página">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-9 w-64" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 space-y-6">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-surface" />
        ))}
      </div>
    </div>
  );
}
