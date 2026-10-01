import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatBRL } from "@/lib/format";
import type { MonthlyReport, SplitCount } from "./monthly";
import { formatDuration, formatMinutes, hoursPremise } from "./monthly-time";
import { formatGapTimeShort as gapTime } from "@/modules/knowledge-gaps/text";
import { SUGGESTION_DISCLAIMER } from "@/modules/lead-insights/summary";
import { QUALITY_FOOTER, QUALITY_KEYS, QUALITY_KEY_LABEL, QUALITY_LABEL, showsSeal, type QualityKey } from "./monthly-quality";
import { unverifiedMetrics } from "./monthly-limitations";
import { NO_INCIDENT, executiveSummary, type ExecTable } from "./monthly-executive";
import { ACTION_STATUS_LABEL } from "./monthly-previous-actions";
import { approvedDocument, isApproved } from "./monthly-document";
import { humanClosedDatesLabel } from "./monthly-format";

/**
 * PDF A4 do relatório mensal, sem dados pessoais de pacientes.
 *
 * Último passo da cadeia: o motor de dados calcula e valida, a IA só redige a
 * partir desses números, e este arquivo apresenta o que foi aprovado. Tudo que
 * entra passa antes por `approvedDocument` — notas internas, registros e
 * correções não estão no documento, então não há o que esconder.
 *
 * Segue o modelo revisado: faixa de título, a frase do mês, quatro números e
 * seis partes, sempre nesta ordem — 01 Atendimento, 02 Agenda (o número
 * principal), 03 O que ajustamos no agente, 04 Qualidade dos leads, 05 O que
 * não saiu como planejado, 06 Próximo mês — mais o retorno estimado, que só
 * existe ligado e calculado (`monthlyFinancial`). No fim, "Como contamos":
 * comparativo, premissas, avisos de cobertura e metodologia.
 *
 * Todos os contatos contam, de dentro e de fora do expediente; a divisão é um
 * detalhe de cada número. O selo "estimativa" só aparece no que é estimado.
 * O documento flui: quebra de página sozinho, nunca recusa a exportação.
 */
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 36, WIDTH = 523, TOP = 806, BOTTOM = 50;

