/**
 * A reação que pausa o agente é um comando do atendente: ela precisa ser uma
 * reação enviada pelo próprio número conectado (`fromMe`) e a opção do agente
 * precisa estar ligada. Reações do cliente são apenas feedback e não mudam o
 * estado da conversa.
 */
export function shouldPauseAgentForReaction(input: {
  isReaction?: boolean;
  isFromMe?: boolean;
  stopOnEmoji?: boolean;
}): boolean {
  return Boolean(input.isReaction && input.isFromMe && input.stopOnEmoji);
}
