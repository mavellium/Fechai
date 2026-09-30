# reports — Padrões de Código

## Anotar registro ao excluir da conta (`monthly.ts`)
```typescript
evidence.appointments.push(row);
if (appointment.status === "canceled") { row.scheduled = row.attended = "canceled"; continue; }
```
Cada `continue` que tira da conta grava o motivo. Nunca montar a lista com outra consulta.

## Novo indicador com selo
1. Número em `MonthlyMetrics` + registros em `MonthlyEvidence` (mesma passada).
2. Chave em `QUALITY_KEYS` + regra em `monthlyQuality` (`new Grade().manual(label, shown, auto).done("verified", critério)`).
3. Tabela em `entry()` de `relatorios/MonthlyEvidence.tsx`; linha em `monthlyRows` (`MonthlyView.tsx`) e no PDF (confira folga).

## Selo + origem num número em destaque
```tsx
<Stat compact label="Receita estimada" value={money(a.revenueCents)} footer={<StatSource report={r} metric="revenue" />} />
```

## Fechar com cobertura parcial (cliente)
```tsx
finalizeMonthlyRoi(tenantId, r.month, acknowledged ? limitationFingerprint(r.limitations ?? []) : [])
```
A lista confirmada é a que o admin viu; mudou no servidor → recusa.

## Etapa nova no assistente (`MonthlyRoiEditor.tsx`)
Seção dentro do mesmo `<UnsavedForm>` com `hidden={step !== N}`; sem `required` nativo (validação no `onSubmit`); o que tem formulário próprio vai fora do form.

## Fixture de teste com selo
```typescript
const { metrics: current, evidence } = evaluateMonthlyMetrics(roiInput());
const report = { ...roiFixture(), current, automatic: { current, previous: current }, evidence };
report.quality = monthlyQuality(report);
```
