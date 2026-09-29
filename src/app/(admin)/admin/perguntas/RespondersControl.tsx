"use client";

import { useState, useTransition } from "react";
import { GAP_RESPONDERS, type GapResponders } from "@/modules/knowledge-gaps/settings";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { adminSetGapResponders } from "./actions";

/** Quem responde a fila da conta. Otimista, como o status dos feedbacks; volta se o servidor recusar. */
export function RespondersControl({ tenantId, tenantName, value }: { tenantId: string; tenantName: string; value: GapResponders }) {
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState(value);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <SegmentedControl
        label={`Quem responde a fila de ${tenantName}`}
        value={current}
        options={GAP_RESPONDERS}
        loading={pending}
        onSelect={(next) => {
          const previous = current;
          setCurrent(next);
          setError(null);
          start(async () => {
            const res = await adminSetGapResponders(tenantId, next).catch(() => ({ ok: false, error: "Não foi possível salvar." }));
            if (!res.ok) {
              setCurrent(previous);
              setError(res.error ?? "Não foi possível salvar.");
            }
          });
        }}
      />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
