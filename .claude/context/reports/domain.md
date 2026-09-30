# reports — Entidades e Domínio

## MonthlyReport (`monthly.ts`, JSON do snapshot, `version: 1`)
- **Campos:** `current`/`previous: MonthlyMetrics`, `automatic?` (antes das correções), `assumptions`, `metricOverrides?`, `leadQuality?`, `evidence?`, `quality?`, `time` (dentro de metrics), textos da revisão, `status`/`finalizedAt`/`sentAt`/`meetingAt`.
- **Invariantes:** opcionais ausentes em snapshot antigo = "sem registro", nunca zero; tela e PDF escondem o bloco.

## MonthlyMetrics
- Contagens (`newContacts`, `qualified`, `handoffs`, `unanswered`, `untypedAppointments`, `attendanceUnknown`), `SplitCount` (`conversations`, `scheduled`, `attended`: inside/outside/unclassified), `firstResponseSeconds`, `time?`, `procedures`, `peaks`, dinheiro derivado (`revenueCents`, `savingsCents`, `roiPercent`) e `missing[]`.

## MonthlyEvidence (`monthly-evidence.ts`) — origem de cada número
- `conversations` (counted/excluded `human_only|no_reply`, bucket, newContact, aiOnly), `responses` (par chegada→resposta, `by`), `appointments` (`scheduled`/`attended` = critério, Clinicorp, chegada, bucket), `events`, `messages` + `messagesExcluded`, `hours[24]`, `gaps`, `leads?`.
- **Invariantes:** só ids, datas ISO e classificações (sem nome/telefone/texto); `EVIDENCE_LIMIT` 5.000 por lista, total em `truncated`.
- Rótulos: `SCHEDULED_LABEL`, `ATTENDED_LABEL`, `BUCKET_LABEL`, `bucketReason`.

## MonthlyQuality (`monthly-quality.ts`)
- `QualityStatus`: `verified | estimated | partial | pending | inconsistent`; `MetricQuality = { status, reasons[] }` por `QualityKey` (18 chaves).
- **Invariantes:** pior situação vence (inconsistent > pending > partial > estimated > verified); correção ≠ `automatic.current` → inconsistent; dinheiro/horas → estimated.

## MonthlyAssumptions (`monthly-config.ts`, Zod)
- Fuso, `humanHours` (null = não levantado), atendente, `secondsPerMessage`/`minutesPerConversation`, mensalidade, procedimentos (ticket/conversão bps), tipos de avaliação, status Clinicorp, `agentIds`. `parseMonthlyAssumptions` nunca lança.

## Pendências (`monthly-pendencies.ts`)
- `detectMonthlyPendencies(m, config)` → `{ topic, text }[]`, fonte única de `missing` e do bloqueio do fechamento.
