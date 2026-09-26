/** Erro da consulta anterior à reserva; espelhos nunca desfazem consultas por falha de rede. */
export class AvailabilityUnavailableError extends Error {
  constructor() {
    super("Não foi possível conferir a disponibilidade da agenda da clínica. Tente novamente antes de confirmar um horário.");
    this.name = "AvailabilityUnavailableError";
  }
}
