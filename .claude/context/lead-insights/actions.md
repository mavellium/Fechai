# lead-insights — Actions (escrita)

## record_lead_insight (tool do agente, `tool.ts` + `tools.ts`)
- **Vale para todo agente** com contexto (`variableDefinitions` presente), sem vaga de habilidade; regra `<regra_registro_do_lead>` no prompt de todo turno (`orchestrator.ts`).
- **Campos (todos opcionais, planos):** `city`, `procedure`, `first_question_category/_text`, `loss_reason_category/_text`.
- **Retorno ao LLM:** texto neutro ("Registrado… continue normalmente"); nunca revela o raio nem manda reagir.

## recordLeadInsight(input) → { status, fields } (`record.ts`, nunca lança)
- **Fluxo:** valida cada campo → `conversation.findFirst({ id, tenantId })` → teste = `test` → `upsert` (retenta 1× em P2002) → `updateMany` da 1ª dúvida (`firstQuestionKey: null`).
- **Limpeza:** `cleanCity` (descarta frase/número/link), `scrubInsightText` (tira e-mail/telefone, ≤ 200).
- **Erro comum:** nada válido → `empty` (não grava); conversa de outro tenant → `failed`.

## saveServiceAreaAction(prev, formData) (`configuracoes/actions.ts`)
- **Assinatura:** `(Result | null, FormData) => Promise<{ ok, error?, info? }>`.
- **Validação:** `serviceAreaFormSchema` (cidade-base obrigatória, ≤ 100 cidades, dedupe por chave).
- **Fluxo:** `payloadTooLarge` → `requireTenant` → `saveServiceArea` (upsert) → `recordChange("account.service_area_updated")` → `revalidatePath`.
- **Autorização:** dono da conta; a Mavellium edita personificando.

## Copy-Paste Pattern
```ts
const result = await recordLeadInsight({ tenantId, conversationId, city: args.city });
```
