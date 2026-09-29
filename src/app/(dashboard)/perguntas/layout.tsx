import { requireProductAccess } from "@/lib/require-product";

/** Porteira do produto: a fila é do agente, quem só afilia não tem. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireProductAccess();
  return <>{children}</>;
}
