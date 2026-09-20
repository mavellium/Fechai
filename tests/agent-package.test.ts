import { describe, expect, it } from "vitest";
import {
  AGENT_PACKAGE_FORMAT,
  AGENT_PACKAGE_VERSION,
  parseAgentPackage,
  safeAgentFilename,
} from "@/modules/agent-engine/agent-package";

const validPackage = {
  format: AGENT_PACKAGE_FORMAT,
  version: AGENT_PACKAGE_VERSION,
  exportedAt: "2026-09-20T12:00:00.000Z",
  source: { tenantName: "Clínica Aurora" },
  agent: {
    name: "Recepção",
    systemPrompt: "Atenda com clareza.",
    objective: "Agendar",
    personaDraft: { tone: "acolhedor" },
    listenAudio: true,
    stopOnEmoji: true,
    speakReplies: false,
    voiceStyle: "neutra",
    speechBlocklist: "",
    catalogVoiceKey: null,
  },
  actions: [
    {
      key: "schedule_meeting",
      enabled: true,
      config: { durationMinutes: 30, workdays: [1, 2, 3, 4, 5] },
    },
  ],
  knowledge: [{ title: "Horários", content: "Segunda a sexta, das 8h às 18h." }],
};

describe("pacote portátil do agente", () => {
  it("aceita um pacote completo e preserva configurações e Cérebro", () => {
    const result = parseAgentPackage(validPackage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.actions[0].config).toMatchObject({ durationMinutes: 30 });
    expect(result.data.knowledge[0].content).toContain("8h às 18h");
  });

  it("recusa JSON comum e versão incompatível", () => {
    expect(parseAgentPackage({ name: "não é pacote" }).ok).toBe(false);
    const incompatible = parseAgentPackage({ ...validPackage, version: 2 });
    expect(incompatible).toEqual({
      ok: false,
      error: "Este arquivo usa uma versão de agente que ainda não é compatível.",
    });
  });

  it("gera nome de download sem caracteres perigosos", () => {
    expect(safeAgentFilename('Recepção / Vendas: "Centro"')).toBe(
      "Recepcao-Vendas-Centro.fechai-agent.json",
    );
  });
});
