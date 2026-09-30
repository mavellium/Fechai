# lead-insights — Padrões (copy-paste)

## Ler a qualidade dos leads de um período (Server Component)
```tsx
const quality = await loadLeadQuality(tenantId, { from: range.from, to: range.to });
return <LeadQualityView quality={quality} period={range.label} />;
```

## Classificar uma cidade contra a área
```ts
const area = await getServiceArea(tenantId);           // null = não configurada
const verdict = classifyCity(area, normalizeCity("Marília - SP")); // "in" | "out" | "unknown"
```

## Resumir sem banco (teste ou script)
```ts
const q = summarizeLeadQuality(rows, parseServiceArea({ baseCity: "Garça", cities: [] }), new Date());
leadQualityHeadline(q); // "Dos 200 leads, 122 informaram a cidade: 62 eram de fora do raio (48 de Marília)…"
```

## Prisma mockado (tests/lead-insights-record.test.ts)
```ts
const db = vi.hoisted(() => ({ conversation: { findFirst: vi.fn() }, conversationInsight: { upsert: vi.fn(), updateMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
```

## Nova categoria (fase 2)
Acrescente em `DOUBT_CATEGORIES`/`LOSS_CATEGORIES`; as chaves são `String`, sem migration. A tool lê as listas, então o enum do schema da tool já acompanha.
