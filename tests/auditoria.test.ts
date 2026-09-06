import { describe, it, expect } from "vitest";
import { diffFields, hasChanges } from "@/modules/audit/diff";
import { redactSnapshot, containsRedacted, isTruncated, REDACTED } from "@/modules/audit/redact";
import {
  AUDIT_EVENTS,
  eventDef,
  isRevertibleEvent,
  eventLabel,
  type AuditEventDef,
} from "@/modules/audit/events";
import { expiresAtFor, BLOCK_DURATIONS } from "@/modules/auth/ip-block";

/**
 * `AUDIT_EVENTS` é `as const`, então cada entrada tem o tipo literal exato e
 * `revertible` some das que não o declaram. Para varrer o catálogo inteiro, o
 * que vale é a forma declarada.
 */
const EVENTS = AUDIT_EVENTS as Record<string, AuditEventDef>;

/**
 * A trilha de auditoria.
 *
 * O que é testado aqui é a parte que decide o CONTEÚDO da linha gravada — o
 * diff, a redação de segredo e as invariantes do catálogo. É onde um erro
 * silencioso custa caro: um diff que sempre acha mudança enche a trilha de
 * ruído, uma redação que falha grava senha em texto claro, e um evento
 * marcado como revertível sem ser gera um botão que promete desfazer algo que
 * não desfaz.
 */

describe("diff — o que entra como alteração", () => {
  it("não acusa mudança quando nada mudou", () => {
    const diff = diffFields({ name: "Acme", enabled: true }, { name: "Acme", enabled: true });
    expect(hasChanges(diff)).toBe(false);
  });

  it("guarda só os campos que mudaram, dos dois lados", () => {
    const diff = diffFields(
      { name: "Acme", enabled: true, objective: "vender" },
      { name: "Acme Ltda", enabled: true, objective: "vender" },
    );
    expect(diff.fields).toEqual(["name"]);
    expect(diff.before).toEqual({ name: "Acme" });
    expect(diff.after).toEqual({ name: "Acme Ltda" });
  });

  it("ignora campos que a ação não tocou, mesmo presentes no estado anterior", () => {
    // `before` costuma vir de um findUnique completo e `after` só com o que a
    // action escreveu — sem isto, toda alteração acusaria dezenas de campos.
    const diff = diffFields(
      { name: "Acme", planKey: "FREE", createdAt: new Date("2024-01-01") },
      { name: "Acme Ltda" },
    );
    expect(diff.fields).toEqual(["name"]);
  });

  it("compara datas por valor, não por referência", () => {
    // Dois Date iguais são objetos distintos: sem comparar por timestamp, todo
    // salvamento acusaria mudança numa data que ninguém tocou.
    const diff = diffFields(
      { trialEndsAt: new Date("2026-01-01T00:00:00Z") },
      { trialEndsAt: new Date("2026-01-01T00:00:00Z") },
    );
    expect(hasChanges(diff)).toBe(false);
  });

  it("compara JSON por conteúdo, independente da ordem das chaves", () => {
    const diff = diffFields(
      { personaDraft: { tone: "formal", offer: "consulta" } },
      { personaDraft: { offer: "consulta", tone: "formal" } },
    );
    expect(hasChanges(diff)).toBe(false);
  });

  it("trata null e undefined como a mesma ausência", () => {
    // O Prisma devolve null, o formulário manda undefined. Trocar um pelo
    // outro não é uma alteração que interesse a quem lê o log.
    const diff = diffFields({ messageLimitOverride: null }, { messageLimitOverride: undefined });
    expect(hasChanges(diff)).toBe(false);
  });

  it("detecta a troca de null por um valor", () => {
    const diff = diffFields({ messageLimitOverride: null }, { messageLimitOverride: 5000 });
    expect(diff.fields).toEqual(["messageLimitOverride"]);
    expect(diff.before.messageLimitOverride).toBeNull();
  });

  it("serializa datas como ISO para caber na coluna Json", () => {
    const diff = diffFields({ trialEndsAt: null }, { trialEndsAt: new Date("2026-03-01T12:00:00Z") });
    expect(diff.after.trialEndsAt).toBe("2026-03-01T12:00:00.000Z");
  });
});

