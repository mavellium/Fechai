import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("Liberação administrativa da API oficial da Meta", () => {
  it("nasce desabilitada para todo tenant", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/metaWhatsappEnabled\s+Boolean\s+@default\(false\)/);
  });

  it("não renderiza a opção Meta sem a liberação", () => {
    const selector = read(
      "src/app/(dashboard)/integracoes/WhatsappProviderSelector.tsx",
    );
    expect(selector).toContain("metaEnabled &&");
    expect(selector).toContain("Meta · API oficial");
  });

  it("protege seleção, cadastro e reconexão no servidor", () => {
    const actions = read("src/app/(dashboard)/integracoes/actions.ts");
    const checks = actions.match(/tenantCanUseMetaWhatsapp\(tenantId\)/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(3);
    expect(actions).toContain("META_WHATSAPP_NOT_ENABLED");
  });

  it("não aceita webhook de tenant sem liberação", () => {
    const route = read("src/app/api/webhooks/whatsapp/meta/[tenantId]/route.ts");
    expect(route).toContain('tenant: { metaWhatsappEnabled: true }');
  });

  it("ao desabilitar volta uma integração Meta para Evolution sem apagar segredos", () => {
    const actions = read("src/app/(admin)/actions.ts");
    const start = actions.indexOf("export async function setTenantMetaWhatsappEnabled");
    const end = actions.indexOf("export async function markFeedback", start);
    const body = actions.slice(start, end);

    expect(body).toContain('provider: "evolution"');
    expect(body).toContain('status: "disconnected"');
    expect(body).not.toContain("metaAccessTokenEncrypted: null");
    expect(body).not.toContain("metaAppSecretEncrypted: null");
  });
});
