/**
 * Acima disto, o trecho mais próximo da base é considerado sem relação com a
 * mensagem. É só um AVISO ao modelo (a regra vale com ou sem ele): as
 * distâncias variam com o modelo de embedding, e o valor foi escolhido para
 * o da OpenAI — no Gemini, mais "próximo" em tudo, ele quase nunca dispara.
 */
export const LOW_CONFIDENCE_DISTANCE = 0.6;

export type Retrieved = {
  text: string;
  /** A busca rodou (há embeddings). Sem isso, não há o que dizer sobre confiança. */
  searched: boolean;
  /** Distância do trecho mais próximo; null = a base não tem trecho nenhum. */
  closest: number | null;
};

/**
 * Regra dura das perguntas sem resposta (P-87): o agente nunca inventa. A
 * pergunta que ele não sabe vai para a fila da equipe (`report_unanswered`),
 * que responde e ensina a base — e é assim que ele passa a saber.
 *
 * Vai em todo turno com agente, não só quando a busca vem fraca: um trecho
 * "próximo" sobre implante não responde preço de implante, e é exatamente aí
 * que o modelo completa com o preço médio do mercado.
 */
export function unansweredRule(retrieved: Retrieved | null): string {
  const lowConfidence =
    retrieved?.searched && (retrieved.closest === null || retrieved.closest > LOW_CONFIDENCE_DISTANCE)
      ? "\nNenhum trecho da base de conhecimento corresponde bem à última mensagem do contato. Se ela pede uma informação do negócio que não está nas instruções, você não tem essa resposta: siga esta regra."
      : "";
  return (
    "<regra_sem_resposta>\n" +
    "Nunca invente informação sobre o negócio. Preço, procedimento, convênio, prazo, política, endereço, horário e se um serviço existe só podem ser afirmados se estiverem escritos nas instruções acima, na base de conhecimento ou no resultado de uma ferramenta. " +
    "Não complete com conhecimento geral nem com o que é comum em outros lugares. " +
    "Quando a resposta não estiver lá — ou os trechos responderem só em parte —, chame report_unanswered com a pergunta e diga ao contato que vai confirmar com a equipe e retorna assim que tiver a resposta." +
    lowConfidence +
    "\n</regra_sem_resposta>"
  );
}