describe("redação — o que nunca pode ser gravado", () => {
  it("remove hash de senha em qualquer profundidade", () => {
    const safe = redactSnapshot({
      email: "cliente@exemplo.com",
      passwordHash: "$2a$12$abcdefghijklmnop",
      user: { nested: { passwordHash: "$2a$12$outro" } },
    }) as Record<string, unknown>;

    expect(safe.email).toBe("cliente@exemplo.com");
    expect(safe.passwordHash).toBe(REDACTED);
    expect(JSON.stringify(safe)).not.toContain("$2a$12$");
  });

  it("remove segredo de integração, comparando sem diferenciar maiúscula", () => {
    const safe = redactSnapshot({ apiToken: "tok_123", ApiKey: "sk-abc", secretEnc: "xyz" });
    expect(containsRedacted(safe)).toBe(true);
    expect(JSON.stringify(safe)).not.toContain("tok_123");
    expect(JSON.stringify(safe)).not.toContain("sk-abc");
  });

  it("corta campo de segredo com nome novo, pelo sufixo", () => {
    // A lista exata envelhece em silêncio: cada integração nova traz um nome
    // (`apiToken`, `googleRefreshToken`, `webhookSecret`) e o campo esquecido
    // passa direto até alguém ler o log. O sufixo cobre o que a lista não viu.
    const safe = redactSnapshot({
      googleRefreshToken: "1//abc",
      webhookSecret: "whsec_1",
      fishAudioApiKey: "fa_1",
      // Nome parecido que NÃO é segredo — cortar isto esconderia informação útil.
      tokenCount: 42,
    }) as Record<string, unknown>;

    expect(safe.googleRefreshToken).toBe(REDACTED);
    expect(safe.webhookSecret).toBe(REDACTED);
    expect(safe.fishAudioApiKey).toBe(REDACTED);
    expect(safe.tokenCount).toBe(42);
  });

  it("corta texto grande em vez de copiar o documento inteiro", () => {
    const enorme = "a".repeat(10_000);
    const safe = redactSnapshot({ content: enorme }) as Record<string, unknown>;
    expect(isTruncated(safe.content)).toBe(true);
    expect(JSON.stringify(safe).length).toBeLessThan(1_000);
  });

  it("preserva texto dentro do teto", () => {
    const safe = redactSnapshot({ content: "instruções curtas" }) as Record<string, unknown>;
    expect(safe.content).toBe("instruções curtas");
  });

  it("resume lista longa em vez de arrastar a conta inteira para o log", () => {
    const safe = redactSnapshot({ mensagens: Array.from({ length: 400 }, (_, i) => i) }) as Record<
      string,
      unknown
    >;
    expect(safe.mensagens).toBe("[400 itens]");
  });

  it("não muta o objeto recebido — a action ainda vai usá-lo", () => {
    const original = { passwordHash: "$2a$12$abc" };
    redactSnapshot(original);
    expect(original.passwordHash).toBe("$2a$12$abc");
  });

  it("reconhece um valor redigido para o revert poder recusar", () => {
    // É o que impede um "desfazer" de gravar a string "[oculto]" por cima de
    // um segredo real — pior que não reverter, porque parece ter funcionado.
    expect(containsRedacted({ apiToken: REDACTED })).toBe(true);
    expect(containsRedacted({ name: "Acme" })).toBe(false);
  });
});

describe("catálogo de eventos", () => {
  it("só marca como revertível o que tem estado para regravar", () => {
    // Um login não tem o que desfazer; um "create" desfeito seria uma
    // exclusão disfarçada de undo. Só update e delete podem prometer isso.
    for (const [key, def] of Object.entries(EVENTS)) {
      if (def.revertible) {
        expect(["update", "delete"], `evento ${key}`).toContain(def.kind);
      }
    }
  });

  it("não oferece desfazer para exclusão de conta", () => {
    // Cascade em dezenas de tabelas e recursos soltos em três serviços
    // externos: restaurar de um JSON produziria uma conta parcial que parece
    // inteira. Ver modules/audit/README.md.
    expect(isRevertibleEvent("admin.tenant_deleted")).toBe(false);
  });

  it("não oferece desfazer para entrada na conta", () => {
    expect(isRevertibleEvent("auth.login")).toBe(false);
  });

  it("não oferece desfazer para credencial de integração", () => {
    // O snapshot é redigido, então não existe `before` com o segredo para
    // regravar — e não deveria existir.
    expect(isRevertibleEvent("integration.saved")).toBe(false);
  });

  it("todo evento tem rótulo em português", () => {
    for (const [key, def] of Object.entries(EVENTS)) {
      expect(def.label.length, `evento ${key}`).toBeGreaterThan(0);
      expect(def.label, `evento ${key}`).not.toBe(key);
    }
  });

  it("evento fora do catálogo cai na própria chave em vez de quebrar a tela", () => {
    // Linha antiga de um evento renomeado: a tela mostra a chave crua, não
    // um "undefined".
    expect(eventLabel("nao.existe")).toBe("nao.existe");
    expect(eventDef("nao.existe")).toBeNull();
  });
});

describe("bloqueio de IP — duração", () => {
  it("permanente não tem data de expiração", () => {
    expect(expiresAtFor("permanente")).toBeNull();
  });

  it("prazo vira data no futuro", () => {
    const uma = expiresAtFor("1h");
    expect(uma).not.toBeNull();
    // ~1 hora à frente, com folga para o tempo de execução do teste.
    const diff = uma!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(59 * 60 * 1000);
    expect(diff).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("7 dias é maior que 24 horas", () => {
    expect(expiresAtFor("7d")!.getTime()).toBeGreaterThan(expiresAtFor("24h")!.getTime());
  });

  it("valor desconhecido cai em permanente, nunca num prazo acidental", () => {
    // O valor vem de um <select>, mas a action é chamável direto. Um duração
    // inventada não pode virar um bloqueio que se solta sozinho sem ninguém
    // ter pedido isso.
    expect(expiresAtFor("30s")).toBeNull();
    expect(expiresAtFor("")).toBeNull();
  });

  it("toda opção oferecida na tela é entendida pelo servidor", () => {
    // Sem isto, alguém acrescenta "30d" à lista da tela e o servidor o trata
    // silenciosamente como permanente — o bloqueio nunca venceria.
    for (const option of BLOCK_DURATIONS) {
      const result = expiresAtFor(option.value);
      if (option.hours === null) expect(result, option.value).toBeNull();
      else expect(result, option.value).toBeInstanceOf(Date);
    }
  });
});
