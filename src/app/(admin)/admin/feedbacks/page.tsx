import { MessageSquareHeart, Star } from "lucide-react";
import { requireSuperadmin } from "@/lib/session";
import { listFeedbacks } from "@/modules/feedback/service";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { FeedbackStatusControl } from "./FeedbackStatus";

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "new", label: "Novos" },
  { key: "read", label: "Lidos" },
  { key: "resolved", label: "Resolvidos" },
];

export default async function FeedbacksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireSuperadmin();
  const { status = "all" } = await searchParams;
  const feedbacks = await listFeedbacks(status !== "all" ? { status } : undefined);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="admin"
        title="Feedbacks"
        description="O que os clientes escreveram pela tela de Configurações."
      />

      <FilterTabs
        label="Filtrar feedbacks por situação"
        options={FILTERS}
        active={status}
        href={(key) => `/admin/feedbacks?status=${key}`}
      />

      {feedbacks.length === 0 ? (
        <Card>
          <EmptyState
            icon={MessageSquareHeart}
            title={status === "all" ? "Nenhum feedback ainda" : "Nada nesta situação"}
            description={
              status === "all"
                ? "Assim que um cliente enviar uma opinião pela tela de Configurações, ela aparece aqui."
                : "Nenhum feedback está nesta situação agora. Veja todos para não perder nada."
            }
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {feedbacks.map((f) => (
            <li key={f.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-white">{f.tenant.name}</span>
                      {f.rating && (
                        <span className="flex items-center gap-1 text-xs text-warn">
                          <Star size={11} className="fill-warn text-warn" aria-hidden />
                          {f.rating}
                          <span className="sr-only">
                            de 5 {f.rating === 1 ? "estrela" : "estrelas"}
                          </span>
                        </span>
                      )}
                      <span className="font-mono text-micro uppercase tracking-wide text-white/55">
                        {f.createdAt.toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-white/75">{f.message}</p>
                  </div>
                  <FeedbackStatusControl id={f.id} status={f.status} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
