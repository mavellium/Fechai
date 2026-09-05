import { prisma } from "@/lib/prisma";
import type { ClinicorpIntegration } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getCalendarFeatures } from "./features";
import { parseLocalDateTime, partsInZone } from "./time";

/**
 * Integração opcional com o Clinicorp (sistema de gestão de clínicas).
 *
 * Mesmo desenho da do Google (`./google.ts`): a agenda do fechai é a fonte da
 * verdade e o Clinicorp é espelho. A diferença é a autenticação — lá é OAuth,
 * aqui é HTTP Basic com um par fixo (Usuário API + Token API) que a própria
 * clínica gera em *Gerenciar Assinatura › Acesso Externo e Integrações*. Por
 * isso as credenciais são coladas na tela, sem tela de consentimento.
 *
 * Duas coisas acontecem aqui:
 *
 * 1. **Espelho** — o horário marcado no fechai vira um agendamento na agenda da
 *    clínica, ligado ao cadastro do paciente (busca por telefone e cria se não
 *    existir), para a recepção ver o paciente chegando.
 * 2. **Disponibilidade** — antes de oferecer horário, o agente consulta a
 *    agenda real do Clinicorp. Sem isso ele marcaria em cima de um paciente que
 *    a recepção agendou pelo sistema da clínica, que o fechai não conhece.
 *
 * Nenhuma função aqui lança: uma indisponibilidade do Clinicorp não pode
 * derrubar o atendimento nem desfazer um horário já combinado com o lead.
 */

const API_BASE = "https://api.clinicorp.com/rest/v1";

/** A API é de terceiro e entra no meio de uma conversa em tempo real. */
const TIMEOUT_MS = 10_000;

export type ClinicorpCredentials = Pick<
  ClinicorpIntegration,
  "apiUser" | "apiToken" | "subscriberId"
>;

function authHeader(cred: ClinicorpCredentials): string {
  const basic = Buffer.from(`${cred.apiUser}:${cred.apiToken}`).toString("base64");
  return `Basic ${basic}`;
}

type CallResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

/**
 * Uma chamada à API. Devolve o erro em vez de lançar porque quem chama decide
 * o que fazer: o espelho engole, a tela de conexão mostra para a pessoa.
 */
async function call<T>(
  cred: ClinicorpCredentials,
  path: string,
  init: { method?: "GET" | "POST"; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<CallResult<T>> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: authHeader(cred),
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      // 401/403 é credencial: vale uma mensagem que a pessoa entenda na tela.
      const error =
        res.status === 401 || res.status === 403
          ? "Usuário ou token da API recusado pelo Clinicorp."
          : `Clinicorp respondeu ${res.status}. ${text}`;
      return { ok: false, error, status: res.status };
    }

    // Alguns endpoints respondem 200 com corpo vazio.
    const text = await res.text();
    if (!text.trim()) return { ok: true, data: null as T };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (err) {
    const error =
      err instanceof Error && err.name === "TimeoutError"
        ? "O Clinicorp não respondeu a tempo."
        : "Não foi possível falar com o Clinicorp.";
    return { ok: false, error };
  }
}

/** Anota o resultado da última chamada — a tela mostra isso ao cliente. */
async function recordOutcome(tenantId: string, error: string | null): Promise<void> {
  await prisma.clinicorpIntegration
    .update({
      where: { tenantId },
      data: error
        ? { lastErrorAt: new Date(), lastError: error.slice(0, 300) }
        : { lastSyncAt: new Date(), lastErrorAt: null, lastError: null },
    })
    .catch(() => {});
}

/**
 * A integração do tenant com as credenciais **já decifradas**.
 *
 * A decifragem mora aqui, e não em cada chamador, para não existir um caminho em
 * que alguém pegue a linha do banco e mande o token cifrado no header Basic — o
 * erro voltaria como um 401 do Clinicorp, difícil de ligar à causa.
 *
 * Credencial ilegível (chave trocada, linha corrompida) devolve `null`: para o
 * resto do módulo é o mesmo que "não conectado", e a pessoa reconecta na tela.
 */
