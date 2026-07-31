"use client";

import { PanelError } from "@/components/shell/PanelError";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PanelError error={error} reset={reset} supportHref="/admin/contas" />;
}
