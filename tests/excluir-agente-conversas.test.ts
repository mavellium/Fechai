import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const tx = {
    conversation: { updateMany: vi.fn(async () => { calls.push("transferir"); return { count: 2 }; }) },
    agent: {
      update: vi.fn(async () => { calls.push("promover"); return {}; }),
      delete: vi.fn(async () => { calls.push("excluir"); return {}; }),
    },
  };
  return {
    calls,
    tx,
    agentCount: vi.fn(),
    replacement: vi.fn(),
    owned: vi.fn(),
    transaction: vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireTenant: vi.fn(async () => ({ tenantId: "tenant-1" })) }));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: vi.fn(() => null) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  agent: { count: mocks.agentCount, findFirst: mocks.replacement },
  $transaction: mocks.transaction,
} }));
vi.mock("@/modules/agent-engine/agents", () => ({ getAgentOwned: mocks.owned }));
vi.mock("@/modules/audit/log", () => ({ recordDeletion: vi.fn(async () => {}) }));

import { deleteAgent } from "@/app/(dashboard)/agentes/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.owned.mockResolvedValue({ id: "antigo", name: "Antigo", isPrimary: true });
  mocks.agentCount.mockResolvedValue(2);
  mocks.replacement.mockResolvedValue({ id: "ativo" });
});

it("transfere as conversas e promove o substituto antes de excluir o agente", async () => {
  const result = await deleteAgent("antigo");

  expect(result.ok).toBe(true);
  expect(mocks.replacement).toHaveBeenCalledWith(expect.objectContaining({
    where: { tenantId: "tenant-1", id: { not: "antigo" }, archived: false, enabled: true },
  }));
  expect(mocks.tx.conversation.updateMany).toHaveBeenCalledWith({
    where: { tenantId: "tenant-1", agentId: "antigo" },
    data: { agentId: "ativo" },
  });
  expect(mocks.calls).toEqual(["transferir", "promover", "excluir"]);
});

it("impede excluir quando nenhum outro agente pode atender", async () => {
  mocks.replacement.mockResolvedValue(null);

  const result = await deleteAgent("antigo");

  expect(result.ok).toBe(false);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
