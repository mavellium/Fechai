import { requireGuest } from "@/lib/session";

/**
 * Telas que só fazem sentido para quem NÃO está logado: login, cadastro e o
 * pedido de redefinição.
 *
 * O guard vive aqui, e não no layout de (auth), porque `/redefinir-senha` é
 * irmã destas e precisa do comportamento oposto: o link chega por e-mail e
 * costuma ser aberto no navegador onde a pessoa já tem sessão aberta — com o
 * guard no layout de cima, clicar no link cairia calado no dashboard, sem
 * senha nenhuma redefinida.
 */
export default async function GuestLayout({ children }: { children: React.ReactNode }) {
  await requireGuest();
  return children;
}