export async function generateMonthlyPdf(report: MonthlyReport): Promise<Uint8Array> {
  // A fronteira do conteúdo aprovado: daqui para baixo só existe o documento.
  const r = approvedDocument(report);
  const doc = await PDFDocument.create();
  doc.setTitle(`Relatório mensal - ${r.tenantName} - ${r.month}`);
  doc.setAuthor("Mavellium · Fechai");
  doc.setCreationDate(new Date(r.generatedAt));
  doc.setModificationDate(new Date(r.generatedAt));
  let page: PDFPage = doc.addPage(A4);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.06, 0.06, 0.06), muted = rgb(0.35, 0.35, 0.35), rule = rgb(0.88, 0.88, 0.88), card = rgb(0.95, 0.95, 0.95);
  const band = rgb(0.07, 0.1, 0.16), white = rgb(1, 1, 1), bandMuted = rgb(0.72, 0.76, 0.84), anchor = rgb(0.89, 0.94, 0.92);
  const [fechai, mavellium] = await Promise.all([
    readFile(join(process.cwd(), "public/brand/fechai-black.png")).then((bytes) => doc.embedPng(bytes)),
    readFile(join(process.cwd(), "public/brand/mavellium-black.png")).then((bytes) => doc.embedPng(bytes)),
  ]);
  const margin = MARGIN, width = WIDTH;
  let y = TOP;
  // Helvetica cobre português. Caracteres fora do alfabeto do PDF viram espaço
  // (ex.: emoji em um texto de revisão), sem quebrar a exportação inteira.
  function safe(text: string, font: PDFFont) {
    return [...text.replace(/[\r\t]/g, " ").replace(/−/g, "-")].map((char) => {
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
  function text(content: string, x = margin, at = y, size = 9, font = regular, color: RGB = ink) {
    page.drawText(safe(content, font), { x, y: at, size, font, color });
  }

  const closed = isApproved(r);
  // Fechado com cobertura parcial, o número sem evidência é entregue assim:
  // "pendente" no documento do decisor soaria como "chega depois".
  const unknown = closed ? "Não verificado" : "Pendente";
  const num = (v: number | null, suffix = "") => v === null ? unknown : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`;
  const total = (s: SplitCount) => s.inside + s.outside + s.unclassified;
  const a = r.current, b = r.previous, c = r.assumptions;
  const monthName = r.label.split(" de ")[0];
  const exec = executiveSummary(r);
  // Retorno estimado desligado ou incalculável: nenhum número em dinheiro sai, em página nenhuma.
  const financial = exec.financial;
  const dateOnly = new Intl.DateTimeFormat("pt-BR", { timeZone: c.timezone });
  // Cada fechamento é uma versão; rascunho não tem versão e diz isso em toda página.
  const version = closed ? (r.approval ? `Versão ${r.approval.version} · aprovada em ${dateOnly.format(new Date(r.approval.approvedAt))}` : "Revisado pela Mavellium") : "RASCUNHO · não aprovado";
  // Selo no documento do cliente: nada no que é medido; "estimativa" no que é
  // estimado; e o aviso onde há o que avisar.
  const seal = (key: QualityKey) => { const q = r.quality?.[key]; return showsSeal(q) ? QUALITY_LABEL[q.status].toUpperCase() : ""; };

  /* ----------------------------- Fluxo ----------------------------- */
  function newPage() {
    page = doc.addPage(A4);
    y = TOP;
    page.drawImage(fechai, { x: margin - 3, y: y - 7, width: 24, height: 24 });
    text("fechai.", margin + 24, y - 1, 15, bold, ink);
    page.drawImage(mavellium, { x: margin + width - 90, y: y - 3, width: 90, height: 90 * mavellium.height / mavellium.width });
    y -= 22;
    text(`${lines(r.tenantName, 330, 8.5)[0] ?? ""} · ${r.label} · ${closed ? "revisado" : "RASCUNHO"}`, margin, y, 8.5, regular, muted);
    y -= 14;
  }
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(); };
  function flow(content: string, size = 8.6, color: RGB = ink, x = margin, maxWidth = width, font = regular) {
    for (const line of lines(content, maxWidth, size, font)) { ensure(size + 3); text(line, x, y, size, font, color); y -= size + 3; }
  }
  const gap = (h = 5) => { y -= h; };
  function part(number: string, title: string, tag = "") {
    ensure(70);
    y -= 14;
    text(number, margin, y, 8, bold, muted);
    text(title, margin + 22, y, 12.5, bold, ink);
    if (tag) text(tag, margin + width - bold.widthOfTextAtSize(safe(tag, bold), 6.5), y + 1, 6.5, bold, muted);
    page.drawLine({ start: { x: margin, y: y - 6 }, end: { x: margin + width, y: y - 6 }, thickness: 0.6, color: rule });
    y -= 20;
  }
  function heading(title: string) { ensure(34); y -= 4; text(title, margin, y, 8.8, bold, ink); y -= 13; }
  function bullets(items: string[], size = 8.6) {
    for (const item of items) { ensure(size + 3); text("•", margin + 2, y, size, regular, ink); flow(item, size, ink, margin + 12, width - 12); gap(1); }
  }
  /**
   * Primeira coluna com o rótulo (quebra de linha); as demais, números à
   * direita. Linha com `estimate` leva a etiqueta — só as estimadas levam.
   */
  function table(t: ExecTable) {
    const columns = t.head.length - 1, colW = columns > 1 ? 62 : 110;
    const labelW = width - columns * colW - 8;
    const right = (i: number) => margin + width - (columns - 1 - i) * colW;
    const tag = "ESTIMATIVA", tagSize = 6, tagW = bold.widthOfTextAtSize(tag, tagSize);
    ensure(56);
    text(t.title, margin, y, 8.8, bold, ink);
    y -= 13;
    t.head.forEach((cell, i) => i === 0 ? text(cell, margin, y, 7, bold, muted) : text(cell, right(i - 1) - bold.widthOfTextAtSize(safe(cell, bold), 7), y, 7, bold, muted));
    page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + width, y: y - 4 }, thickness: 0.5, color: rule });
    y -= 14;
    for (const row of t.rows) {
      const font = row.strong ? bold : regular;
      const wrapped = lines(row.cells[0], labelW, 8.5, font);
      // A etiqueta cabe na última linha do rótulo ou desce para a seguinte.
      const last = wrapped[wrapped.length - 1] ?? "", inline = font.widthOfTextAtSize(last, 8.5) + 6 + tagW <= labelW;
      const rowLines = wrapped.length + (row.estimate && !inline ? 1 : 0);
      ensure(rowLines * 11 + 4);
      wrapped.forEach((line, i) => text(line, margin, y - i * 11, 8.5, font, ink));
      if (row.estimate) text(tag, inline ? margin + font.widthOfTextAtSize(last, 8.5) + 6 : margin, y - (rowLines - 1) * 11 + 1, tagSize, bold, muted);
      row.cells.slice(1).forEach((cell, i) => text(cell, right(i) - bold.widthOfTextAtSize(safe(cell, bold), 8.5), y, 8.5, bold, ink));
      const bottom = y - (rowLines - 1) * 11 - 4;
      page.drawLine({ start: { x: margin, y: bottom }, end: { x: margin + width, y: bottom }, thickness: 0.35, color: rule });
      y = bottom - 10;
    }
    if (t.note) { y += 1; flow(t.note, 7.2, muted); }
    gap(6);
  }

  /* ----------------------------- Abertura ----------------------------- */
  // Faixa escura com o título: o decisor sabe de cara o que está lendo.
  page.drawRectangle({ x: margin, y: 724, width, height: 94, color: band });
  text("FECHAI · RELATÓRIO MENSAL", margin + 16, 798, 7.5, bold, bandMuted);
  const stamp = `${closed ? "REVISADO" : "RASCUNHO · NÃO APROVADO"}${r.partial ? " · MÊS EM ANDAMENTO" : ""}`;
  text(stamp, margin + width - 16 - bold.widthOfTextAtSize(stamp, 7.5), 798, 7.5, bold, bandMuted);
  text(`Resultados de ${monthName}`, margin + 16, 766, 24, bold, white);
  text(lines(`${r.tenantName} · ${r.label}`, width - 32, 10.5)[0] ?? "", margin + 16, 744, 10.5, regular, white);
  y = 708;

  const days = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const clock = (v: number) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  // "seg a sex 08:00-18:00 · sáb 08:00-12:00 · dom fechado": dias seguidos com o mesmo horário viram uma faixa.
  const expedient = (() => {
    if (!c.humanHours) return "";
    const groups: { from: number; to: number; hours: string }[] = [];
    for (const day of [1, 2, 3, 4, 5, 6, 0]) {
      const hours = c.humanHours[day].map((p) => `${clock(p.start)}-${clock(p.end)}`).join(", ") || "fechado";
      const last = groups.at(-1);
      if (last && last.hours === hours) last.to = day; else groups.push({ from: day, to: day, hours });
    }
    return groups.map((g) => `${g.from === g.to ? days[g.from] : `${days[g.from]} a ${days[g.to]}`} ${g.hours}`).join(" · ");
  })();
  flow([
    `Para: ${r.decisionMaker || "a definir"}`, r.operationalContact ? `Cópia: ${r.operationalContact}` : "",
    expedient ? `Expediente da recepção: ${expedient}` : "",
  ].filter(Boolean).join("   ·   "), 7.6, muted);
  const closedDates = humanClosedDatesLabel(c.humanClosedDates);
  if (c.humanHours && closedDates) flow(`Dias sem recepção cadastrados: ${closedDates}. Contados como fora do expediente humano.`, 7.6, muted);
  gap(4);
  flow(exec.lede, 10.5, ink);
  gap(6);

  // Quatro números. Tudo vem de `executiveSummary`, a mesma fonte do painel.
  const cardW = (width - 24) / 4, cardH = 74;
  exec.kpis.forEach((item, i) => {
    const x = margin + i * (cardW + 8);
    page.drawRectangle({ x, y: y - cardH, width: cardW, height: cardH, color: item.anchor ? anchor : card });
    text(item.label, x + 9, y - 14, 7.5, regular, muted);
    text(item.value, x + 9, y - 37, 20, bold, ink);
    lines(item.hint, cardW - 16, 6.8).slice(0, 2).forEach((line, k) => text(line, x + 9, y - 48 - k * 8, 6.8, regular, muted));
    if (item.delta) text(lines(item.delta, cardW - 16, 6.8, bold)[0] ?? "", x + 9, y - 67, 6.8, bold, ink);
  });
  y -= cardH + 12;
  if (r.highlights) { flow(r.highlights, 8.8, ink); gap(2); }

  /* ----------------------------- Seis partes ----------------------------- */
  part("01", "Atendimento");
  exec.attendance.forEach((line) => { flow(line); gap(1); });
  gap(6);
  if (exec.tables.time) table(exec.tables.time);
  if (exec.tables.arrivals) table(exec.tables.arrivals);
  if (exec.tables.reception) table(exec.tables.reception);
  else if (a.reception) { flow("Nenhuma conversa foi passada para a recepção neste mês.", 8.2, muted); gap(4); }
  flow(`Horas com mais mensagens: ${a.peaks.map((p) => `${String(p.hour).padStart(2, "0")}h (${p.messages})`).join(", ") || "sem mensagens no mês"}.`, 7.6, muted);

  part("02", "Agenda", "O NÚMERO PRINCIPAL");
  exec.agenda.forEach((line) => { flow(line); gap(1); });
  gap(6);
  table(exec.tables.funnel);
  if (exec.tables.outcome) table(exec.tables.outcome);
  if (exec.tables.procedures) table(exec.tables.procedures);

  part("03", "O que ajustamos no agente");
  if (exec.previousActions.length) {
    heading("Como foram as ações combinadas no mês anterior");
    for (const item of exec.previousActions) {
      const label = item.status ? ACTION_STATUS_LABEL[item.status].toUpperCase() : "A AVALIAR";
      ensure(24);
      text(label, margin, y + 0.5, 6.5, bold, muted);
      flow(`${item.action}${item.result ? `: ${item.result}` : ""}`, 8.6, ink, margin + 78, width - 78);
      gap(2);
    }
    gap(4);
  }
  flow(exec.adjustments || "Aguardando revisão da Mavellium.", 8.6, exec.adjustments ? ink : muted);
  if (exec.questions) { gap(3); flow(exec.questions); }
  if (r.featuredCase) {
    gap(6);
    heading("Caso do mês");
    if (exec.caseItems.length) flow(exec.caseItems.join("  ·  "), 7.6, muted);
    flow(r.featuredCase, 8.8, ink);
  }

  part("04", "Qualidade dos leads");
  flow(exec.leads);
  gap(6);
  const quality = r.leadQuality;
  if (quality && quality.leads > 0) {
    if (exec.tables.doubts) table(exec.tables.doubts);
    if (exec.tables.reasons) table(exec.tables.reasons);
    if (quality.cities.length) { flow(`Cidades mais citadas: ${quality.cities.slice(0, 6).map((city) => `${city.city} (${city.count}${city.verdict === "out" ? ", fora do raio" : ""})`).join(" · ")}.`, 8.2, ink); gap(3); }
    if (quality.suggestions.length) { heading("Sugestões para o tráfego pago"); bullets(quality.suggestions, 8.4); }
    else if (quality.lowSample) flow(`Poucos leads informaram a cidade (${quality.withCity}); as sugestões só aparecem com pelo menos 10.`, 7.6, muted);
    flow(SUGGESTION_DISCLAIMER, 7.2, muted);
  }

  // Aparece sempre. Sem incidente comprovado nos dados nem texto da revisão,
  // diz isso: ninguém — nem a IA — cria problema para preencher a seção.
  part("05", "O que não saiu como planejado");
  if (exec.unplanned.note) { flow(exec.unplanned.note); gap(3); }
  if (exec.unplanned.incidents.length) bullets(exec.unplanned.incidents);
  if (exec.unplanned.limitations.length) { heading("Limites dos dados deste mês"); bullets(exec.unplanned.limitations, 8.2); }
  const unverified = unverifiedMetrics(r);
  if (unverified.length) flow(`Sem dado para calcular neste fechamento: ${unverified.join(", ")}. Nada foi estimado no lugar.`, 8.2, ink);
  if (exec.unplanned.none) flow(NO_INCIDENT);
  // Fechados antes da lista de limitações: o "missing" de sempre.
  if (!r.limitations && a.missing.length) flow(`A conferir: ${a.missing.join(" ")}`, 8.2, muted);

  part("06", "Próximo mês");
  const actions = r.nextActions ?? [];
  if (actions.length) actions.forEach((item, i) => {
    ensure(26);
    flow(`${i + 1}. ${item.action}`, 8.8, ink, margin, width, bold);
    flow(`${item.owner} · indicador: ${item.indicator}`, 7.6, muted, margin + 10, width - 10);
    gap(3);
  });
  // Relatórios salvos antes das ações estruturadas: o texto livre de sempre.
  else flow(r.nextMonth || "Aguardando o plano da Mavellium.", 8.6, r.nextMonth ? ink : muted);

  // Só aqui vale a regra conservadora: receita apenas de quem chegou com a recepção fechada.
  if (financial) {
    part("+", "Retorno estimado", "BLOCO OPCIONAL");
    flow("Com o ticket e a conversão informados pela clínica, considerando só os pacientes que chegaram com a recepção fechada e compareceram:", 8.4, ink);
    gap(3);
    for (const p of a.procedures.filter((item) => item.attendedOutside > 0)) {
      const premise = c.procedures.find((item) => item.name === p.name);
      flow(`${p.name}: ${p.attendedOutside} ${p.attendedOutside === 1 ? "compareceu" : "compareceram"} × ${premise?.conversionBps == null ? "conversão não informada" : `${(premise.conversionBps / 100).toLocaleString("pt-BR")}% fecham tratamento`} × ${premise?.ticketCents == null ? "ticket não informado" : `${formatBRL(premise.ticketCents)} de ticket`}${p.revenueCents === null ? "" : ` = ${formatBRL(p.revenueCents)}`}`, 8.2, ink, margin + 8, width - 8);
    }
    flow(`Receita estimada: ${formatBRL(financial.revenueCents)}`, 8.4, ink, margin + 8, width - 8, bold);
    flow(`+ economia: ${hoursPremise(r, true)} × custo/hora informado = ${formatBRL(financial.savingsCents)}`, 8.2, ink, margin + 8, width - 8);
    if (financial.investmentCents !== null) flow(`- investimento no Fechai: ${formatBRL(financial.investmentCents)}`, 8.2, ink, margin + 8, width - 8);
    gap(3);
    ensure(24);
    const roi = `ROI ${num(financial.roiPercent, "%")}`;
    text(roi, margin + 8, y - 6, 16, bold, ink);
    text("ESTIMATIVA", margin + 16 + bold.widthOfTextAtSize(roi, 16), y - 4, 6.5, bold, muted);
    y -= 24;
    flow("Estimativa. Não usa faturamento real da clínica e não conta como receita os pacientes que chegaram no expediente.", 7.4, muted);
    if (financial.investmentCents === 0) flow("Investimento zero: ROI percentual não se aplica.", 7.4, muted);
  }

  /* ----------------------------- Como contamos ----------------------------- */
  newPage();
  text("Como contamos", margin, y - 6, 16, bold, ink);
  y -= 22;
  text("Comparativo, premissas e metodologia: de onde vem cada número deste relatório.", margin, y, 9, regular, muted);
  y -= 8;

  const split = (s: SplitCount, hours: unknown) => hours ? `${s.inside} / ${s.outside}` : String(total(s));
  const star = (m: typeof a) => m.trackingComplete ? "" : "*";
  const rows: [QualityKey, string, string, string][] = [
    ["newContacts", "Novos contatos atendidos", num(a.newContacts), num(b.newContacts)],
    ["conversations", "Conversas respondidas · expediente / fora", split(a.conversations, c.humanHours), split(b.conversations, r.previousAssumptions.humanHours)],
    ["firstResponse", "Primeira resposta (agente e equipe) · média / mediana", a.firstResponseSeconds === null ? "—" : `${num(a.firstResponseSeconds, " s")} / ${a.firstResponseMedianSeconds == null ? "—" : num(a.firstResponseMedianSeconds, " s")}`,
      b.firstResponseSeconds === null ? "—" : `${num(b.firstResponseSeconds, " s")} / ${b.firstResponseMedianSeconds == null ? "—" : num(b.firstResponseMedianSeconds, " s")}`],
    ["qualified", "Leads qualificados", `${a.qualified}${star(a)}`, `${b.qualified}${star(b)}`],
    ["scheduled", "Avaliações agendadas · expediente / fora", split(a.scheduled, c.humanHours), split(b.scheduled, r.previousAssumptions.humanHours)],
    ["attended", "Avaliações realizadas · expediente / fora", split(a.attended, c.humanHours), split(b.attended, r.previousAssumptions.humanHours)],
    ["handoffs", "Transferências para a recepção", `${a.handoffs}${star(a)}`, `${b.handoffs}${star(b)}`],
    ["unanswered", "Perguntas sem resposta · tempo p/ responder", `${a.unanswered}${star(a)}${gapTime(a)}`, `${b.unanswered}${star(b)}${gapTime(b)}`],
    ...(a.availability ? [["availability", "Agente no ar", `${num(a.availability.percent, "%")}`, b.availability ? num(b.availability.percent, "%") : "—"] as [QualityKey, string, string, string]] : []),
    // Sem premissa de tempo não há linha de horas; sem retorno estimado, nem de ROI.
    ...(a.assumedHours !== null ? [["assumedHours", "Horas devolvidas à equipe", num(a.assumedHours, " h"), b.assumedHours === null ? "—" : num(b.assumedHours, " h")] as [QualityKey, string, string, string]] : []),
    ...(financial ? [["roi", "ROI", num(a.roiPercent, "%"), b.roiPercent === null ? "—" : num(b.roiPercent, "%")] as [QualityKey, string, string, string]] : []),
  ];
  y -= 14;
  text("COMPARATIVO COM O MÊS ANTERIOR", margin, y, 8.8, bold, ink);
  y -= 15;
  const VALUE_X = 343, PREVIOUS_X = 456;
  text("Indicador", margin, y, 7, bold, muted); text(r.month, VALUE_X, y, 7, bold, muted); text(r.previousMonth, PREVIOUS_X, y, 7, bold, muted);
  page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + width, y: y - 4 }, thickness: 0.5, color: rule });
  y -= 14;
  for (const [key, label, value, previous] of rows) {
    ensure(14);
    text(label, margin, y, 8.5, regular, ink);
    const mark = seal(key);
    if (mark) text(mark, margin + regular.widthOfTextAtSize(safe(label, regular), 8.5) + 6, y + 1, 6, bold, muted);
    text(value, VALUE_X, y, 8.5, bold, ink); text(previous, PREVIOUS_X, y, 8.5, regular, muted);
    page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + width, y: y - 4 }, thickness: 0.35, color: rule });
    y -= 14;
  }
  y -= 2;
  flow([
    r.agentNames?.length ? `Agentes: ${r.agentNames.join(", ")}.` : "Agentes: todos os agentes da conta.",
    !a.trackingComplete || !b.trackingComplete ? "* Só eventos registrados depois da implantação; histórico ausente não significa zero." : "",
    a.conversations.unclassified || a.scheduled.unclassified || a.attended.unclassified ? `Sem horário de chegada: ${a.conversations.unclassified} conversas, ${a.scheduled.unclassified} agendadas, ${a.attended.unclassified} realizadas.` : "",
    !r.previousConfigured ? "Mês anterior sem expediente conferido; apenas os totais são comparáveis." : "",
    r.manualAdjustments ? "Inclui indicadores conferidos e ajustados pela Mavellium." : "",
  ].filter(Boolean).join(" "), 7.5, muted);

  const t = a.time;
  if (t?.toSchedule.count) { gap(4); flow(`Do primeiro contato ao agendamento: média de ${formatMinutes(t.toSchedule.averageMinutes)}, mediana de ${formatMinutes(t.toSchedule.medianMinutes)} e ${num(t.toSchedule.averageMessages)} mensagens trocadas.`, 8, ink); }

  y -= 14; ensure(40);
  text(financial ? "PREMISSAS E RETORNO ESTIMADO" : "PREMISSAS DO RELATÓRIO", margin, y, 8.8, bold, ink);
  y -= 15;
  // Premissa vazia é "não informada": "não verificado" é para número, não para dado que a clínica passa.
  const given = (v: number | null) => v === null ? "não informado" : formatBRL(v);
  if (financial) flow(`Atendente: ${given(c.attendantMonthlyCents)}/mês ÷ ${c.attendantMonthlyHours === null ? "carga não informada" : `${c.attendantMonthlyHours} h/mês`}. Mensalidade: ${given(c.investmentCents)}.`, 8, ink);
  if (a.assumedHours !== null) flow(`Horas devolvidas (estimativa): ${hoursPremise(r, true)} = ${formatDuration(a.assumedHours * 3600)}.`, 8, ink);
  flow(`Expediente da recepção: ${expedient || "não conferido com a clínica"}. É por ele que cada contato é classificado como no expediente ou fora, nunca por faixa fixa de horário.`, 8, ink);
  if (financial && c.procedures.length) flow(`Procedimentos: ${c.procedures.map((p) => `${p.name}: ticket ${given(p.ticketCents)} · conversão ${p.conversionBps === null ? "não informada" : `${(p.conversionBps / 100).toLocaleString("pt-BR")}%`}`).join("; ")}.`, 8, ink);
  flow(`Avaliações: ${c.evaluationTypes.join(", ")}${c.countUntypedAsEvaluations ? " + sem tipo (conferidos)" : ""}. Comparecimento Clinicorp: ${c.completedStatusTypes.join(", ") || "status não definidos"}; variável: ${c.procedureVariable}.`, 7.5, muted);

  // Só o que precisa de aviso: número medido não é listado um a um.
  const flagged = QUALITY_KEYS.filter((key) => showsSeal(r.quality?.[key]));
  if (flagged.length) {
    y -= 14; ensure(40);
    text("ESTIMATIVAS E AVISOS DE COBERTURA", margin, y, 8.8, bold, ink);
    y -= 15;
    for (const key of flagged) {
      const q = r.quality![key]!;
      flow(`${QUALITY_KEY_LABEL[key]}: ${QUALITY_LABEL[q.status].toLowerCase()}${q.reasons[0] ? ` — ${q.reasons[0].replace(/^Estimativa: /, "")}` : ""}`, 7.5, q.status === "estimated" ? muted : ink);
    }
    y -= 2; flow(QUALITY_FOOTER, 7, muted);
  }

  y -= 14; ensure(40);
  text("METODOLOGIA", margin, y, 8.8, bold, ink);
  y -= 15;
  flow("Todos os contatos entram, de dentro e de fora do expediente: o agente atende todos igual, e a divisão por expediente é um detalhe de cada número. As conversas são contadas pela primeira interação respondida no mês. Nas avaliações, o horário é o da primeira mensagem do contato, antes da marcação. Agendadas entram pelo mês da marcação; realizadas, pelo mês da consulta, e só com comparecimento confirmado (agendado ou confirmado nunca é presença; sem confirmação nunca é falta). Cancelamentos, testes e marcações manuais ficam fora.", 7.5, muted);
  flow("Recepção: da transferência feita pelo agente até a primeira resposta de uma pessoa, em tempo corrido, até o fim do mês. Agente no ar: quedas da conexão do WhatsApp confirmadas pelo provedor, contadas do momento em que o monitoramento viu a queda; contatos afetados são os que escreveram durante a queda ou nos 15 minutos seguintes à volta. Tempo devolvido: áudios são medidos; o tempo de leitura e resposta é estimativa, pelo tempo por mensagem informado.", 7.5, muted);
  flow("Qualidade dos leads: leads reais criados no mês. Cidade, dúvida e motivo são o que o contato disse ao agente, sem dedução. Cada lead que não agendou tem um único motivo principal: o que ele disse, a triagem, o follow-up recusado ou 72 horas sem resposta.", 7.5, muted);
  if (financial) flow("Retorno estimado: receita = avaliações realizadas de contatos que chegaram com a recepção fechada × conversão × ticket, por procedimento. Economia = horas devolvidas × custo/hora do atendente. ROI = (receita + economia - investimento) ÷ investimento.", 7.5, muted);

  // Rodapé de todas as páginas, desenhado no fim para saber o total.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: margin, y: 38 }, end: { x: margin + width, y: 38 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    const left = safe(`${r.tenantName} · ${r.label} · ${version} · preparado pela Mavellium`, regular);
    p.drawText(lines(left, width - 70, 7)[0] ?? "", { x: margin, y: 24, size: 7, font: regular, color: muted });
    p.drawText(`Página ${i + 1} de ${pages.length}`, { x: margin + width - 52, y: 24, size: 7, font: regular, color: muted });
  });
  return doc.save();
}
