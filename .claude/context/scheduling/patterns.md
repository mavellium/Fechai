# Scheduling — padrões

Config em repository.ts:
```ts
const action = await prisma.tenantAction.findUnique({
  where: { agentId_key: { agentId, key: "schedule_meeting" } },
  select: { config: true },
});
return parseScheduleConfig(action?.config);
```
Aceite em agentes/actions.ts (após validar ownership):
```ts
const consent = validateQrRiskConsent(formData);
if (!consent.ok) return consent;
```
Não confiar em ator/data do formulário. Prova e flag no mesmo save; nenhum
aceite por teste real da clínica. Modal inline FormFeedback + useActionState.
Filtro isReminderTypeAllowed vale inclusive override. Claim antes do POST;
unknown não repete. Manual fora do painel requer “Já enviei”. SQL smoke só
localhost:5438/fechai_reminders_test. Workflow verifica chaves sintéticas e
sandbox. Tests qr-risk-terms/weekly-availability-action/clinicorp-lembrete; UI
isolada desktop/mobile; lint/tsc/build.
