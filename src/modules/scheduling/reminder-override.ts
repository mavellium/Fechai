import {
  DEFAULT_REMINDER_TEMPLATE,
  MAX_REMINDER_MINUTES,
  isValidReminderSendTime,
  type ReminderRule,
} from "./config";

/**
 * Lembretes de UMA consulta, sobrescrevendo os do agente
 * (`Appointment.reminderOverride`).
 *
 * Existe porque o padrão do agente serve ao caso comum, não a toda consulta:
 * um procedimento que exige jejum precisa de um aviso na véspera que a
 * consulta de rotina não precisa, e o paciente que já esqueceu duas vezes
 * merece um lembrete a mais sem que a clínica mude a regra de todo mundo.
 *
 * Três estados, e a diferença entre os dois últimos é o motivo de isto ser
 * `Json?` em vez de uma relação ou uma coluna de lista:
 *
 * | valor | significado |
 * | --- | --- |
 * | `null` | usa os lembretes do agente (o caso comum) |
 * | `[]` | esta consulta **não recebe** lembrete nenhum |
 * | `[...]` | esta consulta usa exatamente estes |
 */

/**
 * Lê o override cru do banco. Devolve `null` quando não há override — o que é
 * diferente de uma lista vazia, que é a escolha "não lembrar desta consulta".
 *
 * Nunca lança: a coluna é Json e pode ter sido escrita por uma versão
 * anterior ou editada à mão, e uma consulta com override quebrado não pode
 * derrubar a varredura inteira do worker.
 */
export function parseReminderOverride(raw: unknown): ReminderRule[] | null {
  if (!Array.isArray(raw)) return null;

  const seen = new Set<number>();
  return raw
    .flatMap((item): ReminderRule[] => {
      if (!item || typeof item !== "object") return [];
      const r = item as Record<string, unknown>;
      const minutes =
        typeof r.minutesBefore === "number" && Number.isFinite(r.minutesBefore)
          ? Math.round(r.minutesBefore)
          : null;
      if (minutes === null || minutes < 1 || minutes > MAX_REMINDER_MINUTES) return [];
      if (seen.has(minutes)) return [];
      seen.add(minutes);
      return [{
        minutesBefore: minutes,
        ...(isValidReminderSendTime(r.sendTime, minutes) ? { sendTime: r.sendTime as string } : {}),
        template:
          typeof r.template === "string" && r.template.trim()
            ? r.template.trim().slice(0, 500)
            : DEFAULT_REMINDER_TEMPLATE,
      }];
    })
    .sort((a, b) => b.minutesBefore - a.minutesBefore);
}

/**
 * Prepara o valor para gravar. `null` limpa o override (a consulta volta a
 * seguir o agente); uma lista — inclusive vazia — passa a valer só para ela.
 */
export function serializeReminderOverride(
  reminders: ReminderRule[] | null,
): ReminderRule[] | null {
  if (reminders === null) return null;
  return reminders.map((r) => ({
    minutesBefore: Math.round(r.minutesBefore),
    ...(r.sendTime ? { sendTime: r.sendTime } : {}),
    template: r.template.trim().slice(0, 500),
  }));
}
