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

      {/* `min-h-0` nos dois: sem isso, a altura mínima "auto" de um item flex
          (o próprio conteúdo) vence o `flex-1`, e este bloco cresce pra caber
          tudo em vez de ficar preso na altura da tela — daí o `main` nunca
          precisa rolar e as áreas internas com scroll próprio (ex.: o chat de
          /conversas) nunca ganham uma altura travada pra rolar dentro dela. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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

        <main
          id="conteudo"
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-4 md:p-8"
        >
          <div
            aria-hidden
            className={`pointer-events-none absolute -right-40 -top-40 h-[360px] w-[360px] rounded-full blur-[120px] ${
              accent === "signal" ? "bg-signal/10" : "bg-iris/10"
            }`}
          />
          {/*
            `flex-1`, não `min-h-full`: `min-height` é só um piso, não dá altura
            definida — e sem altura definida, o filho de baixo (`flex-1` do
            `min-h-0` da página) não tem "espaço disponível" real pra calcular,
            e cai no tamanho do conteúdo (por isso o `main` ficava rolando o
            pacote inteiro em vez de só a área interna, ex.: /conversas). Com
            `main` agora `flex flex-col` e este filho em `flex-1`, ele recebe a
            altura exata que sobra do cabeçalho — telas normais (conteúdo mais
            curto) só ganham espaço vazio embaixo, sem quebrar nada.
          */}
          <div className="relative flex flex-1 flex-col">{children}</div>
        </main>
      </div>
    </div>
  );
}
