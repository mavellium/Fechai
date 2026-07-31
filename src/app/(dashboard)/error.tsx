"use client";

import { PanelError } from "@/components/shell/PanelError";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PanelError error={error} reset={reset} />;
}
