# Scheduling — leituras

- getScheduleConfig(agentId): chave/config → parse; chamador valida ownership.
- parseScheduleConfig: termos ausentes/antigos/alterados/malformados tornam QR false; nenhuma assinatura inventada.
- loadClinicorpReminderTypesAction: sessão/flag → nomes únicos, sem teto de 12.
- loadClinicorpDurationNamesAction: mesmo acesso; MAX_DURATIONS, sem minutos.
- listClinicorpCategories: getIntegration → list_categories; id/nome.
- listClinicorpAgenda: off/ok/error, cache por período; worker fresh.
- listMonthAppointments: intervalo local, início crescente, agrupa dia.
- hasConflictAnywhere: base+Clinicorp; falha externa não significa vaga.
- getCalendarFeatures: flags, off na ausência/falha.

Página/pulso lê ReminderDispatch por tenant/mês; updatedAt muda versão. Antes
do POST revalida config/consulta/categoria/telefone/conexão. Recibo reconciliado
por tenant/provider/messageId; maior status prevalece. Prova do aceite é config;
audit é best-effort. Categoria ausente restringe, notas não classificam.
