import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPackage } from "@/modules/agent-engine/agent-package";

const db = vi.hoisted(() => ({
  tenant: { findUnique: vi.fn() },
  agent: { create: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn() },
}));
const ingestDocument = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/knowledge-base/repository", () => ({ ingestDocument }));

import { createAgentFromPackage } from "@/modules/agent-engine/transfer";

const portable: AgentPackage = {
  format: "fechai-agent",
  version: 1,
  exportedAt: "2026-09-20T12:00:00.000Z",
  source: { tenantName: "Origem" },
  agent: {
    name: "Recepção",
    systemPrompt: "Atenda com clareza.",
    objective: "Agendar",
    personaDraft: { tone: "acolhedor" },
    variableDefinitions: [{ key: "convenio", description: "Convênio informado pelo contato" }],
    listenAudio: true,
    stopOnEmoji: true,
    speakReplies: true,
    voiceStyle: "neutra",
    voicePrompt: "Use frases curtas.",
    speechBlocklist: "",
    catalogVoiceKey: null,
  },
  actions: [
    { key: "schedule_meeting", enabled: true, config: { durationMinutes: 30 } },
    { key: "follow_up", enabled: true, config: { delayMinutes: 60 } },
    { key: "handoff_human", enabled: true, config: { addToGroup: false } },
  ],
  knowledge: [{ title: "Horários", content: "Segunda a sexta." }],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.tenant.findUnique.mockResolvedValue({ planKey: "FREE", _count: { agents: 0 } });
  db.agent.create.mockResolvedValue({ id: "copy-1", name: "Recepção" });
  db.agent.deleteMany.mockResolvedValue({ count: 1 });
  ingestDocument.mockResolvedValue({ id: "doc-1", status: "ready" });
});

describe("criação de agente por cópia/importação", () => {
  it("nasce desligado, não principal e respeita o limite de habilidades do plano", async () => {
    const result = await createAgentFromPackage({ tenantId: "destino", package: portable });

    expect(result.ok).toBe(true);
    const data = db.agent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ enabled: false, isPrimary: false, speakReplies: false });
    expect(data.voicePrompt).toBe("Use frases curtas.");
    expect(data.actions.create.filter((action: { enabled: boolean }) => action.enabled)).toHaveLength(2);
    expect(result).toMatchObject({
      warnings: expect.arrayContaining([
        expect.stringContaining("voz gravada"),
        expect.stringContaining("limite do plano"),
      ]),
    });
    expect(ingestDocument).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "destino", agentId: "copy-1", title: "Horários" }),
    );
  });

  it("recusa antes de gravar quando a empresa atingiu o limite de agentes", async () => {
    db.tenant.findUnique.mockResolvedValue({ planKey: "FREE", _count: { agents: 1 } });

    await expect(
      createAgentFromPackage({ tenantId: "destino", package: portable }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("limite") });
    expect(db.agent.create).not.toHaveBeenCalled();
  });

  it("remove a cópia incompleta se o Cérebro falhar", async () => {
    ingestDocument.mockRejectedValueOnce(new Error("banco indisponível"));

    await expect(
      createAgentFromPackage({ tenantId: "destino", package: portable }),
    ).resolves.toMatchObject({ ok: false });
    expect(db.agent.deleteMany).toHaveBeenCalledWith({
      where: { id: "copy-1", tenantId: "destino" },
    });
  });
});
