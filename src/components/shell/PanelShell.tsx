import { Button } from "@/components/ui/button";
import { type NavItem } from "./ShellNav";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";

/**
 * Casca comum do dashboard e do admin: barra lateral no desktop, gaveta no
 * celular, cabeçalho com identificação e saída.
 *
 * Os dois layouts eram cópias quase idênticas (~50 linhas cada) que já tinham
 * divergido em detalhes. `data-surface="dark"` é marcado aqui, uma vez: é o que
 * faz os primitivos de `ui/` assumirem a versão escura sem nenhum override por
 * tela.
 */
export function PanelShell({
  navItems,
  brandHref,
  brandSubtitle,
  footerLabel,
  userLabel,
  signOutAction,
  accent = "iris",
  children,
}: {
  navItems: NavItem[];
  brandHref: string;
  /** Linha sob o wordmark (nome do tenant, "painel do admin"). */
  brandSubtitle: string;
  /** Rodapé da barra lateral (plano atual, "acesso restrito"). */
  footerLabel: string;
  userLabel: string;
  signOutAction: () => Promise<void>;
  accent?: "iris" | "signal";
  children: React.ReactNode;
}) {
  return (
    // `h-screen` + `overflow-hidden` (em vez do `min-h-screen` antigo): a
    // sidebar é irmã do `main` no mesmo flex, então com `min-h-screen` ela
    // esticava para acompanhar a altura da PÁGINA inteira — em telas com
    // conteúdo comprido, o rodapé da sidebar (agora com o botão de
    // minimizar) ficava empurrado abaixo da dobra. Fixando a casca na altura
    // da viewport e deixando só o `main` rolar, a sidebar (e seu rodapé)
    // ficam sempre visíveis.
    <div data-surface="dark" className="flex h-screen overflow-hidden bg-ink">
      <a
        href="#conteudo"
        className="sr-only rounded-control bg-white px-4 py-2 text-sm font-medium text-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Pular para o conteúdo
      </a>

      <Sidebar
        navItems={navItems}
        brandHref={brandHref}
        brandSubtitle={brandSubtitle}
        footerLabel={footerLabel}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav items={navItems} title="fechai" subtitle={brandSubtitle} />
            <span className="truncate font-mono text-micro uppercase tracking-[0.15em] text-white/55">
              {userLabel}
            </span>
          </div>
          <form action={signOutAction}>
            <Button variant="outline" size="sm" type="submit">
              Sair
            </Button>
          </form>
        </header>

        <main id="conteudo" className="relative flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8">
          <div
            aria-hidden
            className={`pointer-events-none absolute -right-40 -top-40 h-[360px] w-[360px] rounded-full blur-[120px] ${
              accent === "signal" ? "bg-signal/10" : "bg-iris/10"
            }`}
          />
          {/*
            `flex min-h-full flex-col`: telas normais continuam com altura de
            conteúdo (um único filho em coluna se comporta como bloco), mas uma
            tela que precise ocupar a viewport inteira — /conversas, que é uma
            caixa de entrada com scroll por painel — só precisa pedir `flex-1`.
            Sem isso, `h-full` no filho não resolve: falta altura definida aqui.
          */}
          <div className="relative flex min-h-full flex-col">{children}</div>
        </main>
      </div>
    </div>
  );
}
