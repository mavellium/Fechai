"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Star, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { deleteAgent, renameAgent, setPrimaryAgent } from "../actions";

/** Nome do agente (edição no lugar) + gestão: principal do WhatsApp e exclusão. */
export function AgentHeader({
  agent,
  canDelete,
}: {
  agent: { id: string; name: string; isPrimary: boolean };
  canDelete: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await renameAgent(agent.id, name);
      if (!res.ok) {
        setError(res.error ?? "Falha ao renomear");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoFocus
              aria-label="Nome do agente"
              className="max-w-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") {
                  setName(agent.name);
                  setEditing(false);
                }
              }}
            />
            <Button size="icon" aria-label="Salvar nome" onClick={save} loading={pending}>
              <Check size={16} aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Cancelar edição"
              onClick={() => {
                setName(agent.name);
                setEditing(false);
                setError(null);
              }}
            >
              <X size={16} aria-hidden />
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="font-display truncate text-3xl font-bold text-white">{agent.name}</h1>
            {agent.isPrimary && <Badge tone="iris">atende o whatsapp</Badge>}
            <Button
              size="icon"
              variant="ghost"
              aria-label="Renomear agente"
              onClick={() => setEditing(true)}
            >
              <Pencil size={15} aria-hidden />
            </Button>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2">
          {!agent.isPrimary && (
            <Button
              variant="outline"
              size="sm"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  await setPrimaryAgent(agent.id);
                  router.refresh();
                })
              }
            >
              <Star size={14} aria-hidden />
              Usar no WhatsApp
            </Button>
          )}
          {canDelete && (
            <ConfirmButton
              size="sm"
              aria-label={`Excluir ${agent.name}`}
              confirm={{
                title: `Excluir ${agent.name}?`,
                description:
                  "A persona, a base de conhecimento e as ações deste agente serão apagadas. As conversas que ele já atendeu continuam no histórico.",
                confirmLabel: "Excluir agente",
                tone: "danger",
              }}
              onConfirm={async () => {
                const res = await deleteAgent(agent.id);
                if (res.ok) router.push("/agentes");
                else setError(res.error ?? "Falha ao excluir");
              }}
            >
              <Trash2 size={14} aria-hidden />
              Excluir
            </ConfirmButton>
          )}
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
