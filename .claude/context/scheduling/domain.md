# Scheduling — domínio

- `ScheduleConfig`: JSON de TenantAction (`schedule_meeting`); parse seguro e legado.
- `ReminderRule`: minutesBefore/template/sendTime?; horário local, sem LLM.
- Público: reminderAudience (all/selected_types) + reminderTypes; independente de duração. Ausência = all; inválido restringe.
- `Appointment`: serviceType, remindersSent; override null segue conta, [] não envia, lista própria respeita público.
- `ClinicorpAgendaItem`: leitura externa, categoryId/category opcionais; não cria Appointment.
- `ClinicorpReminder`: controle por tenant/id/horário; Meta incerta não repete.

Tipos exatos sem caixa/acento: Avaliação ≠ Reavaliação. Sem tipo não envia na seleção restrita; notas não classificam. Evolution sem histórico exige opt-in específico; Meta exige template.

`AvailabilityUnavailableError` impede reservar sem disponibilidade. IDs Clinicorp = strings; credenciais via getIntegration, nunca Prisma direto.

`ReminderDispatch`: tenant/origem/horário/antecedência único; queued, blocked,
sending, sent, manual, unknown, skipped. Token protege conclusão concorrente.
`ReminderReceipt`: tenant/provedor/messageId/status único, avanço monotônico.
QR opt-in: clinicorpQrEnabled (false), clinicorpReminderCategoryIds e consentAt.
