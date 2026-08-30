import { Search, Building2 } from "lucide-react";
import { requireSuperadmin } from "@/lib/session";
import { listTenants } from "@/modules/admin/service";
import { planOf } from "@/modules/billing/plans";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { TenantRow } from "./TenantRow";
import { NewAccountForm } from "./NewAccountForm";

const COLUMNS = ["Tenant", "Plano", "Limite", "WhatsApp", "Status", "Ação"];

export default async function ContasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSuperadmin();
  const { q } = await searchParams;
  const tenants = await listTenants(q);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="admin"
        title="Contas"
        actions={
          <span className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
            {tenants.length} tenant{tenants.length === 1 ? "" : "s"}
          </span>
        }
      />

      <NewAccountForm />

      {/* A busca era um <input> sem <label> e sem botão: só funcionava para
          quem adivinhasse que tinha de apertar Enter. */}
      <form method="get" className="flex items-end gap-2">
        <Field label="Buscar conta" htmlFor="busca-tenant" className="w-full max-w-xs">
          <Input
            {...fieldProps("busca-tenant")}
            name="q"
            type="search"
            defaultValue={q ?? ""}
            placeholder="Nome do tenant"
          />
        </Field>
        <Button type="submit" variant="outline">
          <Search size={15} aria-hidden />
          Buscar
        </Button>
      </form>

      {tenants.length === 0 ? (
        <div className="rounded-surface border border-white/10 bg-white/5">
          <EmptyState
            icon={Building2}
            title={q ? `Nenhuma conta com “${q}”` : "Nenhuma conta ainda"}
            description={
              q
                ? "Confira a grafia ou limpe a busca para ver todas as contas."
                : "Crie a primeira conta em “Nova conta” — o tenant, o usuário e a configuração base saem prontos."
            }
          />
        </div>
      ) : (
        <div
          // região rolável precisa ser alcançável pelo teclado
          tabIndex={0}
          role="region"
          aria-label="Tabela de contas (rolagem horizontal)"
          className="overflow-x-auto rounded-surface border border-white/10 bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Contas da plataforma, com plano, status do WhatsApp e situação da conta.
            </caption>
            <thead className="font-mono text-micro uppercase tracking-[0.15em] text-white/55">
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className={`px-4 py-3 font-medium ${c === "Ação" ? "text-right" : ""}`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <TenantRow
                  key={t.id}
                  id={t.id}
                  name={t.name}
                  planKey={t.planKey}
                  status={t.status}
                  whatsappStatus={t.whatsappInstance?.status ?? "—"}
                  messageLimitOverride={t.messageLimitOverride}
                  trialEndsAt={t.trialEndsAt ? t.trialEndsAt.toISOString() : null}
                  planIsTrial={planOf(t.planKey).trialDays != null}
                  isAdminAccount={t.users.some((u) => u.role === "SUPERADMIN")}
                  ownerUserId={t.users.find((u) => u.role === "OWNER")?.id ?? t.users[0]?.id}
                  createdAt={t.createdAt.toLocaleDateString("pt-BR")}
                  counts={{
                    users: t._count.users,
                    leads: t._count.leads,
                    conversations: t._count.conversations,
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
