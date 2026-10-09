/** Versioned terms shared by the modal and server. Change the version when the text changes. */
export const QR_RISK_TERMS_VERSION = "2026-10-09.1";
export const QR_RISK_TERMS = [
  { title: "Sobre esta conexão", text: "Esta opção envia confirmações de consultas pelo WhatsApp conectado à Evolution por QR Code. Essa integração não utiliza a API oficial do WhatsApp Business da Meta." },
  { title: "Riscos que você precisa conhecer", text: "O WhatsApp pode restringir os envios, suspender temporariamente ou bloquear permanentemente o número utilizado por integrações não oficiais e automações não autorizadas. Isso pode interromper as confirmações e o atendimento da clínica nesse número." },
  { title: "Limites das proteções", text: "A autorização dos pacientes, o controle de duplicação e as demais proteções de envio não eliminam esse risco. O Fechai não garante que o número ficará livre de restrições ou bloqueios. A aceitação destes termos não transforma a Evolution em uma integração oficial nem representa autorização da Meta." },
  { title: "Alternativa oficial", text: "Para confirmações automáticas recorrentes, recomendamos a API oficial do WhatsApp Business da Meta, com modelos de mensagem aprovados e cumprimento das políticas da plataforma. Mesmo na API oficial, violações dessas políticas podem gerar restrições." },
  { title: "Sua decisão", text: "Ao continuar, você declara que representa a clínica, que os pacientes dos tipos selecionados autorizaram receber suas confirmações e que os pedidos para interromper mensagens serão respeitados. Você compreende os riscos apresentados e escolhe ativar as confirmações por esta conexão." },
] as const;
export const QR_RISK_CHECKBOX_TEXT = "Li e compreendi os termos, aceito os riscos informados e confirmo as declarações acima.";
export const QR_RISK_TERMS_TEXT = QR_RISK_TERMS.map((p) => `${p.title}\n${p.text}`).join("\n\n") + `\n\n${QR_RISK_CHECKBOX_TEXT}`;
export type QrRiskAcceptance = { version: string; termsText: string; responsibleName: string; acceptedAt: string; acceptedByUserId: string };

export function normalizeResponsibleName(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 3 && name.length <= 120 && /\p{L}/u.test(name) ? name : null;
}
export function validateQrRiskConsent(data: FormData): { ok: true; responsibleName: string } | { ok: false; error: string } {
  if (data.get("clinicorpQrRiskAccepted") !== "true") return { ok: false, error: "Leia e aceite os termos de uso da conexão Evolution antes de ativar as confirmações pelo QR." };
  if (data.get("clinicorpQrRiskVersion") !== QR_RISK_TERMS_VERSION) return { ok: false, error: "Os termos foram atualizados. Reabra a configuração e confira a versão atual antes de aceitar." };
  const responsibleName = normalizeResponsibleName(data.get("clinicorpQrResponsibleName"));
  return responsibleName ? { ok: true, responsibleName } : { ok: false, error: "Informe o nome do responsável pelo aceite, com 3 a 120 caracteres." };
}
export function createQrRiskAcceptance(responsibleName: string, userId: string, now = new Date()): QrRiskAcceptance {
  return { version: QR_RISK_TERMS_VERSION, termsText: QR_RISK_TERMS_TEXT, responsibleName, acceptedAt: now.toISOString(), acceptedByUserId: userId };
}
/** Missing/old/malformed terms never authorize the QR option. */
export function parseQrRiskAcceptance(raw: unknown): QrRiskAcceptance | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const a = raw as Record<string, unknown>;
  const name = normalizeResponsibleName(a.responsibleName);
  if (a.version !== QR_RISK_TERMS_VERSION || a.termsText !== QR_RISK_TERMS_TEXT || !name ||
      typeof a.acceptedByUserId !== "string" || !a.acceptedByUserId.trim() || typeof a.acceptedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(a.acceptedAt) || !Number.isFinite(Date.parse(a.acceptedAt))) return undefined;
  return { version: QR_RISK_TERMS_VERSION, termsText: QR_RISK_TERMS_TEXT, responsibleName: name, acceptedAt: a.acceptedAt, acceptedByUserId: a.acceptedByUserId };
}
