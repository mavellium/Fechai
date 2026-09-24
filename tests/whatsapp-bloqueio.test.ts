import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bloqueio de números do WhatsApp.
 *
 * O risco real não é a lista — é a COMPARAÇÃO. O dono digita "(11) 98765-4321"
 * e o WhatsApp entrega "5511987654321" no JID. Se as duas formas não colidirem,
 * a tela mostra "bloqueado" e o agente responde do mesmo jeito: o pior dos
 * mundos, porque ninguém vai desconfiar de um bloqueio que a própria tela
 * confirma.
 */

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { whatsappBlockedNumber: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

import {
  canonicalPhone,
  formatBlockedPhone,
  isBlockablePhone,
  isPhoneBlocked,
} from "@/modules/whatsapp/blocklist";
import { formatBlockedPhoneInput } from "@/modules/whatsapp/blocklist-input";

beforeEach(() => {
  findUnique.mockReset();
});

describe("Forma canônica do número (canonicalPhone)", () => {
  it("ignora máscara: o que foi digitado casa com o que o WhatsApp entrega", () => {
    expect(canonicalPhone("(11) 98765-4321")).toBe(canonicalPhone("5511987654321"));
  });

  it("ignora o código do país", () => {
    expect(canonicalPhone("5511987654321")).toBe(canonicalPhone("11987654321"));
  });

  it("ignora o nono dígito — o mesmo aparelho chega das duas formas", () => {
    expect(canonicalPhone("11987654321")).toBe(canonicalPhone("1187654321"));
    expect(canonicalPhone("5511987654321")).toBe(canonicalPhone("551187654321"));
  });

  it("não confunde números diferentes do mesmo DDD", () => {
    expect(canonicalPhone("11987654321")).not.toBe(canonicalPhone("11987654322"));
  });

  it("deixa número estrangeiro inteiro — cortar sem saber o país bloquearia outro", () => {
    // +1 (415) 555-0199: não começa com 55, nada a remover.
    expect(canonicalPhone("+1 415 555 0199")).toBe("14155550199");
  });

  it("não inventa nada a partir de texto sem dígitos", () => {
    expect(canonicalPhone("sem número")).toBe("");
  });
});

describe("Entrada da lista de bloqueio", () => {
  it("preserva todos os dígitos ao colar +55 ou 55 e casa com o webhook", () => {
    const fromWebhook = canonicalPhone("5511987654321");
    for (const pasted of ["+55 11 98765-4321", "5511987654321"]) {
      const formatted = formatBlockedPhoneInput(pasted);
      expect(formatted.replace(/\D/g, "")).toBe("5511987654321");
      expect(canonicalPhone(formatted)).toBe(fromWebhook);
    }
  });

  it("mantém todos os dígitos ao digitar +55 ou 55", () => {
    for (const number of ["+5511987654321", "5511987654321"]) {
      let typed = "";
      for (const character of number) {
        typed = formatBlockedPhoneInput(typed + character);
      }
      expect(typed.replace(/\D/g, "")).toBe("5511987654321");
      expect(canonicalPhone(typed)).toBe("1187654321");
    }
  });

  it("não corta números estrangeiros ou entradas mais longas", () => {
    expect(formatBlockedPhoneInput("+1 415 555 0199")).toBe("+1 415 555 0199");
    expect(formatBlockedPhoneInput("551198765432199").replace(/\D/g, ""))
      .toBe("551198765432199");
  });
});

describe("Número aceitável para a lista (isBlockablePhone)", () => {
  it("aceita telefone com DDD", () => {
    expect(isBlockablePhone("(11) 98765-4321")).toBe(true);
  });

  it("recusa fragmento — depois da canonicalização casaria com meio mundo", () => {
    expect(isBlockablePhone("119")).toBe(false);
    expect(isBlockablePhone("")).toBe(false);
  });
});

describe("Consulta do bloqueio (isPhoneBlocked)", () => {
  it("procura pela forma canônica, não pelo que veio no JID", async () => {
    findUnique.mockResolvedValue({ id: "b1" });
    await expect(isPhoneBlocked("t1", "5511987654321")).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_phone: { tenantId: "t1", phone: "1187654321" } },
      }),
    );
  });

  it("número fora da lista passa", async () => {
    findUnique.mockResolvedValue(null);
    await expect(isPhoneBlocked("t1", "11987654321")).resolves.toBe(false);
  });

  it("nunca lança: falha de banco deixa a mensagem PASSAR", async () => {
    // Na dúvida, atender. Engolir a mensagem de um cliente real por causa de um
    // erro de leitura custa a venda; deixar passar um bloqueado é incômodo.
    findUnique.mockRejectedValue(new Error("banco fora do ar"));
    await expect(isPhoneBlocked("t1", "11987654321")).resolves.toBe(false);
  });

  it("não vai ao banco com número vazio", async () => {
    await expect(isPhoneBlocked("t1", "")).resolves.toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("Exibição (formatBlockedPhone)", () => {
  it("mostra o número guardado em forma de telefone", () => {
    expect(formatBlockedPhone("1187654321")).toBe("(11) 8765-4321");
  });

  it("devolve como está o que não tem cara de telefone BR", () => {
    expect(formatBlockedPhone("14155550199")).toBe("14155550199");
  });
});