async function getIntegration(
  tenantId: string,
  { ignoreFeatureFlag = false }: { ignoreFeatureFlag?: boolean } = {},
): Promise<ClinicorpIntegration | null> {
  const [row, features] = await Promise.all([
    prisma.clinicorpIntegration.findUnique({ where: { tenantId } }).catch(() => null),
    getCalendarFeatures(tenantId),
  ]);
  if (!row) return null;

  // Desabilitar em /integracoes precisa PARAR a sincronização, não só esconder
  // o card: a checagem mora aqui, no caminho por onde toda chamada passa.
  //
  // A exceção é limpar o que já foi enviado (`ignoreFeatureFlag`): cancelar um
  // horário aqui tem que sumir com ele lá mesmo depois de desabilitar, senão
  // fica um paciente fantasma na agenda da clínica.
  if (!features.clinicorpEnabled && !ignoreFeatureFlag) return null;

  const apiUser = decryptSecret(row.apiUser);
  const apiToken = decryptSecret(row.apiToken);
  if (!apiUser || !apiToken) {
    console.error(`[clinicorp] credenciais ilegíveis para o tenant ${tenantId}`);
    return null;
  }

  return { ...row, apiUser, apiToken };
}

// ---------------------------------------------------------------------------
// Conferência de credenciais e dados de apoio (usados pela tela de conexão)
// ---------------------------------------------------------------------------

export type ClinicorpBusiness = { id: string; name: string };
export type ClinicorpProfessional = { id: string; name: string };

/**
 * As credenciais funcionam? Usa `/business/list` como ping: é o endpoint mais
 * barato que já exige o `subscriber_id`, então valida os três campos de uma vez
 * e ainda devolve as clínicas para a pessoa escolher qual recebe os horários.
 */
export async function verifyClinicorpCredentials(
  cred: ClinicorpCredentials,
): Promise<{ ok: true; businesses: ClinicorpBusiness[] } | { ok: false; error: string }> {
  const res = await call<unknown>(cred, "/business/list", {
    query: { subscriber_id: cred.subscriberId },
  });
  if (!res.ok) return { ok: false, error: res.error };

  const rows = Array.isArray(res.data) ? res.data : [];
  const businesses = rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      // `Name` é o nome fantasia; `BusinessName`, a razão social. Um ou outro.
      name: String(r.Name || r.BusinessName || "Clínica"),
    };
  });
  return { ok: true, businesses: businesses.filter((b) => b.id) };
}

/**
 * As clínicas do assinante já conectado — para o seletor de unidade.
 *
 * Existe além de `verifyClinicorpCredentials` porque a tela não tem (nem deve
 * ter) as credenciais em mãos: elas estão cifradas no banco e só este módulo as
 * decifra. Lista vazia quando não há conexão ou a chamada falhou; a tela cai no
 * campo escondido com o valor já salvo.
 */
export async function listClinicorpBusinesses(tenantId: string): Promise<ClinicorpBusiness[]> {
  const integration = await getIntegration(tenantId);
  if (!integration) return [];
  const res = await verifyClinicorpCredentials(integration);
  return res.ok ? res.businesses : [];
}

/** Profissionais da conta — a tela usa para escolher o dentista padrão. */
export async function listClinicorpProfessionals(
  tenantId: string,
): Promise<ClinicorpProfessional[]> {
  const integration = await getIntegration(tenantId);
  if (!integration) return [];

  const res = await call<unknown>(integration, "/professional/list_all_professionals", {
    query: { subscriber_id: integration.subscriberId },
  });
  if (!res.ok) return [];

  const rows = Array.isArray(res.data) ? res.data : [];
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return { id: String(r.id ?? ""), name: String(r.name ?? "") };
    })
    .filter((p) => p.id && p.name);
}

// ---------------------------------------------------------------------------
// Paciente
// ---------------------------------------------------------------------------

/**
 * Só os dígitos. O `/patient/get` aceita telefone em qualquer formato, mas o
 * nosso lead vem do WhatsApp como "5547999999999" e mandar assim é o formato
 * que a busca de lá reconhece sem ambiguidade.
 */
function digits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Acha o paciente pelo telefone; cria se não existir.
 *
 * O vínculo com o cadastro é o que faz o agendamento valer alguma coisa para a
 * clínica — sem `Patient_PersonId` o horário entra solto, sem prontuário nem
 * histórico. Quando a busca falha (API fora, telefone estranho), devolve null e
 * o agendamento segue só com nome e telefone, que a API também aceita.
 */
