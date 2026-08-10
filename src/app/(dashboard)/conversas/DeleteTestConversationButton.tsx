"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { deleteTestConversation } from "./actions";

/**
 * Exclui um chat de teste em definitivo. Usado na aba "Testes" (cada item) e
 * no cabeçalho de uma conversa de teste aberta — sem isso os testes do sandbox
 * se acumulavam para sempre, já que "recomeçar" arquiva em vez de apagar.
 */
export function DeleteTestConversationButton({
  conversationId,
  iconOnly = false,
}: {
  conversationId: string;
  /** Sem rótulo: só o ícone, para caber na linha da lista. */
  iconOnly?: boolean;
}) {
  const router = useRouter();

  return (
    <ConfirmButton
      variant={iconOnly ? "ghost" : "destructive"}
      size={iconOnly ? "icon" : "sm"}
      confirm={{
        title: "Excluir este teste?",
        description:
          "A conversa de teste e as mensagens dela serão apagadas para sempre. Isso não pode ser desfeito.",
        confirmLabel: "Excluir",
        tone: "danger",
      }}
      onConfirm={async () => {
        await deleteTestConversation(conversationId);
        router.refresh();
      }}
    >
      <Trash2 size={14} aria-hidden />
      {!iconOnly && <span>Excluir teste</span>}
    </ConfirmButton>
  );
}
