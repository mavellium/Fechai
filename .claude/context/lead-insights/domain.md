# lead-insights — Entidades e domínio

## Prisma
- **ConversationInsight** (1 por conversa, `conversationId @unique`, cascata): `city`, `cityKey`, `procedure`, `firstQuestionKey/Text`, `lossReasonKey/Text`. Categorias são `String`, não enum.
- **TenantServiceArea** (1 por tenant): `baseCity`, `cities String[]`. Sem linha = não configurada.

## Tipos (puros)
- **ServiceArea:** `{ baseCity, cities[] }`; `CityVerdict = "in" | "out" | "unknown"`.
- **LeadRow:** lead + conversa (`needsHuman`, `lastInboundAt`, `followUpReason`, `handoffEvents`) + agendamentos + insight.
- **LeadOutcome:** `scheduled | handoff | lost | open`. **LeadQuality:** agregado (leads, withCity, in/out, cities, doubts, losses, outcomes, lowSample, suggestions).

## Invariantes
- Categorias de dúvida: localizacao, preco, convenio, pagamento, horario, procedimento, outro. Perda (agente): fora_da_regiao, preco, convenio, horario, concorrente, adiou, sem_interesse, outro. Derivadas: `sumiu`, `nao_e_paciente`.
- Chave desconhecida vira `outro`; ausente é `null`; **nunca recusa o registro**.
- `normalizeCity`: sem acento/caixa/UF final ("Marília - SP" → `marilia`); `sameCity` tolera 1 letra só em nomes com 6+ letras.
- Resultado: agendou (não cancelado) > transbordou (`needsHuman` ou evento) > perdeu > em andamento. Perdeu = motivo do agente, triagem, follow-up declined/stop, `status: lost` ou `IDLE_AFTER_HOURS` (72h).
- Primeira dúvida gravada uma vez; cidade/procedimento/motivo guardam o último valor.
- `MIN_SAMPLE` = 10 leads com cidade para sugerir; fora do raio pede 5+ e 20%+; tema pede 25%+.

## Erros
Nenhum lança: `recordLeadInsight` → `{ status: "saved" | "empty" | "test" | "failed" }`; `getServiceArea` → `null`; `saveServiceArea` → `{ ok: false, error }`.
