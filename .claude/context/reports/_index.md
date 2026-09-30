# reports — Relatórios (Operacional, Financeiro, ROI mensal)

Métricas do tenant para `/relatorios`, a home e o ROI mensal revisado pela Mavellium (snapshot + PDF). Código: `src/modules/reports/`.

| Aspecto | Onde |
| --- | --- |
| Domain | `monthly.ts` (tipos), `monthly-config.ts`, `monthly-evidence.ts`, `monthly-quality.ts`, `monthly-pendencies.ts` → [domain.md](domain.md) |
| Actions (escrita) | `admin/relatorios/[tenantId]/actions.ts`, `ai-actions.ts`, `relatorios/actions.ts`, `events.ts` → [actions.md](actions.md) |
| Queries (leitura) | `service.ts`, `monthly.ts`, `monthly-publication.ts`, `origin-hours.ts` → [queries.md](queries.md) |
| Copy-paste | [patterns.md](patterns.md) · Histórico: [changelog.md](changelog.md) |

Para usar, saiba:
- [ ] Toda métrica filtra `tenantId` e `isTest: false`; dinheiro em centavos (`formatBRL`); fuso via `scheduling/time.ts`.
- [ ] ROI mensal fechado = **snapshot**; nunca recalcula nem consulta Clinicorp para exibir/exportar.
- [ ] Cada número do ROI mensal tem **registros** (`evidence`) e **selo** (`quality`), da mesma passada do cálculo.
- [ ] `missing` só sai de `detectMonthlyPendencies`; receita/economia/ROI nunca são editados, só derivados.
- [ ] PDF: página 1 com ~2pt de folga; linha nova exige tirar outra.
- [ ] Guias: `src/app/(dashboard)/relatorios/README.md`, `src/modules/reports/README.md`, `docs/P-79-relatorio-mensal-roi.md`.
