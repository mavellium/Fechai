import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { formatBRL } from "@/lib/format";
import type { MonthlyReport } from "./monthly";

/** PDF A4 fixo de uma página, sem dados pessoais de pacientes. */
export async function generateMonthlyPdf(r: MonthlyReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Relatório mensal de ROI - ${r.tenantName} - ${r.month}`);
  doc.setAuthor("Mavellium · Fechai");
  doc.setCreationDate(new Date(r.generatedAt));
  doc.setModificationDate(new Date(r.generatedAt));
  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.1, 0.18), muted = rgb(0.35, 0.39, 0.46), purple = rgb(0.35, 0.27, 0.77);
  const margin = 36, width = 523;
  let y = 806;
  // Helvetica cobre português. Caracteres fora do alfabeto do PDF viram espaço
  // (ex.: emoji em um texto de revisão), sem quebrar a exportação inteira.
  function safe(text: string, font: PDFFont) {
    return [...text.replace(/[\r\t]/g, " ")].map((char) => {
      try { font.encodeText(char); return char; } catch { return " "; }
    }).join("");
  }
  function lines(text: string, maxWidth: number, size: number, font = regular): string[] {
    const result: string[] = [];
    for (const paragraph of safe(text, font).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
        if (line) result.push(line);
        line = "";
        // Também quebra palavras longas/URLs; nenhum texto sai da margem.
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > maxWidth && line) { result.push(line); line = ""; }
          line += char;
        }
      }
      result.push(line);
    }
    return result;
  }
  function text(content: string, x = margin, at = y, size = 9, font = regular, color = ink) {
    page.drawText(safe(content, font), { x, y: at, size, font, color });
  }
  function paragraph(content: string, size = 8, maxWidth = width, x = margin, at = y, color = muted) {
    const wrapped = lines(content, maxWidth, size);
    wrapped.forEach((line, i) => text(line, x, at - i * (size + 2), size, regular, color));
    return wrapped.length * (size + 2);
  }
  function section(title: string) {
    y -= 15;
    text(title, margin, y, 10, bold, purple);
    y -= 15;
  }
  const num = (v: number | null, suffix = "") => v === null ? "Pendente" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`;
  const money = (v: number | null) => v === null ? "Pendente" : formatBRL(v);
  const a = r.current, b = r.previous, c = r.assumptions;
  text("FECHAI / MAVELLIUM", margin, y, 9, bold, purple);
  y -= 23;
  y -= paragraph(r.tenantName, 18, width, margin, y, ink);
  text(`${r.label} · ${r.status === "ready" ? "revisado" : "RASCUNHO"}${r.partial ? " · mês em andamento" : ""}`, margin, y, 9);
  y -= 21;
  page.drawRectangle({ x: margin, y: y - 62, width, height: 78, color: rgb(0.96, 0.95, 0.99) });
  text("1 · ROI DO MÊS (ESTIMADO)", margin + 12, y, 9, bold, purple);
  text(num(a.roiPercent, "%"), margin + 12, y - 31, 28, bold, ink);
  text(`Receita: ${money(a.revenueCents)}`, margin + 205, y - 3, 10, bold);
  text(`Economia: ${money(a.savingsCents)}`, margin + 205, y - 20, 10);
  text(`Investimento: ${money(a.investmentCents)}`, margin + 205, y - 37, 10);
  y -= 78;
  section("2 · O QUE ACONTECEU NO MÊS");
  text("Indicador", margin, y, 8, bold); text(r.month, 343, y, 8, bold); text(r.previousMonth, 456, y, 8, bold); y -= 14;
  const rows = [
    ["Novos contatos atendidos", num(a.newContacts), num(b.newContacts)],
    ["Conversas respondidas · dentro / fora", c.humanHours ? `${a.conversations.inside} / ${a.conversations.outside}` : "Pendente", r.previousAssumptions.humanHours ? `${b.conversations.inside} / ${b.conversations.outside}` : "Pendente"],
    ["Primeira resposta média", num(a.firstResponseSeconds, " s"), num(b.firstResponseSeconds, " s")],
    ["Leads qualificados", `${a.qualified}${a.trackingComplete ? "" : "*"}`, `${b.qualified}${b.trackingComplete ? "" : "*"}`],
    ["Avaliações agendadas · dentro / fora", c.humanHours ? `${a.scheduled.inside} / ${a.scheduled.outside}` : "Pendente", r.previousAssumptions.humanHours ? `${b.scheduled.inside} / ${b.scheduled.outside}` : "Pendente"],
    ["Avaliações realizadas · dentro / fora", c.humanHours ? `${a.attended.inside} / ${a.attended.outside}` : "Pendente", r.previousAssumptions.humanHours ? `${b.attended.inside} / ${b.attended.outside}` : "Pendente"],
    ["Transbordos para humano", `${a.handoffs}${a.trackingComplete ? "" : "*"}`, `${b.handoffs}${b.trackingComplete ? "" : "*"}`],
    ["Perguntas sem resposta", `${a.unanswered}${a.trackingComplete ? "" : "*"}`, `${b.unanswered}${b.trackingComplete ? "" : "*"}`],
    ["Horas assumidas (estimadas)", num(a.assumedHours, " h"), num(b.assumedHours, " h")],
    ["ROI estimado", num(a.roiPercent, "%"), num(b.roiPercent, "%")],
  ];
  for (const [label, value, previous] of rows) {
    text(label, margin, y, 8.5); text(value, 343, y, 8.5, bold); text(previous, 456, y, 8.5, regular, muted);
    page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + width, y: y - 4 }, thickness: 0.35, color: rgb(0.88, 0.89, 0.92) });
    y -= 14;
  }
  const dataNote = [
    !a.trackingComplete || !b.trackingComplete ? "* Cobertura parcial: somente eventos registrados; histórico ausente não significa zero." : "",
    `Sem horário classificado: ${a.conversations.unclassified} conversas; ${a.scheduled.unclassified} agendadas; ${a.attended.unclassified} realizadas. Presença pendente: ${a.attendanceUnknown}; sem tipo: ${a.untypedAppointments}.`,
    !r.previousConfigured ? "Mês anterior sem premissas financeiras/horário; apenas totais operacionais comparáveis." : "",
  ].filter(Boolean).join(" ");
  y -= paragraph(dataNote, 7.3);
  section("3 · DESTAQUES");
  const highlights = a.procedures.slice(0, 4).map((p) => `${p.name}: ${p.qualified} qualificados / ${p.attendedOutside} realizadas fora`).join("; ");
  y -= paragraph(highlights || "Sem procedimentos registrados no período.", 8);
  if (a.procedures.length > 4) y -= paragraph(`Outros procedimentos: ${a.procedures.slice(4).reduce((n, p) => n + p.qualified, 0)} qualificados e ${a.procedures.slice(4).reduce((n, p) => n + p.attendedOutside, 0)} avaliações realizadas fora. Detalhes no painel.`, 7.5);
  y -= paragraph(`Picos: ${a.peaks.map((p) => `${String(p.hour).padStart(2, "0")}h (${p.messages} mensagens)`).join(", ") || "sem mensagens"} · ${c.timezone}.`, 8);
  y -= 14;
  text("4 · O QUE AJUSTAMOS NO AGENTE", margin, y, 9, bold, purple);
  text("5 · PRÓXIMO MÊS", 308, y, 9, bold, purple);
  y -= 14;
  const noteHeight = Math.max(paragraph(r.adjustments || "Aguardando revisão da Mavellium.", 8.2, 246, margin, y, ink), paragraph(r.nextMonth || "Aguardando plano da Mavellium.", 8.2, 246, 308, y, ink));
  y -= noteHeight;
  section("PREMISSAS DO RETORNO ESTIMADO");
  y -= paragraph(`Receita = realizadas de contatos que chegaram fora do horário humano × conversão × ticket, somada por procedimento. Economia = horas assumidas × custo/hora. ROI = (receita + economia - investimento) ÷ investimento.`, 7.5);
  y -= paragraph(`Atendente: ${money(c.attendantMonthlyCents)}/mês ÷ ${num(c.attendantMonthlyHours, " h/mês")}. Horas assumidas: ${a.aiOnlyConversations} conversas sem resposta humana × ${num(c.minutesPerConversation, " min")} ÷ 60. Mensalidade: ${money(c.investmentCents)}.`, 7.5);
  const days = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const time = (v: number) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  y -= paragraph(`Horário humano: ${c.humanHours ? c.humanHours.map((h, i) => `${days[i]} ${h.map((p) => `${time(p.start)}-${time(p.end)}`).join(",") || "fechado"}`).join("; ") : "pendente"}.`, 7.5);
  const premiseY = y;
  let leftHeight = 0, rightHeight = 0;
  c.procedures.forEach((p, i) => {
    const right = i % 2 === 1;
    const height = paragraph(`${p.name}: ticket ${money(p.ticketCents)} · conversão ${num(p.conversionBps === null ? null : p.conversionBps / 100, "%")}`, 7.5, 246, right ? 308 : margin, premiseY - (right ? rightHeight : leftHeight), ink);
    if (right) rightHeight += height + 2; else leftHeight += height + 2;
  });
  y -= Math.max(leftHeight, rightHeight);
  y -= paragraph(`Avaliações: ${c.evaluationTypes.join(", ")}${c.countUntypedAsEvaluations ? " + sem tipo (conferidos)" : ""}. Comparecimento Clinicorp: ${c.completedStatusTypes.join(", ") || "status não definidos"}; variável: ${c.procedureVariable}.`, 7.2);
  if (a.missing.length) y -= paragraph(`Pendências: ${a.missing.join(" ")}`, 7.2);
  if (a.investmentCents === 0) y -= paragraph("Investimento zero: ROI percentual não se aplica.", 7.2);
  if (y < 46) throw new Error("O conteúdo excedeu uma página. Reduza os textos de revisão ou os nomes nas premissas antes de exportar.");
  page.drawLine({ start: { x: margin, y: 38 }, end: { x: margin + width, y: 38 }, thickness: 0.5, color: rgb(0.85, 0.86, 0.9) });
  const due = new Intl.DateTimeFormat("pt-BR", { timeZone: c.timezone }).format(new Date(r.dueAt));
  paragraph(`Decisor: ${r.decisionMaker || "a definir"} · entrega até ${due} · reunião curta`, 7, width, margin, 24);
  return doc.save();
}
