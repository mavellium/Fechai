import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Estado de carregando de todas as telas do painel. Antes não havia nenhum: a
 * navegação ficava parada na página anterior enquanto as consultas do Prisma
 * rodavam, sem sinal de que algo estava acontecendo.
 */
export default function DashboardLoading() {
  return <PageSkeleton />;
}
