import type { Metadata } from "next";
import { requireSuperadmin } from "@/lib/session";
import { signOut } from "@/auth";
import { PanelShell } from "@/components/shell/PanelShell";
import type { NavItem } from "@/components/shell/ShellNav";

const NAV: NavItem[] = [
  { href: "/admin/contas", label: "Contas", icon: "Building2" },
  { href: "/admin/ia", label: "IA", icon: "Cpu" },
  { href: "/admin/feedbacks", label: "Feedbacks", icon: "Star" },
];

/** Painel restrito: nunca indexar. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSuperadmin();

  return (
    <PanelShell
      navItems={NAV}
      brandHref="/admin/contas"
      brandSubtitle="painel do admin"
      footerLabel="acesso restrito"
      userLabel={`${session.user.email} · superadmin`}
      signOutAction={signOutAction}
      accent="signal"
    >
      {children}
    </PanelShell>
  );
}
