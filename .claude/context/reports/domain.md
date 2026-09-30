# reports — Entidades e Domínio

## MonthlyReport (`monthly.ts`, JSON do snapshot, `version: 1`)
- **Campos:** `current`/`previous: MonthlyMetrics`, `automatic?` (antes das correções), `assumptions`, `metricOverrides?`, `leadQuality?`, `evidence?`, `quality?`, `limitations?`, `time` (dentro de metrics), textos da revisão (`adjustments`, `nextMonth`, `decisionMaker`, `featuredCase?`, `highlights?` ≤240, `limitationsNote?` ≤400), `status`/`finalizedAt`/`sentAt`/`meetingAt`.
- **Invariantes:** opcionais ausentes em snapshot antigo = "sem registro", nunca zero; tela e PDF escondem o bloco.

## MonthlyMetrics
- Contagens (`newContacts`, `qualified`, `handoffs`, `unanswered`, `untypedAppointments`, `attendanceUnknown`), `SplitCount` (`conversations`, `scheduled`, `attended`: inside/outside/unclassified), `firstResponseSeconds`, `time?`, `procedures`, `peaks`, dinheiro derivado (`revenueCents`, `savingsCents`, `roiPercent`) e `missing[]`.

## MonthlyEvidence (`monthly-evidence.ts`) — origem de cada número
- `conversations` (counted/excluded `human_only|no_reply`, bucket, newContact, aiOnly), `responses` (par chegada→resposta, `by`), `appointments` (`scheduled`/`attended` = critério, Clinicorp, chegada, bucket), `events`, `messages` + `messagesExcluded`, `hours[24]`, `gaps`, `leads?`.
- **Invariantes:** só ids, datas ISO e classificações (sem nome/telefone/texto); `EVIDENCE_LIMIT` 5.000 por lista, total em `truncated`.
- Rótulos: `SCHEDULED_LABEL`, `ATTENDED_LABEL`, `BUCKET_LABEL`, `bucketReason`.

## MonthlyQuality (`monthly-quality.ts`)
- `QualityStatus`: `verified | estimated | partial | pending | inconsistent`; `MetricQuality = { status, reasons[] }` por `QualityKey` (18 chaves, nomes em `QUALITY_KEY_LABEL`).
- `pending` se lê **"Não verificado"** (`QUALITY_LABEL`).
- **Invariantes:** pior situação vence (inconsistent > pending > partial > estimated > verified); correção ≠ `automatic.current` → inconsistent; dinheiro/horas → estimated.

## MonthlyAssumptions (`monthly-config.ts`, Zod)
- Fuso, `humanHours` (null = não levantado), atendente, `secondsPerMessage`/`minutesPerConversation`, mensalidade, procedimentos (ticket/conversão bps), tipos de avaliação, status Clinicorp, `agentIds`. `parseMonthlyAssumptions` nunca lança.

## Pendências (`monthly-pendencies.ts`)
- `detectMonthlyPendencies(m, config)` → `{ topic, text }[]`, fonte única de `missing` e das limitações. Não trava mais o fechamento.

## MonthlyNextAction (`monthly-next-actions.ts`)
- `{ action ≤120, owner ≤60, indicator ≤100 }`, até 3, em `MonthlyRoiReport.nextActions` (Json). Sem ações vale `nextMonth` (legado); `hasNextPlan`.

## MonthlyLimitation (`monthly-limitations.ts`, puro)
- `{ key, text, affects[] }`: um por tópico de pendência + `tracking`, `clinicorp`, `arrival` (com expediente), `audio`. Mês anterior sem premissas **não** entra.
- **Invariantes:** calculada, nunca gravada; congelada no snapshot. `limitationFingerprint` = `key|text` (texto tem as contagens).

## MonthlyAnalysis (`monthly-analysis.ts`)
- `{ highlights, limitationsNote, adjustments, nextActions, notes }` (Zod, strict). `notes` é para o admin, nunca salvo.
- **Invariantes (`guardMonthlyAnalysis`):** sem alteração registrada/contexto/texto → `adjustments = ""`; sem limitação → `limitationsNote = ""`.
