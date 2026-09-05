import { describe, it, expect, beforeAll } from "vitest";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, gunzipSync } from "node:zlib";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Testes das funções de segurança que são puras — criptografia e limites.
 *
 * `src/lib/crypto.ts` e o guard de tamanho não são importados diretamente
 * porque puxam a cadeia de módulos do app (Redis, Prisma) e travariam o
 * processo do teste. As de `scripts/` não têm essa dependência e entram de
 * verdade.
 */

describe("Criptografia dos backups (scripts/backup-crypto.ts)", () => {
  let mod: typeof import("../scripts/backup-crypto");

  beforeAll(async () => {
    process.env.BACKUP_ENCRYPTION_KEY = "k".repeat(40);
    mod = await import("../scripts/backup-crypto");
  });

  async function cifrar(conteudo: Buffer): Promise<Buffer> {
    const pedacos: Buffer[] = [];
    const destino = new Writable({
      write(c: Buffer, _e: unknown, cb: () => void) {
        pedacos.push(c);
        cb();
      },
    });
    await pipeline(Readable.from(conteudo), createGzip({ level: 1 }), mod.createEncryptStream(), destino);
    return Buffer.concat(pedacos);
  }

  it("cifra e decifra sem perder um byte", async () => {
    // Grande o suficiente para atravessar vários chunks do stream — um bug de
    // buffer só aparece com múltiplos chunks, não com um dump de brinquedo.
    const original = Buffer.from("LINHA DE DUMP SQL; ".repeat(100_000), "utf8");
    const cifrado = await cifrar(original);
    expect(gunzipSync(mod.decryptBackup(cifrado)).equals(original)).toBe(true);
  });

  it("o arquivo cifrado não contém o texto original", async () => {
    const original = Buffer.from("SENHA_SECRETA_DO_CLIENTE".repeat(1000), "utf8");
    const cifrado = await cifrar(original);
    expect(cifrado.toString("utf8")).not.toContain("SENHA_SECRETA");
  });

  it("recusa a chave errada", async () => {
    const cifrado = await cifrar(Buffer.from("dados"));
    process.env.BACKUP_ENCRYPTION_KEY = "outra".repeat(10);
    expect(() => mod.decryptBackup(cifrado)).toThrow(/decifrar/i);
    process.env.BACKUP_ENCRYPTION_KEY = "k".repeat(40);
  });

  it("detecta adulteração (é o ponto de usar GCM)", async () => {
    const cifrado = await cifrar(Buffer.from("dados importantes".repeat(100)));
    const adulterado = Buffer.from(cifrado);
    adulterado[Math.floor(adulterado.length / 2)] ^= 0xff;
    expect(() => mod.decryptBackup(adulterado)).toThrow();
  });

  it("recusa arquivo truncado", () => {
    expect(() => mod.decryptBackup(Buffer.alloc(8))).toThrow(/corrompido/i);
  });

  it("lida com dump vazio", async () => {
    const cifrado = await cifrar(Buffer.alloc(0));
    expect(gunzipSync(mod.decryptBackup(cifrado)).length).toBe(0);
  });

  it("exige chave de tamanho mínimo", async () => {
    process.env.BACKUP_ENCRYPTION_KEY = "curta";
    expect(() => mod.createEncryptStream()).toThrow(/curta/i);
    process.env.BACKUP_ENCRYPTION_KEY = "k".repeat(40);
  });

  it("identifica backup cifrado pelo sufixo", () => {
    // É como o restore decide o que fazer — backup antigo, sem cifra, precisa
    // continuar restaurando.
    expect(mod.isEncryptedBackup("fechai-daily-x.sql.gz.enc")).toBe(true);
    expect(mod.isEncryptedBackup("fechai-daily-x.sql.gz")).toBe(false);
  });
});

describe("Assinatura do cookie de personificação", () => {
  // Replica a regra de src/lib/impersonation.ts (que não pode ser importado
  // aqui: puxa next/headers). O teste em tests/autorizacao.test.ts garante que
  // o arquivo real mantém estas propriedades.
  const SEGREDO = "s".repeat(40);
  const hmac = (v: string, s = SEGREDO) => createHmac("sha256", s).update(v).digest("hex");
  const encode = (p: object, s = SEGREDO) => {
    const raw = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
    return `${raw}.${hmac(raw, s)}`;
  };
  const decode = (value: string, s = SEGREDO) => {
    const [raw, sig] = value.split(".");
    if (!raw || !sig) return null;
    const esperado = Buffer.from(hmac(raw, s), "hex");
    const recebido = Buffer.from(sig, "hex");
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof p.exp !== "number" || p.exp <= Date.now()) return null;
    return p;
  };

  const valido = { userId: "u1", email: "a@b.c", role: "OWNER", tenantId: "t1" };

  it("aceita cookie válido e dentro do prazo", () => {
    expect(decode(encode({ ...valido, exp: Date.now() + 60_000 }))).toMatchObject({ tenantId: "t1" });
  });

  it("recusa cookie expirado", () => {
    expect(decode(encode({ ...valido, exp: Date.now() - 1 }))).toBeNull();
  });

  it("recusa cookie sem prazo", () => {
    expect(decode(encode(valido))).toBeNull();
  });

  it("recusa assinatura de outro segredo", () => {
    const forjado = encode({ ...valido, tenantId: "vitima", exp: Date.now() + 60_000 }, "x".repeat(40));
    expect(decode(forjado)).toBeNull();
  });

  it("recusa payload adulterado (troca de tenant)", () => {
    const token = encode({ ...valido, exp: Date.now() + 60_000 });
    const [, sig] = token.split(".");
    const outro = Buffer.from(
      JSON.stringify({ ...valido, tenantId: "vitima", exp: Date.now() + 60_000 }),
      "utf8",
    ).toString("base64url");
    expect(decode(`${outro}.${sig}`)).toBeNull();
  });
});
