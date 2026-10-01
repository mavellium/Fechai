# reports — Entidades e Domínio

## MonthlyReport (`monthly.ts`, JSON do snapshot, `version: 1`)
- **Campos:** `current`/`previous: MonthlyMetrics`, `automatic?` (antes das correções), `assumptions`, `metricOverrides?`, `leadQuality?`, `evidence?`, `quality?`, `limitations?`, `time` (dentro de metrics), textos da revisão (`adjustments`, `nextMonth`, `decisionMaker`, `operationalContact?`, `featuredCase?`, `highlights?` ≤240, `limitationsNote?` ≤400), `status`/`finalizedAt`/`sentAt`/`meetingAt`.
- **Invariantes:** opcionais ausentes em snapshot antigo = "sem registro", nunca zero; tela e PDF escondem o bloco.

## MonthlyMetrics
- Contagens (`newContacts`, `qualified`, `handoffs`, `unanswered`, `untypedAppointments`, `attendanceUnknown`), `SplitCount` (`conversations`, `scheduled`, `attended`: inside/outside/unclassified), `firstResponseSeconds`, `time?`, `procedures`, `peaks`, dinheiro derivado (`revenueCents`, `savingsCents`, `roiPercent`) e `missing[]`.

## MonthlyEvidence (`monthly-evidence.ts`) — origem de cada número
- `conversations` (counted/excluded `human_only|no_reply`, bucket, newContact, aiOnly), `responses` (par chegada→resposta, `by`), `appointments` (`scheduled`/`attended` = critério, Clinicorp, chegada, bucket), `events`, `messages` + `messagesExcluded`, `hours[24]`, `gaps`, `leads?`.
- **Invariantes:** só ids, datas ISO e classificações (sem nome/telefone/texto); `EVIDENCE_LIMIT` 5.000 por lista, total em `truncated`.
- Rótulos: `SCHEDULED_LABEL`, `ATTENDED_LABEL`, `BUCKET_LABEL`, `bucketReason`.

## MonthlyQuality (`monthly-quality.ts`)
- `QualityStatus`: `verified | estimated | partial | pending | inconsistent`; `MetricQuality = { status, reasons[] }` por `QualityKey` (18 chaves, nomes em `QUALITY_KEY_LABEL`).
- `pending` se lê **"Não verificado"** e `estimated`, **"Estimativa"** (`QUALITY_LABEL`). No relatório do cliente só aparece selo quando `showsSeal` (≠ verified).
- **Invariantes:** pior situação vence (inconsistent > pending > partial > estimated > verified); correção ≠ `automatic.current` → inconsistent; dinheiro/horas → estimated.

## MonthlyAssumptions (`monthly-config.ts`, Zod)
- Fuso, `humanHours` (null = não levantado), atendente, `secondsPerMessage`/`minutesPerConversation`, mensalidade, procedimentos (ticket/conversão bps), tipos de avaliação, status Clinicorp, `agentIds`. `parseMonthlyAssumptions` nunca lança.

## Pendências (`monthly-pendencies.ts`)
- `detectMonthlyPendencies(m, config)` → `{ topic, text }[]`, fonte única de `missing` e das limitações. Não trava mais o fechamento.

## Bloco financeiro opcional
- `assumptions.financialEnabled?` + `financialEnabled(config)` (ausente = ligado só com premissas completas). Desligado: dinheiro `null`, sem pendência/limitação/selo financeiro. `monthlyFinancial(r)` = única porta.
- `firstResponseMedianSeconds?` (mediana; página 1).

## MonthlyNextAction (`monthly-next-actions.ts`)
- `{ action ≤120, owner ≤60, indicator ≤100 }`, até 3, em `MonthlyRoiReport.nextActions` (Json). Sem ações vale `nextMonth` (legado); `hasNextPlan`.

## MonthlyLimitation (`monthly-limitations.ts`, puro)
- `{ key, text, affects[] }`: um por tópico de pendência + `tracking`, `clinicorp`, `arrival` (com expediente), `audio`. Mês anterior sem premissas **não** entra.
- **Invariantes:** calculada, nunca gravada; congelada no snapshot. `limitationFingerprint` = `key|text` (texto tem as contagens).

## Decisor × contato operacional (`monthly-decision-maker.ts`, puro)
- **Decisor** (`decisionMaker`): dono/sócio que decide a mensalidade; recebe o relatório e a reunião de 30 min. **Contato operacional** (`operationalContact?`, ≤100, opcional): recepção, recebe cópia.
- `Tenant.ownerNames: String[]` = donos e sócios da conta (até `ACCOUNT_OWNERS_MAX` 8, nome ≤ `PERSON_NAME_MAX` 100); `parseAccountOwners(raw)` nunca lança, apara e deduplica por `normalizeLabel`. `User.role = OWNER` **não** serve (login da conta).
- `decisionMakerProblem({ decisionMaker, operationalContact? }, owners)` → mensagem ou `null`: vazio, igual ao contato (`samePerson`, sem acento/caixa) ou fora da lista.
- **Invariantes:** snapshot antigo sem `operationalContact` = sem registro; o decisor do snapshot é o da entrega.

## Operação (`monthly-operations.ts`, opcionais em `MonthlyMetrics`)
- `reception`: `agentOnly + transferred + teamJoined` = contatos atendidos; `answered`, `medianSeconds`, `overHour`, `unanswered` (da 1ª transferência à 1ª resposta humana, tempo corrido, até o fim do mês).
- `availability`: `{ measuredFrom, partial, coveredSeconds, downSeconds, percent, incidents[], contactsAffected }`; `null` = não medido (nunca 100%); `undefined` = snapshot antigo.
- `arrivals`: inside / beforeOpen / onBreak / afterClose / closedDay / unclassified, pelo expediente cadastrado.
- `agenda`: `noShow` (falta marcada), `unconfirmed` (nunca é falta), `upcoming`. `procedures[].scheduled/attended` contam todos; `attendedOutside` só para a receita.

## PreviousAction (`monthly-previous-actions.ts`) e CaseFacts (`monthly-case.ts`)
- `{ action, owner, indicator, status: worked|partial|failed|null, result ≤160 }`: lista do snapshot anterior aprovado; fechar exige status + resultado (`previousActionsProblem`).
- `{ conversationId, age, audioSeconds[], weekday, period, scheduled }`: lidos no servidor; nunca nome, telefone ou data.

## MonthlyAnalysis (`monthly-analysis.ts`)
- `{ highlights, limitationsNote, adjustments, nextActions, notes }` (Zod, strict). `notes` é para o admin, nunca salvo.
- **Invariantes (`guardMonthlyAnalysis`):** sem alteração registrada/contexto/texto → `adjustments = ""`; sem incidente, limitação nem contexto → `limitationsNote = ""` (a IA não inventa problema); número fora dos fatos validados vai para `notes` (`unbackedNumbers`).
