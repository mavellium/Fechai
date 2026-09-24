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
const provider = vi.hoisted(() => ({
  addParticipantToGroup: vi.fn(async () => {}),
  isConfigured: vi.fn(() => true),
  listGroups: vi.fn(async (): Promise<{ id: string; name: string; size: number | null }[]> => []),
}));
// A conexão da Meta não tem `listGroups`: é assim que a tela sabe que grupo
// não existe ali.
const metaProvider = vi.hoisted(() => ({
  addParticipantToGroup: vi.fn(async () => {}),
  isConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/whatsapp", () => ({
  getWhatsAppProvider: (name: string) => (name === "meta" ? metaProvider : provider),
}));

import {
  addLeadToHandoffGroup,
  describeHandoff,
  handoffToolDescription,
  listWhatsAppGroups,
  MAX_GROUP_NAME,
  MAX_GROUP_REASON,
  normalizeGroupId,
  parseHandoffConfig,
  type HandoffConfig,
} from "@/modules/agent-engine/handoff";
import { getToolSchemas } from "@/modules/agent-engine/tools";
import { EvolutionProvider } from "@/modules/whatsapp/evolution";

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

/** Config completa, ligada ao grupo, salvo indicação contrária. */
function config(over: Partial<HandoffConfig> = {}): HandoffConfig {
  return { addToGroup: true, groupId: GRUPO, groupName: "Recepção", groupReason: "", ...over };
}

describe("Leitura da config (parseHandoffConfig)", () => {
  it("nasce desligada quando a ação nunca foi configurada", () => {
    expect(parseHandoffConfig(null)).toEqual({
      addToGroup: false,
      groupId: null,
      groupName: null,
      groupReason: "",
    });
  });

  it("lê config de antes do nome e do motivo existirem", () => {
    expect(parseHandoffConfig({ addToGroup: true, groupId: GRUPO })).toEqual({
      addToGroup: true,
      groupId: GRUPO,
      groupName: null,
      groupReason: "",
    });
  });

  it("não deixa ficar ligada sem grupo — um toggle ligado que não faz nada faz a tela mentir", () => {
    expect(parseHandoffConfig({ addToGroup: true, groupId: "" }).addToGroup).toBe(false);
  });

  it("descarta um grupo inválido salvo à mão no banco, e o nome junto", () => {
    const cfg = parseHandoffConfig({ addToGroup: true, groupId: "não é grupo", groupName: "Recepção" });
    expect(cfg).toMatchObject({ addToGroup: false, groupId: null, groupName: null });
  });

  it("corta nome e motivo compridos demais editados à mão", () => {
    const cfg = parseHandoffConfig({
      addToGroup: true,
      groupId: GRUPO,
      groupName: "n".repeat(MAX_GROUP_NAME + 50),
      groupReason: "m".repeat(MAX_GROUP_REASON + 50),
    });
    expect(cfg.groupName).toHaveLength(MAX_GROUP_NAME);
    expect(cfg.groupReason).toHaveLength(MAX_GROUP_REASON);
  });

  it("resume no card o que está valendo, pelo nome do grupo quando existe", () => {
    expect(describeHandoff(config())).toContain("“Recepção”");
    expect(describeHandoff(config({ groupName: null }))).toContain("grupo");
    expect(describeHandoff(config({ addToGroup: false }))).toContain("precisa de você");
  });
});

