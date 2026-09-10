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
  url.searchParams.set("subscriber_id", cred.subscriberId);
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
    const data = JSON.parse(text) as T;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (row && typeof row === "object" &&
        (row.error || row.Error || row.success === false ||
         /^(ERROR|FAILED|FAILURE)$/i.test(String(row.Status ?? row.status ?? "")))) {
      return { ok: false, error: "O Clinicorp recusou a operação. Confira as credenciais e os dados do agendamento." };
    }
    return { ok: true, data };
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
export type ClinicorpCategory = { id: string; name: string };

/** Metadados para a UI, sem levar credenciais à camada de apresentação. */
export async function getClinicorpStatus(tenantId: string) {
  const integration = await getIntegration(tenantId, { ignoreFeatureFlag: true });
  if (!integration) return null;
  const { subscriberId, businessId, dentistId, categoryDescription, syncEnabled,
    checkAvailability, lastError, lastSyncAt } = integration;
  return { subscriberId, businessId, dentistId, categoryDescription, syncEnabled,
    checkAvailability, lastError, lastSyncAt };
}

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

  if (!Array.isArray(res.data)) return { ok: false, error: "O Clinicorp não devolveu a lista de clínicas. Verifique o acesso da API." };
  const rows = res.data.filter((row) => row && typeof row === "object");
  const businesses = rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      // `Name` é o nome fantasia; `BusinessName`, a razão social. Um ou outro.
      name: String(r.Name || r.BusinessName || "Clínica"),
    };
  });
  const valid = businesses.filter((b) => b.id);
  if (!valid.length) return { ok: false, error: "Nenhuma clínica disponível para este assinante. Verifique as credenciais e as permissões da API." };
  return { ok: true, businesses: valid };
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
): Promise<CallResult<ClinicorpProfessional[]>> {
  const integration = await getIntegration(tenantId);
  if (!integration) return { ok: false, error: "Clinicorp não está conectado." };

  const res = await call<unknown>(integration, "/professional/list_all_professionals", {
    query: { subscriber_id: integration.subscriberId },
  });
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) return { ok: false, error: "O Clinicorp não devolveu a lista de profissionais." };

  const rows = Array.isArray(res.data) ? res.data : [];
  const data = rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      return { id: String(r.id ?? ""), name: String(r.name ?? "") };
    })
    .filter((p) => p.id && p.name);
  return { ok: true, data };
}

async function fetchCategories(cred: ClinicorpCredentials): Promise<CallResult<ClinicorpCategory[]>> {
  const res = await call<unknown>(cred, "/appointment/list_categories");
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) return { ok: false, error: "O Clinicorp não devolveu a lista de categorias." };
  const data = res.data.filter((row) => row && typeof row === "object")
    .map((row) => ({ id: String(row.id ?? ""), name: String(row.Description ?? "") }))
    .filter((row) => row.id && row.name);
  return { ok: true, data };
}

export async function listClinicorpCategories(tenantId: string): Promise<CallResult<ClinicorpCategory[]>> {
  const integration = await getIntegration(tenantId);
  if (!integration) return { ok: false, error: "Clinicorp não está conectado." };
  return fetchCategories(integration);
}

/** Testa acesso sem criar paciente/agendamento e sem apagar erros de envio. */
export async function testClinicorpConnection(tenantId: string): Promise<CallResult<string>> {
  const integration = await getIntegration(tenantId);
  if (!integration) return { ok: false, error: "Clinicorp não está conectado. Revise as credenciais." };
  const result = await verifyClinicorpCredentials(integration);
  if (!result.ok) {
    await recordOutcome(tenantId, result.error);
    return result;
  }
  if (!result.businesses.some((b) => b.id === integration.businessId)) {
    return { ok: false, error: "A API respondeu, mas falta escolher uma clínica disponível e salvar as preferências." };
  }
  return { ok: true, data: "Acesso à clínica confirmado agora. Este teste consulta a API; o envio é confirmado em cada agendamento." };
}

export type ClinicorpSyncResult =
  | { status: "synced"; appointmentId: string }
  | { status: "skipped" }
  | { status: "failed"; error: string };

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
 * Espelha o compromisso no Clinicorp. Distingue envio confirmado, falha e
 * integração desligada para o chamador não prometer um envio que não ocorreu.
 *
 * Nunca lança — ver o comentário no topo do arquivo.
 */
export async function pushAppointmentToClinicorp(
  tenantId: string,
  input: ClinicorpEventInput,
): Promise<ClinicorpSyncResult> {
  const failed = async (error: string): Promise<ClinicorpSyncResult> => {
    await recordOutcome(tenantId, error);
    return { status: "failed", error };
  };
  try {
    const integration = await getIntegration(tenantId);
    if (!integration || !integration.syncEnabled) return { status: "skipped" };
    if (!integration.businessId) {
      return await failed("Nenhuma clínica escolhida para receber os agendamentos.");
    }
    if (!input.lead?.phone || !digits(input.lead.phone)) {
      return await failed("Vincule um contato com telefone para enviar o agendamento ao Clinicorp.");
    }

    // O nome continua no banco por compatibilidade. Resolva o ID real antes de
    // enviar: descrições duplicadas não podem escolher uma categoria ao acaso.
    let categoryId: string | undefined;
    if (integration.categoryDescription) {
      const categories = await fetchCategories(integration);
      if (!categories.ok) return await failed(categories.error);
      const matches = categories.data.filter((c) => c.name === integration.categoryDescription);
      if (matches.length !== 1) {
        return await failed("A categoria escolhida não existe ou tem nome duplicado no Clinicorp. Revise a categoria em Integrações.");
      }
      categoryId = matches[0].id;
    }

    for (const id of [integration.businessId, integration.dentistId, categoryId]) {
      if (id && (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
        return await failed("O identificador da clínica, profissional ou categoria é inválido ou excede a precisão suportada.");
      }
    }

    const patientId = input.lead ? await resolvePatientId(integration, input.lead) : null;
    if (patientId && (!/^\d+$/.test(patientId) || !Number.isSafeInteger(Number(patientId)) || Number(patientId) <= 0)) {
      return await failed("O identificador do paciente é inválido ou excede a precisão suportada.");
    }

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
        ...(categoryId ? { CategoryId: Number(categoryId) } : {}),
        ...(input.notes ? { Notes: input.notes } : {}),
      },
    });

    if (!res.ok) {
      console.error("[clinicorp] criar agendamento falhou", res.error);
      return await failed(res.error);
    }

    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as
      | Record<string, unknown>
      | undefined;
    const id = row?.id ?? row?.Id;
    if (!id || !/^\d+$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 ||
        (row?.Status && row.Status !== "CREATED")) {
      return await failed("O Clinicorp não confirmou a criação com um identificador válido. O horário está salvo no fechai; confira a agenda da clínica antes de tentar novamente.");
    }
    await recordOutcome(tenantId, null);
    return { status: "synced", appointmentId: String(id) };
  } catch (err) {
    console.error("[clinicorp] criar agendamento falhou", err);
    return failed("Não foi possível confirmar o envio do horário ao Clinicorp.");
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
