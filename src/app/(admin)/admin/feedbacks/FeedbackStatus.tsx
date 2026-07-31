"use client";

import { useState, useTransition } from "react";
import type { FeedbackStatus } from "@/modules/feedback/service";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { markFeedback } from "../../actions";

const OPTIONS: { value: FeedbackStatus; label: string }[] = [
  { value: "new", label: "Novo" },
  { value: "read", label: "Lido" },
  { value: "resolved", label: "Resolvido" },
];

export function FeedbackStatusControl({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  // Otimista: o triagem é de um clique e o revalidate confirma logo depois.
  const [value, setValue] = useState(status as FeedbackStatus);

  return (
    <SegmentedControl
      label="Situação deste feedback"
      value={value}
      options={OPTIONS}
      loading={pending}
      onSelect={(next) => {
        setValue(next);
        start(() => markFeedback(id, next));
      }}
    />
  );
}
