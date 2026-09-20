"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Pencil, Power, Star, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { InfoHint } from "@/components/ui/info-hint";
import { deleteAgent, duplicateAgent, renameAgent, setAgentEnabled, setPrimaryAgent } from "../actions";
import { useUnsavedChanges, useUnsavedNavigation } from "@/components/ui/unsaved-changes";

/** Nome do agente (edição no lugar) + gestão: liga/desliga, principal e exclusão. */
export function AgentHeader({
  agent,
  canDelete,
  canDuplicate,
}: {
  agent: { id: string; name: string; isPrimary: boolean; enabled: boolean };
  canDelete: boolean;
  canDuplicate: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [savedName, setSavedName] = useState(agent.name);
  const [lastServerName, setLastServerName] = useState(agent.name);
  if (agent.name !== lastServerName) {
    setLastServerName(agent.name);
    setSavedName(agent.name);
    if (!editing) setName(agent.name);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  useUnsavedChanges(editing && name !== savedName, "Nome do agente", rootRef);
  const confirmNavigation = useUnsavedNavigation();
  const [enabled, setEnabled] = useState(agent.enabled);
  const [togglingPower, setTogglingPower] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
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
    if (pending) return;
    const submittedName = name.trim();
    setError(null);
    startTransition(async () => {
      const res = await renameAgent(agent.id, submittedName);
      if (!res.ok) {
        setError(res.error ?? "Falha ao renomear");
        return;
      }
      setSavedName(submittedName);
      setName(submittedName);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div ref={rootRef} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              value={name}
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoFocus
              aria-label="Nome do agente"
              className="max-w-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") {
                  confirmNavigation(() => { setName(savedName); setEditing(false); }, rootRef.current);
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
              disabled={pending}
              onClick={() => confirmNavigation(() => {
                setName(savedName);
                setEditing(false);
                setError(null);
              }, rootRef.current)}
            >
              <X size={16} aria-hidden />
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="font-display truncate text-3xl font-bold text-white">{savedName}</h1>
            {agent.isPrimary && <Badge tone="iris">atende o whatsapp</Badge>}
            {!enabled && <Badge tone="danger">desligado</Badge>}
            <Button
              size="icon"
              variant="ghost"
              aria-label="Renomear agente"
              onClick={() => { setName(savedName); setEditing(true); }}
            >
              <Pencil size={15} aria-hidden />
            </Button>
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <a
            href={`/api/agents/${agent.id}/export`}
            download
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Download size={14} aria-hidden />
            Exportar
          </a>
          <Button
            variant="outline"
            size="sm"
            loading={duplicating}
            loadingLabel="Duplicando agente"
            disabled={!canDuplicate || pending}
            title={canDuplicate ? undefined : "Limite de agentes do plano atingido"}
            onClick={() => {
              setError(null);
              setDuplicating(true);
              startTransition(async () => {
                const result = await duplicateAgent(agent.id);
                setDuplicating(false);
                if (result.ok && result.agentId) router.push(`/agentes/${result.agentId}`);
                else setError(result.error ?? "Não foi possível duplicar o agente.");
              });
            }}
          >
            <Copy size={14} aria-hidden />
            Duplicar
          </Button>
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
              {enabled ? "Responde aos clientes." : "Não responde aos clientes — só no teste."}
              <InfoHint label="chave do agente">
                {enabled
                  ? "Ele responde no WhatsApp e no chat do site. Desligue para calar o agente sem perder nada do que você configurou."
                  : "Ele continua respondendo no chat de teste, para você ajustar antes de religar. As mensagens de clientes chegam em Conversas, marcadas como “precisa de você”."}
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
