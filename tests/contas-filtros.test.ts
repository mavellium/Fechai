import { describe, it, expect } from "vitest";
import {
  filtersToHref,
  type TenantFilterValues,
} from "@/app/(admin)/admin/contas/filter-url";
import {
  normalizePageSize,
  TENANT_PAGE_SIZES,
  DEFAULT_TENANT_PAGE_SIZE,
} from "@/modules/admin/service";

/**
 * O endereço da lista de contas.
 *
 * Vale um teste porque a busca (que digita) e o painel de filtros (que aplica)
 * escrevem na MESMA URL: um esquecer um parâmetro do outro é justamente o erro
 * que não aparece olhando a tela — some um filtro no meio de uma digitação, e
 * parece "a lista piscou".
 */
const BASE: TenantFilterValues = {
  q: "",
  status: [],
  plan: [],
  whatsapp: [],
  trial: [],
  sort: "recentes",
  limite: 100,
};

const PADRAO = 100;

describe("endereço da lista de contas", () => {
  it("sem nada escolhido, é a URL limpa", () => {
    expect(filtersToHref(BASE, PADRAO)).toBe("/admin/contas");
  });

  it("omite o que está no padrão", () => {
    // Ordenação padrão e limite padrão não viram parâmetro: a URL de quem só
    // abriu a tela tem de ser igual à do menu lateral.
    expect(filtersToHref({ ...BASE, sort: "recentes", limite: PADRAO }, PADRAO)).toBe(
      "/admin/contas",
    );
  });

  it("leva a busca junto com os filtros", () => {
    // O caso que motivou juntar as duas telas num só construtor de URL.
    const href = filtersToHref({ ...BASE, q: "acme", plan: ["FREE"] }, PADRAO);
    expect(href).toContain("q=acme");
    expect(href).toContain("plan=FREE");
  });

  it("junta vários valores do mesmo campo com vírgula", () => {
    expect(filtersToHref({ ...BASE, plan: ["FREE", "PRO"] }, PADRAO)).toContain(
      "plan=FREE%2CPRO",
    );
  });

  it("mantém a quantidade por página quando não é a padrão", () => {
    expect(filtersToHref({ ...BASE, limite: 20 }, PADRAO)).toContain("limite=20");
  });

  it("preserva busca e filtros ao mudar a quantidade", () => {
    // Trocar "100" por "20" não pode limpar o que já estava filtrado.
    const href = filtersToHref(
      { ...BASE, q: "acme", status: ["active"], trial: ["ativo"], limite: 20 },
      PADRAO,
    );
    expect(href).toContain("q=acme");
    expect(href).toContain("status=active");
    expect(href).toContain("trial=ativo");
    expect(href).toContain("limite=20");
  });
});

/**
 * A quantidade por página vem da URL, e a URL é digitável.
 *
 * Sem a lista fechada, `?limite=100000` viraria um `take` de cem mil — um
 * SELECT varrendo a tabela inteira por conta de um número escrito à mão na
 * barra de endereço. É o único parâmetro desta tela que vira diretamente uma
 * decisão de banco, daí testar cada jeito de escrevê-lo errado.
 */
describe("quantidade de contas por página", () => {
  it("aceita os tamanhos oferecidos na tela", () => {
    for (const n of TENANT_PAGE_SIZES) {
      expect(normalizePageSize(String(n))).toBe(n);
    }
  });

  it("sem parâmetro, usa o padrão", () => {
    expect(normalizePageSize(undefined)).toBe(DEFAULT_TENANT_PAGE_SIZE);
    expect(normalizePageSize("")).toBe(DEFAULT_TENANT_PAGE_SIZE);
  });

  it("recusa número fora da lista, por maior que seja", () => {
    // O caso que a lista fechada existe para impedir.
    expect(normalizePageSize("100000")).toBe(DEFAULT_TENANT_PAGE_SIZE);
    expect(normalizePageSize("201")).toBe(DEFAULT_TENANT_PAGE_SIZE);
    expect(normalizePageSize("0")).toBe(DEFAULT_TENANT_PAGE_SIZE);
    expect(normalizePageSize("-50")).toBe(DEFAULT_TENANT_PAGE_SIZE);
  });

  it("recusa o que nem número é", () => {
    expect(normalizePageSize("todas")).toBe(DEFAULT_TENANT_PAGE_SIZE);
    expect(normalizePageSize("20; DROP TABLE")).toBe(DEFAULT_TENANT_PAGE_SIZE);
    expect(normalizePageSize("Infinity")).toBe(DEFAULT_TENANT_PAGE_SIZE);
    expect(normalizePageSize("NaN")).toBe(DEFAULT_TENANT_PAGE_SIZE);
  });

  it("o padrão está entre os tamanhos oferecidos", () => {
    // Senão a tela abriria com um valor que o menu não sabe mostrar.
    expect(TENANT_PAGE_SIZES).toContain(DEFAULT_TENANT_PAGE_SIZE);
  });
});
