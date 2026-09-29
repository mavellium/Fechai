# Scheduling — escrita

- `saveScheduleConfigAction(prev, FormData) → Result`: payload/requireAgent → JSON/Zod → save → revalida agente/agenda. Restrito ligado exige tipos; formulário antigo preserva seleção.
- `saveScheduleConfig(tenantId, agentId, config) → void`: upsert em TenantAction; criar configuração não habilita a ação.
- `createManualAppointment(prev, FormData) → Result`: sessão, validação, conflito, reserva; espelho falho retorna aviso.
- `createAppointment(input)`: reserva local/espelhos; patientName/serviceType/timezone/source; tipo pode usar duração padrão.
- `cancelAppointment(tenantId,id,leadId?)`: cancela local/espelhos mesmo desabilitados.
- `rescheduleAppointment(input)`: troca horário e espelhos; mantém paciente/tipo.

UI: ReminderAudienceSettings oferece todos/seleção múltipla, categorias e nome manual. Carregar não seleciona nem altera duração; vale ao salvar. ScheduleSettings usa useActionState.
