"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Power, Star, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { InfoHint } from "@/components/ui/info-hint";
import { deleteAgent, renameAgent, setAgentEnabled, setPrimaryAgent } from "../actions";

/** Nome do agente (edição no lugar) + gestão: liga/desliga, principal e exclusão. */
export function AgentHeader({
  agent,
  canDelete,
}: {
  agent: { id: string; name: string; isPrimary: boolean; enabled: boolean };
  canDelete: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [enabled, setEnabled] = useState(agent.enabled);
  const [togglingPower, setTogglingPower] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function togglePower(next: boolean) {
    setError(null);
    setTogglingPower(true);
    startTransition(async () => {
      const res = await setAgentEnabled(agent.id, next);
      if (res.ok) setEnabled(next);
      else setError(res.error ?? "Não foi possível mudar o estado do agente.");
      setTogglingPower(false);
      router.refresh();
    });
  }

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
            {!enabled && <Badge tone="danger">desligado</Badge>}
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

      {/* Chave geral, acima de tudo que se configura: é a primeira coisa que
          alguém procura quando o agente respondeu algo que não devia. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-4 rounded-surface border p-4 transition-colors ${
          enabled ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"
        }`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              enabled ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
            }`}
          >
            <Power size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-white">
              {enabled ? "Agente ligado — respondendo" : "Agente desligado — em silêncio"}
            </p>
            {/*
              Encurtado para uma linha. Fica como texto (não como bolinha)
              porque é o `describedBy` do Switch ao lado: a explicação do que
              a chave faz precisa ser lida junto do controle, e um leitor de
              tela não abre balão. O detalhe longo foi para a bolinha.
            */}
            <p id="agente-power-desc" className="mt-0.5 flex items-center gap-1.5 text-sm text-white/65">
              {enabled ? "Responde em todos os canais." : "Não responde em nenhum canal."}
              <InfoHint label="chave do agente">
                {enabled
                  ? "Ele responde no WhatsApp, no chat do site e no teste. Desligue para calar o agente sem perder nada do que você configurou."
                  : "As mensagens recebidas continuam chegando em Conversas, marcadas como “precisa de você”."}
              </InfoHint>
            </p>
          </div>
        </div>

        <Switch
          checked={enabled}
          onCheckedChange={togglePower}
          loading={togglingPower}
          disabled={pending}
          label={`Agente ${enabled ? "ligado" : "desligado"}`}
          describedBy="agente-power-desc"
        />
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
