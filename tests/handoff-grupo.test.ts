import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * Testes da regra "transferiu para humano → entra no grupo do WhatsApp".
 *
 * O que está protegido aqui não é a chamada à Evolution, e sim as condições que
 * decidem se ela acontece. Cada uma existe por um estrago concreto:
 *
 * - ação desligada ainda adicionando gente ao grupo é a tela mentindo;
 * - conversa de teste no grupo real polui o grupo da equipe com um telefone
 *   sintético do sandbox;
 * - uma exceção escapando derruba o webhook, e a Evolution reentrega a mesma
 *   mensagem em laço — a transferência já aconteceu, o grupo é o extra.
 */

const db = vi.hoisted(() => ({
  tenantAction: { findUnique: vi.fn(), upsert: vi.fn() },
  whatsappInstance: { findUnique: vi.fn() },
}));
const provider = vi.hoisted(() => ({ addParticipantToGroup: vi.fn(async () => {}) }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/whatsapp", () => ({ getWhatsAppProvider: () => provider }));

import {
  addLeadToHandoffGroup,
  describeHandoff,
  normalizeGroupId,
  parseHandoffConfig,
} from "@/modules/agent-engine/handoff";

const TENANT = "tenant-1";
const AGENTE = "agente-1";
const GRUPO = "120363012345678901@g.us";
const TELEFONE = "5511999990000";

/** Ação de transferência do agente, ligada e com grupo, salvo indicação contrária. */
function acaoConfigurada(over: { enabled?: boolean; addToGroup?: boolean; groupId?: string } = {}) {
  db.tenantAction.findUnique.mockResolvedValue({
    enabled: over.enabled ?? true,
    config: {
      addToGroup: over.addToGroup ?? true,
      groupId: over.groupId ?? GRUPO,
    },
  });
}

/** Número da conta conectado na Evolution. */
function whatsappConectado() {
  db.whatsappInstance.findUnique.mockResolvedValue({
    externalId: "tenant_tenant-1",
    status: "connected",
  });
}

describe("ID do grupo (normalizeGroupId)", () => {
  it("aceita o JID completo como está", () => {
    expect(normalizeGroupId(GRUPO)).toBe(GRUPO);
  });

  it("completa o sufixo quando a pessoa cola só os dígitos", () => {
    expect(normalizeGroupId("120363012345678901")).toBe(GRUPO);
  });

  it("ignora espaços em volta (colar do WhatsApp costuma trazer)", () => {
    expect(normalizeGroupId(`  ${GRUPO}  `)).toBe(GRUPO);
  });

  it("recusa um telefone de pessoa, que não é grupo", () => {
    expect(normalizeGroupId("5511999990000@s.whatsapp.net")).toBeNull();
  });

  it("recusa texto qualquer e vazio", () => {
    expect(normalizeGroupId("grupo do atendimento")).toBeNull();
    expect(normalizeGroupId("")).toBeNull();
  });
});

describe("Leitura da config (parseHandoffConfig)", () => {
  it("nasce desligada quando a ação nunca foi configurada", () => {
    expect(parseHandoffConfig(null)).toEqual({ addToGroup: false, groupId: null });
  });

  it("não deixa ficar ligada sem grupo — um toggle ligado que não faz nada faz a tela mentir", () => {
    expect(parseHandoffConfig({ addToGroup: true, groupId: "" }).addToGroup).toBe(false);
  });

  it("descarta um grupo inválido salvo à mão no banco", () => {
    const cfg = parseHandoffConfig({ addToGroup: true, groupId: "não é grupo" });
    expect(cfg).toEqual({ addToGroup: false, groupId: null });
  });

  it("resume no card o que está valendo", () => {
    expect(describeHandoff({ addToGroup: true, groupId: GRUPO })).toContain("grupo");
    expect(describeHandoff({ addToGroup: false, groupId: null })).toContain("precisa de você");
  });
});

/**
 * O schema do formulário, reproduzido aqui (a action importa `requireTenant` e
 * meio mundo de server-only). O que importa proteger é a REGRA, e ela é a
 * mesma: recusar antes de normalizar, para um ID inválido virar erro na tela em
 * vez de "salvo" com a opção silenciosamente desligada.
 */
const schema = z
  .object({
    addToGroup: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    groupId: z.string().trim().optional().default(""),
  })
  .superRefine((data, ctx) => {
    if (data.addToGroup && !normalizeGroupId(data.groupId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["groupId"], message: "ID inválido" });
    }
  })
  .transform((data) => {
    const groupId = data.addToGroup ? normalizeGroupId(data.groupId) : null;
    return { addToGroup: data.addToGroup && Boolean(groupId), groupId };
  });

describe("Envio do formulário de transferência", () => {
  it("aceita ligado com grupo válido", () => {
    const r = schema.safeParse({ addToGroup: "on", groupId: GRUPO });
    expect(r.success && r.data).toEqual({ addToGroup: true, groupId: GRUPO });
  });

  it("RECUSA ligado com grupo inválido, em vez de salvar desligado calado", () => {
    expect(schema.safeParse({ addToGroup: "on", groupId: "grupo errado" }).success).toBe(false);
    expect(schema.safeParse({ addToGroup: "on", groupId: "" }).success).toBe(false);
  });

  it("desligado guarda o estado sem exigir grupo", () => {
    const r = schema.safeParse({ addToGroup: "", groupId: GRUPO });
    expect(r.success && r.data).toEqual({ addToGroup: false, groupId: null });
  });

  it("trata como desligado o que não é 'on' — 'false' não pode virar ligado", () => {
    expect(schema.safeParse({ addToGroup: "false", groupId: "" }).success).toBe(true);
    expect(schema.safeParse({ addToGroup: "off", groupId: "" }).success).toBe(true);
  });
});

describe("Adicionar o contato ao grupo (addLeadToHandoffGroup)", () => {
  beforeEach(() => {
    whatsappConectado();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adiciona quando a ação está ligada e configurada", async () => {
    acaoConfigurada();
    await addLeadToHandoffGroup(TENANT, AGENTE, TELEFONE);
    expect(provider.addParticipantToGroup).toHaveBeenCalledWith(
      "tenant_tenant-1",
      GRUPO,
      TELEFONE,
    );
  });

  it("NÃO adiciona com a ação desligada, mesmo com grupo cadastrado", async () => {
    acaoConfigurada({ enabled: false });
    await addLeadToHandoffGroup(TENANT, AGENTE, TELEFONE);
    expect(provider.addParticipantToGroup).not.toHaveBeenCalled();
  });

  it("NÃO adiciona quando a opção de grupo está desligada na config", async () => {
    acaoConfigurada({ addToGroup: false });
    await addLeadToHandoffGroup(TENANT, AGENTE, TELEFONE);
    expect(provider.addParticipantToGroup).not.toHaveBeenCalled();
  });

  it("NÃO adiciona conversa de teste: o telefone do sandbox não vai para o grupo da equipe", async () => {
    acaoConfigurada();
    await addLeadToHandoffGroup(TENANT, AGENTE, TELEFONE, { isTest: true });
    expect(provider.addParticipantToGroup).not.toHaveBeenCalled();
    // Nem chega a consultar a config: teste não é atendimento.
    expect(db.tenantAction.findUnique).not.toHaveBeenCalled();
  });

  it("NÃO adiciona sem agente resolvido", async () => {
    await addLeadToHandoffGroup(TENANT, null, TELEFONE);
    expect(provider.addParticipantToGroup).not.toHaveBeenCalled();
  });

  it("NÃO adiciona com o WhatsApp desconectado — não há de onde convidar", async () => {
    acaoConfigurada();
    db.whatsappInstance.findUnique.mockResolvedValue({
      externalId: "tenant_tenant-1",
      status: "disconnected",
    });
    await addLeadToHandoffGroup(TENANT, AGENTE, TELEFONE);
    expect(provider.addParticipantToGroup).not.toHaveBeenCalled();
  });

  it("engole a falha da Evolution: a transferência não pode cair junto", async () => {
    acaoConfigurada();
    provider.addParticipantToGroup.mockRejectedValueOnce(new Error("Evolution fora do ar"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(addLeadToHandoffGroup(TENANT, AGENTE, TELEFONE)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("engole falha do BANCO também — no webhook, lançar viraria 500 e reentrega em laço", async () => {
    db.tenantAction.findUnique.mockRejectedValueOnce(new Error("banco indisponível"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(addLeadToHandoffGroup(TENANT, AGENTE, TELEFONE)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
