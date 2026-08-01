import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { PanelShell } from "@/components/shell/PanelShell";
import type { NavItem } from "@/components/shell/ShellNav";

const NAV: NavItem[] = [
  { href: "/inicio", label: "Início", icon: "Home" },
  { href: "/agentes", label: "Agentes", icon: "Bot" },
  { href: "/whatsapp", label: "WhatsApp", icon: "MessageCircle" },
  { href: "/contatos", label: "Contatos", icon: "Users" },
  { href: "/conversas", label: "Conversas", icon: "MessagesSquare" },
  { href: "/relatorios", label: "Relatórios", icon: "BarChart3" },
  { href: "/configuracoes", label: "Configurações", icon: "Settings" },
];

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOwner();
  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { status: true, name: true, planKey: true, onboardingCompleted: true },
  });

  // Conta suspensa: bloqueia o app e orienta a contatar o suporte.
  if (tenant?.status === "suspended") {
    return (
      <div data-surface="dark" className="flex min-h-screen items-center justify-center bg-ink px-4">
        <div className="max-w-md rounded-surface border border-danger/40 bg-white/5 p-8 text-center">
          <h1 className="font-display text-xl font-semibold text-white">Conta suspensa</h1>
          <p className="mt-2 text-sm text-white/65">
            Sua conta está temporariamente suspensa. Fale com o suporte para reativá-la.
          </p>
          <form action={signOutAction} className="mt-6">
            <Button variant="outline" size="sm" type="submit">
              Sair
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // Conta nova: passa pelo onboarding guiado antes de entrar no painel. Fica
  // depois da checagem de suspensão para a conta suspensa ver o aviso, não o
  // wizard. (/onboarding está fora deste grupo de rotas, então não há loop.)
  if (tenant && !tenant.onboardingCompleted) redirect("/onboarding");

  return (
    <PanelShell
      navItems={NAV}
      brandHref="/inicio"
      brandSubtitle={tenant?.name ?? "seu painel"}
      footerLabel={`plano · ${tenant?.planKey ?? "FREE"}`}
      userLabel={session.user.email ?? ""}
      signOutAction={signOutAction}
    >
      {children}
    </PanelShell>
  );
}