describe("Motivo na descrição da tool (handoffToolDescription)", () => {
  const MOTIVO = "o paciente quiser fechar o orçamento";

  it("sem config, fica a descrição de sempre", () => {
    expect(handoffToolDescription()).toBe("Transfere a conversa para um atendente humano.");
  });

  it("com grupo ligado e motivo, diz ao agente quando transferir", () => {
    const d = handoffToolDescription(config({ groupReason: MOTIVO }));
    expect(d).toContain(`Use sempre que: ${MOTIVO}.`);
    expect(d).toContain("grupo");
  });

  it("não duplica a pontuação final nem leva quebra de linha para o LLM", () => {
    const d = handoffToolDescription(config({ groupReason: `${MOTIVO};\nou reclamar.` }));
    expect(d).toContain(`Use sempre que: ${MOTIVO}; ou reclamar.`);
    expect(d).not.toContain("..");
    expect(d).not.toContain("\n");
  });

  it("motivo guardado com o grupo desligado não tem efeito", () => {
    expect(handoffToolDescription(config({ addToGroup: false, groupReason: MOTIVO }))).toBe(
      "Transfere a conversa para um atendente humano.",
    );
  });

  it("sem motivo, o agente decide sozinho como antes", () => {
    expect(handoffToolDescription(config())).toBe("Transfere a conversa para um atendente humano.");
  });

  it("é o texto que chega ao LLM pela lista de tools", () => {
    const tool = getToolSchemas(["handoff_human"], undefined, undefined, config({ groupReason: MOTIVO }))
      .find((s) => s.name === "handoff_human");
    expect(tool?.description).toContain(MOTIVO);
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
    groupName: z.string().trim().optional().default(""),
    groupReason: z.string().trim().max(MAX_GROUP_REASON).optional().default(""),
  })
  .superRefine((data, ctx) => {
    if (data.addToGroup && !normalizeGroupId(data.groupId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["groupId"], message: "ID inválido" });
    }
  })
  .transform((data): HandoffConfig => {
    const groupId = normalizeGroupId(data.groupId);
    return {
      addToGroup: data.addToGroup && Boolean(groupId),
      groupId,
      groupName: groupId && data.groupName ? data.groupName.slice(0, MAX_GROUP_NAME) : null,
      groupReason: data.groupReason,
    };
  });

describe("Envio do formulário de transferência", () => {
  it("aceita ligado com grupo válido, nome e motivo", () => {
    const r = schema.safeParse({ addToGroup: "on", groupId: GRUPO, groupName: "Recepção", groupReason: " orçamento " });
    expect(r.success && r.data).toEqual(config({ groupReason: "orçamento" }));
  });

  it("RECUSA ligado com grupo inválido, em vez de salvar desligado calado", () => {
    expect(schema.safeParse({ addToGroup: "on", groupId: "grupo errado" }).success).toBe(false);
    expect(schema.safeParse({ addToGroup: "on", groupId: "" }).success).toBe(false);
  });

  it("desligado NÃO apaga grupo nem motivo — desligar é pausar", () => {
    const r = schema.safeParse({ addToGroup: "", groupId: GRUPO, groupName: "Recepção", groupReason: "orçamento" });
    expect(r.success && r.data).toEqual(config({ addToGroup: false, groupReason: "orçamento" }));
  });

  it("recusa motivo acima do limite", () => {
    const r = schema.safeParse({ addToGroup: "on", groupId: GRUPO, groupReason: "m".repeat(MAX_GROUP_REASON + 1) });
    expect(r.success).toBe(false);
  });

  it("trata como desligado o que não é 'on' — 'false' não pode virar ligado", () => {
    expect(schema.safeParse({ addToGroup: "false", groupId: "" }).success).toBe(true);
    expect(schema.safeParse({ addToGroup: "off", groupId: "" }).success).toBe(true);
  });
});

describe("Grupos do número conectado (listWhatsAppGroups)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lista os grupos da Evolution quando o número está conectado", async () => {
    whatsappConectado();
    provider.listGroups.mockResolvedValueOnce([{ id: GRUPO, name: "Recepção", size: 4 }]);
    await expect(listWhatsAppGroups(TENANT)).resolves.toEqual({
      ok: true,
      groups: [{ id: GRUPO, name: "Recepção", size: 4 }],
    });
    expect(provider.listGroups).toHaveBeenCalledWith("tenant_tenant-1");
  });

  it("número desconectado: avisa em vez de tentar", async () => {
    db.whatsappInstance.findUnique.mockResolvedValue({ externalId: "tenant_tenant-1", status: "disconnected" });
    await expect(listWhatsAppGroups(TENANT)).resolves.toMatchObject({ ok: false, reason: "disconnected" });
    expect(provider.listGroups).not.toHaveBeenCalled();
  });

  it("conexão da Meta: grupo não existe ali, e a tela não oferece o ID à mão", async () => {
    db.whatsappInstance.findUnique.mockResolvedValue({
      provider: "meta",
      externalId: "phone-1",
      status: "connected",
      metaPhoneNumberId: "phone-1",
      metaBusinessAccountId: null,
      metaAccessTokenEncrypted: null,
    });
    await expect(listWhatsAppGroups(TENANT)).resolves.toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("nunca lança: Evolution fora do ar vira aviso, e a pessoa ainda pode colar o ID", async () => {
    whatsappConectado();
    provider.listGroups.mockRejectedValueOnce(new Error("Evolution fora do ar"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(listWhatsAppGroups(TENANT)).resolves.toMatchObject({ ok: false, reason: "failed" });
    log.mockRestore();
  });
});

describe("Resposta da Evolution (EvolutionProvider.listGroups)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fica só com grupos, usa o ID quando não há nome e ordena por nome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { id: "120363000000000002@g.us", subject: "Vendas", size: 3 },
            { id: "5511999990000@s.whatsapp.net", subject: "Não é grupo" },
            { id: "120363000000000001@g.us", subject: "  Atendimento  " },
            { id: "120363000000000003@g.us", subject: "" },
          ]),
        ),
      ),
    );
    const groups = await new EvolutionProvider().listGroups("tenant_tenant-1");
    expect(groups).toEqual([
      { id: "120363000000000003@g.us", name: "120363000000000003@g.us", size: null },
      { id: "120363000000000001@g.us", name: "Atendimento", size: null },
      { id: "120363000000000002@g.us", name: "Vendas", size: 3 },
    ]);
  });

  it("lança em resposta de erro — quem decide o que mostrar é listWhatsAppGroups", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 500 })));
    await expect(new EvolutionProvider().listGroups("tenant_tenant-1")).rejects.toThrow("500");
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