async function resolvePatientId(
  integration: ClinicorpIntegration,
  lead: { name: string | null; phone: string | null },
): Promise<string | null> {
  const phone = lead.phone ? digits(lead.phone) : "";
  if (!phone) return null;

  const found = await call<unknown>(integration, "/patient/get", {
    query: { subscriber_id: integration.subscriberId, Phone: phone },
  });

  if (found.ok && found.data) {
    // O endpoint devolve o objeto direto, mas já respondeu array em algumas
    // contas — normaliza os dois casos.
    const row = (Array.isArray(found.data) ? found.data[0] : found.data) as
      | Record<string, unknown>
      | undefined;
    const id = row?.PatientId;
    // Paciente excluído lá não serve como vínculo: cria um novo.
    if (id && row?.Status !== "DELETED") return String(id);
  }

  const created = await call<unknown>(integration, "/patient/create", {
    method: "POST",
    body: {
      subscriber_id: integration.subscriberId,
      Name: lead.name?.trim() || `Contato ${phone.slice(-4)}`,
      MobilePhone: phone,
      // Sem isto o Clinicorp recusa quando já existe alguém com o mesmo nome —
      // e "João Silva" repetido é rotina numa base de pacientes. O telefone é
      // o que de fato distingue, e ele já foi consultado acima.
      IgnoreSameName: "X",
      Notes: "Cadastro criado pelo atendimento automático (fechai).",
    },
  });

  if (!created.ok) return null;
  const row = (Array.isArray(created.data) ? created.data[0] : created.data) as
    | Record<string, unknown>
    | undefined;
  const id = row?.PatientId ?? row?.id ?? row?.Id;
  return id ? String(id) : null;
}

// ---------------------------------------------------------------------------
// Espelho: criar e cancelar
// ---------------------------------------------------------------------------

export type ClinicorpEventInput = {
  title: string;
  notes?: string | null;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  lead?: { name: string | null; phone: string | null } | null;
};

