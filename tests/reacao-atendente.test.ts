import { describe, expect, it } from "vitest";
import { shouldPauseAgentForReaction } from "@/modules/whatsapp/reactions";

describe("reação para o atendente assumir a conversa", () => {
  it("pausa quando o atendente reage e a opção está ligada", () => {
    expect(
      shouldPauseAgentForReaction({
        isReaction: true,
        isFromMe: true,
        stopOnEmoji: true,
      }),
    ).toBe(true);
  });

  it("não pausa quando a reação é do cliente", () => {
    expect(
      shouldPauseAgentForReaction({
        isReaction: true,
        isFromMe: false,
        stopOnEmoji: true,
      }),
    ).toBe(false);
  });

  it("respeita a opção desligada para a reação do atendente", () => {
    expect(
      shouldPauseAgentForReaction({
        isReaction: true,
        isFromMe: true,
        stopOnEmoji: false,
      }),
    ).toBe(false);
  });

  it("não confunde mensagem comum do atendente com reação", () => {
    expect(
      shouldPauseAgentForReaction({
        isReaction: false,
        isFromMe: true,
        stopOnEmoji: true,
      }),
    ).toBe(false);
  });
});
