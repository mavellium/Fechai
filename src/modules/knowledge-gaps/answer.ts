import { prisma } from "@/lib/prisma";
import { ingestDocument, updateDocument } from "@/modules/knowledge-base/repository";
import { resumeGapContacts, type ResumeSummary } from "./resume";
import { answerDocumentContent, answerDocumentTitle, MAX_ANSWER, MAX_RESUME_MESSAGE } from "./text";

/** Quem respondeu. `role` separa a clínica da Mavellium no histórico e no relatório. */
export type GapActor = { id: string; label: string; role: "clinic" | "mavellium" };

export type GapActionResult =
  | { ok: true; info?: string; resume?: ResumeSummary; documentId?: string }
  | { ok: false; error: string };

function cleanAnswer(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** Guarda o texto sem ensinar o agente — para quem precisa confirmar antes com o dentista. */
export async function saveGapDraft(tenantId: string, gapId: string, raw: unknown): Promise<GapActionResult> {
  const draft = cleanAnswer(raw);
  if (draft.length > MAX_ANSWER) return { ok: false, error: `A resposta passa de ${MAX_ANSWER} caracteres.` };
  const res = await prisma.knowledgeGap.updateMany({
    where: { id: gapId, tenantId, status: "open" },
    data: { draftAnswer: draft || null },
  });
  if (!res.count) return { ok: false, error: "Esta pergunta não está mais aberta." };
  return { ok: true, info: draft ? "Rascunho salvo. O agente ainda não usa esta resposta." : "Rascunho apagado." };
}

/**
 * Aprova a resposta: ela entra na base de conhecimento do agente e o assunto
 * sai da fila. É este o passo que faz o agente passar a responder sozinho.
 *
 * Aprovar de novo uma pergunta já respondida EDITA: o mesmo documento é
 * reescrito (sem duplicar trecho na base) e `answeredAt` fica com a primeira
 * aprovação — é dela que sai o tempo de resposta do relatório.
 *
 * Retomar os contatos é opcional e vem depois, com o documento já salvo: uma
 * falha no WhatsApp não desfaz o que a equipe ensinou.
 */
export async function approveGapAnswer(input: {
  tenantId: string;
  gapId: string;
  answer: unknown;
  actor: GapActor;
  /** Texto para mandar a quem perguntou. Null/vazio = não retomar. */
  resumeMessage?: unknown;
}): Promise<GapActionResult> {
  const answer = cleanAnswer(input.answer);
  if (!answer) return { ok: false, error: "Escreva a resposta antes de aprovar." };
  if (answer.length > MAX_ANSWER) return { ok: false, error: `A resposta passa de ${MAX_ANSWER} caracteres.` };
  const resumeMessage = cleanAnswer(input.resumeMessage);
  if (resumeMessage.length > MAX_RESUME_MESSAGE) {
    return { ok: false, error: `A mensagem para o contato passa de ${MAX_RESUME_MESSAGE} caracteres.` };
  }

  const gap = await prisma.knowledgeGap.findFirst({
    where: { id: input.gapId, tenantId: input.tenantId, status: { in: ["open", "answered"] } },
    select: { id: true, question: true, agentId: true, documentId: true, answeredAt: true },
  });
  if (!gap) return { ok: false, error: "Pergunta não encontrada ou descartada." };

  const title = answerDocumentTitle(gap.question);
  const content = answerDocumentContent(gap.question, answer);

  let documentId: string;
  let docStatus: string;
  try {
    const existing = gap.documentId
      ? await prisma.knowledgeDocument.findFirst({
          where: { id: gap.documentId, tenantId: input.tenantId },
          select: { id: true, agentId: true },
        })
      : null;
    if (existing) {
      const doc = await updateDocument(input.tenantId, existing.agentId, existing.id, { title, content });
      if (!doc) return { ok: false, error: "Não foi possível atualizar a resposta na base." };
      documentId = existing.id;
      docStatus = doc.status;
    } else {
      // Agente apagado: a base que atende o WhatsApp é a do principal.
      const agent = gap.agentId
        ? await prisma.agent.findFirst({ where: { id: gap.agentId, tenantId: input.tenantId, archived: false }, select: { id: true } })
        : null;
      const target = agent ?? await prisma.agent.findFirst({
        where: { tenantId: input.tenantId, archived: false },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (!target) return { ok: false, error: "Crie um agente antes de aprovar respostas." };
      const doc = await ingestDocument({ tenantId: input.tenantId, agentId: target.id, title, content });
      documentId = doc.id;
      docStatus = doc.status;
    }
  } catch (err) {
    console.error("[knowledge-gaps] falha ao gravar a resposta na base", err);
    return { ok: false, error: "Não foi possível salvar a resposta na base agora. Tente de novo." };
  }

  const now = new Date();
  const updated = await prisma.knowledgeGap.updateMany({
    where: { id: gap.id, tenantId: input.tenantId, status: { in: ["open", "answered"] } },
    data: {
      status: "answered",
      answer,
      draftAnswer: null,
      answeredAt: gap.answeredAt ?? now,
      answerUpdatedAt: now,
      answeredById: input.actor.id,
      answeredByLabel: input.actor.label.slice(0, 200),
      answeredByRole: input.actor.role,
      documentId,
      dismissedAt: null,
    },
  });
  if (!updated.count) return { ok: false, error: "A pergunta mudou enquanto você respondia. Recarregue a página." };

  const resume = resumeMessage ? await resumeGapContacts(input.tenantId, gap.id, resumeMessage) : undefined;

  const parts = [
    docStatus === "ready"
      ? "Resposta aprovada. O agente já usa este conteúdo."
      : "Resposta aprovada, mas a base não gerou a busca por semelhança deste texto — o agente só vai encontrá-la quando os embeddings voltarem.",
  ];
  if (resume) parts.push(describeResume(resume));
  return { ok: true, info: parts.join(" "), resume, documentId };
}

export function describeResume(r: ResumeSummary): string {
  if (r.blocked) return r.blocked;
  const bits = [
    r.sent && `${r.sent} ${r.sent === 1 ? "contato recebeu" : "contatos receberam"} a resposta`,
    r.skipped && `${r.skipped} ${r.skipped === 1 ? "ficou" : "ficaram"} de fora`,
    r.failed && `${r.failed} sem confirmação de envio`,
  ].filter(Boolean);
  return bits.length ? `${bits.join(", ")}.` : "Nenhum contato pendente para retomar.";
}

/** Não é pergunta de verdade, ou não cabe ao agente — sai da fila sem ensinar nada. */
export async function dismissGap(tenantId: string, gapId: string): Promise<GapActionResult> {
  const res = await prisma.knowledgeGap.updateMany({
    where: { id: gapId, tenantId, status: "open" },
    data: { status: "dismissed", dismissedAt: new Date() },
  });
  if (!res.count) return { ok: false, error: "Esta pergunta não está mais aberta." };
  return { ok: true, info: "Pergunta descartada." };
}

export async function reopenGap(tenantId: string, gapId: string): Promise<GapActionResult> {
  const res = await prisma.knowledgeGap.updateMany({
    where: { id: gapId, tenantId, status: "dismissed" },
    data: { status: "open", dismissedAt: null },
  });
  if (!res.count) return { ok: false, error: "Esta pergunta não está descartada." };
  return { ok: true, info: "Pergunta de volta à fila." };
}

/** Retoma quem ainda não recebeu a resposta de uma pergunta já respondida. */
export async function resumeAnsweredGap(tenantId: string, gapId: string, raw: unknown): Promise<GapActionResult> {
  const message = cleanAnswer(raw);
  if (!message) return { ok: false, error: "Escreva a mensagem para o contato." };
  if (message.length > MAX_RESUME_MESSAGE) return { ok: false, error: `A mensagem passa de ${MAX_RESUME_MESSAGE} caracteres.` };
  const gap = await prisma.knowledgeGap.findFirst({ where: { id: gapId, tenantId, status: "answered" }, select: { id: true } });
  if (!gap) return { ok: false, error: "Aprove a resposta antes de retomar os contatos." };
  const resume = await resumeGapContacts(tenantId, gapId, message);
  return { ok: true, info: describeResume(resume), resume };
}
