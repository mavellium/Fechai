import { requireBroadcastAccess } from "@/modules/broadcasts/access";

export default async function DisparosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireBroadcastAccess();
  return children;
}
