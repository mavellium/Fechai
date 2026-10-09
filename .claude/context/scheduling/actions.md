# Scheduling — escrita

- `saveScheduleConfigAction(prev, FormData) → Result`: payload/requireAgent → JSON/Zod → save → revalida agente/agenda. Restrito ligado exige tipos; formulário antigo preserva seleção.
- `saveScheduleConfig(tenantId, agentId, config) → void`: upsert em TenantAction; criar configuração não habilita a ação.
- `createManualAppointment(prev, FormData) → Result`: sessão, validação, conflito, reserva; espelho falho retorna aviso.
- `createAppointment(input)`: reserva local/espelhos; patientName/serviceType/timezone/source; tipo pode usar duração padrão.
- `cancelAppointment(tenantId,id,leadId?)`: cancela local/espelhos mesmo desabilitados.
- `rescheduleAppointment(input)`: troca horário e espelhos; mantém paciente/tipo.

UI: ReminderAudienceSettings oferece todos/seleção múltipla, categorias e nome manual. Carregar não seleciona nem altera duração; vale ao salvar. ScheduleSettings usa useActionState.

- `appointmentConfirmationAction`: produto/sessão/conta ativa, consulta fresca; enviar agora ou manual, mesma intenção automática; toast.
- `testConfirmationMessage`: produto/sessão → `prepareConfirmationTest`, agente da conta/ativo, texto salvo no sandbox; sem envio.
- `claimReminder`/`finishReminder`: posse condicional antes do POST; unknown não autoriza repetição. `markReminderManual` não toma envio em curso.
