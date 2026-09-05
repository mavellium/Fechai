import { prisma } from "@/lib/prisma";
import { getCalendarFeatures } from "./features";

/**
 * Integração opcional com o Google Agenda.
 *
 * OAuth na mão (fetch nos endpoints do Google) em vez da SDK `googleapis`: são
 * três chamadas HTTP e a SDK traz ~50MB de dependências para o build do Next.
 *
 * A integração é POR CONTA (tenant), não da plataforma: as credenciais no env
 * (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) identificam o fechai como app; o
 * token de cada cliente vem do consentimento dele e fica em
 * `CalendarIntegration`.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/** `calendar.events` basta: criar/editar eventos, sem ler a agenda inteira. */
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * URI de retorno registrada no Console do Google. Derivada da URL pública do
 * app para não virar mais uma variável para o cliente errar — `GOOGLE_REDIRECT_URI`
 * continua aceito para ambientes onde a URL do OAuth difere da NEXTAUTH_URL.
 */
export function googleRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return `${base}/api/integrations/google/callback`;
}

/** URL do consentimento. `state` volta no callback — usamos para o tenantId. */
export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    // `offline` + `consent`: sem os dois o Google só manda refresh_token na
    // PRIMEIRA autorização da conta — reconectar depois viria sem ele e a
    // integração morreria em uma hora.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      ...body,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** Troca o `code` do callback pelos tokens e grava a integração do tenant. */
export async function connectGoogleCalendar(tenantId: string, code: string) {
  const token = await postToken({
    code,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });

  let accountEmail: string | null = null;
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (res.ok) accountEmail = ((await res.json()) as { email?: string }).email ?? null;
  } catch {
    // O e-mail é só rótulo na tela — não vale falhar a conexão por causa dele.
  }

  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  const data = {
    provider: "google",
    accountEmail,
    accessToken: token.access_token,
    expiresAt,
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
  };

  await prisma.calendarIntegration.upsert({
    where: { tenantId },
    create: { tenantId, calendarId: "primary", syncEnabled: true, ...data },
    // Reconexão sem refresh_token novo mantém o antigo (spread condicional acima).
    update: data,
  });
}

export async function disconnectGoogleCalendar(tenantId: string) {
  await prisma.calendarIntegration.deleteMany({ where: { tenantId } });
}

export async function getCalendarIntegration(tenantId: string) {
  return prisma.calendarIntegration.findUnique({ where: { tenantId } });
}

/** Access token válido, renovando pelo refresh quando faltar menos de 1 min. */
async function validAccessToken(tenantId: string): Promise<string | null> {
  const integration = await prisma.calendarIntegration.findUnique({ where: { tenantId } });
  if (!integration) return null;
  if (integration.expiresAt.getTime() - Date.now() > 60_000) return integration.accessToken;
  if (!integration.refreshToken) return null;

  try {
    const token = await postToken({
      refresh_token: integration.refreshToken,
      grant_type: "refresh_token",
    });
    await prisma.calendarIntegration.update({
      where: { tenantId },
      data: {
        accessToken: token.access_token,
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
      },
    });
    return token.access_token;
  } catch (err) {
    // Só a mensagem: respostas de erro do OAuth às vezes trazem o próprio
    // refresh token no corpo, e log costuma ir para um agregador de terceiros.
    console.error(
      "[google-calendar] falha ao renovar token:",
      err instanceof Error ? err.message : "erro desconhecido",
    );
    return null;
  }
}

export type GoogleEventInput = {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
};

/**
 * Espelha o compromisso no Google. Retorna o id do evento, ou null quando a
 * conta não está conectada / a sincronização falhou.
 *
 * Nunca lança: a agenda do fechai é a fonte da verdade e o horário já foi
 * combinado com o lead — uma indisponibilidade do Google não pode derrubar o
 * atendimento nem desfazer o agendamento.
 */
export async function pushEventToGoogle(
  tenantId: string,
  input: GoogleEventInput,
): Promise<string | null> {
  try {
    const integration = await prisma.calendarIntegration.findUnique({ where: { tenantId } });
    if (!integration || !integration.syncEnabled) return null;
    // Desabilitar em /integracoes precisa PARAR o espelho, não só esconder o
    // card da agenda.
    if (!(await getCalendarFeatures(tenantId)).googleEnabled) return null;

    const accessToken = await validAccessToken(tenantId);
    if (!accessToken) return null;

    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(integration.calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: input.title,
          description: input.description,
          start: { dateTime: input.startsAt.toISOString(), timeZone: input.timeZone },
          end: { dateTime: input.endsAt.toISOString(), timeZone: input.timeZone },
        }),
      },
    );

    if (!res.ok) {
      console.error("[google-calendar] criar evento falhou", res.status, await res.text());
      return null;
    }
    return ((await res.json()) as { id?: string }).id ?? null;
  } catch (err) {
    console.error("[google-calendar] criar evento falhou", err);
    return null;
  }
}

/** Remove o evento espelhado. Silencioso pelo mesmo motivo do push. */
export async function deleteEventFromGoogle(tenantId: string, eventId: string): Promise<void> {
  try {
    const integration = await prisma.calendarIntegration.findUnique({ where: { tenantId } });
    if (!integration) return;
    const accessToken = await validAccessToken(tenantId);
    if (!accessToken) return;

    await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(integration.calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch (err) {
    console.error("[google-calendar] remover evento falhou", err);
  }
}