/** "09:30" no fuso do negócio — a API espera hora local, não UTC. */
function localTime(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "2026-09-05" no fuso do negócio. */
function localDate(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Espelha o compromisso no Clinicorp. Devolve o id do agendamento de lá, ou
 * null quando a conta não está conectada / a sincronização falhou.
 *
 * Nunca lança — ver o comentário no topo do arquivo.
 */
export async function pushAppointmentToClinicorp(
  tenantId: string,
  input: ClinicorpEventInput,
): Promise<string | null> {
  try {
    const integration = await getIntegration(tenantId);
    if (!integration || !integration.syncEnabled) return null;
    if (!integration.businessId) {
      await recordOutcome(tenantId, "Nenhuma clínica escolhida para receber os agendamentos.");
      return null;
    }

    const patientId = input.lead ? await resolvePatientId(integration, input.lead) : null;

    const res = await call<unknown>(integration, "/appointment/create_appointment_by_api", {
      method: "POST",
      body: {
        subscriber_id: integration.subscriberId,
        Clinic_BusinessId: Number(integration.businessId),
        ...(integration.dentistId ? { Dentist_PersonId: Number(integration.dentistId) } : {}),
        ...(patientId ? { Patient_PersonId: Number(patientId) } : {}),
        PatientName: input.lead?.name?.trim() || input.title,
        ...(input.lead?.phone ? { MobilePhone: digits(input.lead.phone) } : {}),
        // A data vai como o dia local em ISO. Mandar o instante UTC cru faria o
        // agendamento cair no dia anterior para horários da manhã no Brasil.
        date: `${localDate(input.startsAt, input.timeZone)}T00:00:00.000Z`,
        fromTime: localTime(input.startsAt, input.timeZone),
        toTime: localTime(input.endsAt, input.timeZone),
        ...(integration.categoryDescription
          ? { CategoryDescription: integration.categoryDescription }
          : {}),
        ...(input.notes ? { Notes: input.notes } : {}),
      },
    });

    if (!res.ok) {
      console.error("[clinicorp] criar agendamento falhou", res.error);
      await recordOutcome(tenantId, res.error);
      return null;
    }

    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as
      | Record<string, unknown>
      | undefined;
    const id = row?.id ?? row?.Id;
    await recordOutcome(tenantId, null);
    return id ? String(id) : null;
  } catch (err) {
    console.error("[clinicorp] criar agendamento falhou", err);
    return null;
  }
}

/** Cancela o agendamento espelhado. Silencioso pelo mesmo motivo do push. */
export async function cancelAppointmentInClinicorp(
  tenantId: string,
  clinicorpAppointmentId: string,
): Promise<void> {
  try {
    const integration = await getIntegration(tenantId, { ignoreFeatureFlag: true });
    if (!integration) return;

    const res = await call<unknown>(integration, "/appointment/cancel_appointment", {
      method: "POST",
      body: { subscriber_id: integration.subscriberId, id: clinicorpAppointmentId },
    });
    if (!res.ok) {
      console.error("[clinicorp] cancelar agendamento falhou", res.error);
      await recordOutcome(tenantId, res.error);
    }
  } catch (err) {
    console.error("[clinicorp] cancelar agendamento falhou", err);
  }
}

// ---------------------------------------------------------------------------
// Disponibilidade
// ---------------------------------------------------------------------------

type ClinicorpBusyBlock = { startsAt: Date; endsAt: Date };

/**
 * O que já está ocupado na agenda da clínica num dia.
 *
 * `includeAssigns` traz também eventos e compromissos do profissional (almoço,
 * bloqueio, reunião) — para o agente esses horários são tão indisponíveis
 * quanto uma consulta. Cancelados e excluídos ficam de fora por padrão, que é o
 * comportamento correto: aquele horário voltou a estar livre.
 */
async function fetchBusyBlocks(
  integration: ClinicorpIntegration,
  day: string,
  timeZone: string,
): Promise<ClinicorpBusyBlock[] | null> {
  const res = await call<unknown>(integration, "/appointment/list", {
    query: {
      subscriber_id: integration.subscriberId,
      from: day,
      to: day,
      businessId: integration.businessId ?? undefined,
      includeAssigns: "X",
    },
  });
  if (!res.ok) return null;

  const rows = Array.isArray(res.data) ? res.data : [];
  const blocks: ClinicorpBusyBlock[] = [];

  for (const row of rows) {
    const r = row as Record<string, unknown>;

    // Filtra por profissional só quando a conta fixou um: com dentista
    // definido, a agenda de um colega não bloqueia o horário. Sem dentista, o
    // agendamento é da clínica e tudo conta.
    if (integration.dentistId && r.Dentist_PersonId) {
      if (String(r.Dentist_PersonId) !== integration.dentistId) continue;
    }

    // Dia inteiro (feriado, férias): bloqueia o dia todo.
    if (r.AllDay) {
      const start = parseLocalDateTime(day, "00:00", timeZone);
      const end = parseLocalDateTime(day, "23:59", timeZone);
      if (start && end) blocks.push({ startsAt: start, endsAt: end });
      continue;
    }

    const from = typeof r.fromTime === "string" ? r.fromTime : null;
    const to = typeof r.toTime === "string" ? r.toTime : null;
    if (!from || !to) continue;

    const startsAt = parseLocalDateTime(day, from, timeZone);
    const endsAt = parseLocalDateTime(day, to, timeZone);
    if (startsAt && endsAt && endsAt > startsAt) blocks.push({ startsAt, endsAt });
  }

  return blocks;
}

/**
 * O horário está ocupado na agenda do Clinicorp?
 *
 * Devolve `false` quando a integração está desligada OU quando a consulta
 * falhou. É a escolha deliberada: o Clinicorp é uma fonte extra de informação,
 * não um porteiro. Se ele estiver fora do ar, o agente segue marcando pelas
 * regras do fechai — o contrário significaria recusar todos os horários e
 * perder o lead por causa da indisponibilidade de um terceiro.
 */
export async function hasClinicorpConflict(
  tenantId: string,
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
): Promise<boolean> {
  try {
    const integration = await getIntegration(tenantId);
    if (!integration || !integration.checkAvailability) return false;

    const blocks = await fetchBusyBlocks(integration, localDate(startsAt, timeZone), timeZone);
    if (!blocks) return false;

    // Mesma regra de sobreposição do `hasConflict` do repository: encostar não
    // é conflito (14:00–15:00 e 15:00–16:00 convivem).
    return blocks.some((b) => startsAt < b.endsAt && endsAt > b.startsAt);
  } catch (err) {
    console.error("[clinicorp] consultar agenda falhou", err);
    return false;
  }
}

/**
 * Grava a conexão com as credenciais cifradas.
 *
 * Único caminho de escrita das credenciais — a cifragem não fica espalhada pela
 * camada de UI, onde seria fácil um formulário novo gravar em texto claro.
 *
 * Reconectar troca as credenciais e preserva as escolhas (clínica, profissional,
 * categoria): quem está corrigindo um token vencido não quer reconfigurar tudo.
 */
export async function saveClinicorpCredentials(
  tenantId: string,
  cred: ClinicorpCredentials,
  defaults: { businessId?: string | null } = {},
): Promise<void> {
  const encrypted = {
    apiUser: encryptSecret(cred.apiUser),
    apiToken: encryptSecret(cred.apiToken),
    subscriberId: cred.subscriberId,
  };

  await prisma.clinicorpIntegration.upsert({
    where: { tenantId },
    create: { tenantId, ...encrypted, businessId: defaults.businessId ?? null },
    update: { ...encrypted, lastError: null, lastErrorAt: null },
  });
}

/** Apaga a conexão. As credenciais são do cliente: sai tudo. */
export async function disconnectClinicorp(tenantId: string): Promise<void> {
  await prisma.clinicorpIntegration.deleteMany({ where: { tenantId } });
}
