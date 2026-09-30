import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatBRL } from "@/lib/format";
import type { MonthlyReport, SplitCount } from "./monthly";
import { formatDuration, formatMinutes, hoursPremise, timeHeadline } from "./monthly-time";
import { formatGapTimeShort as gapTime } from "@/modules/knowledge-gaps/text";
import { SUGGESTION_DISCLAIMER, leadQualityHeadline } from "@/modules/lead-insights/summary";
import { QUALITY_FOOTER, QUALITY_KEYS, QUALITY_KEY_LABEL, QUALITY_LABEL, type QualityKey } from "./monthly-quality";
import { unverifiedMetrics } from "./monthly-limitations";

/**
 * PDF A4 sem dados pessoais de pacientes, em duas partes:
 *
 * - **Página 1 — Resumo executivo**, para o decisor: quatro números (contatos
 *   atendidos, conversas só com IA, mensagens respondidas, ROI), o resumo do
 *   período e até três próximas ações com responsável e indicador. Layout fixo;
 *   o conteúdo é limitado pelos campos (resumo, ações), então sempre cabe.
 * - **Páginas seguintes — Análise detalhada**: dados de atendimento, funil,
 *   tempo devolvido, procedimentos e picos, ajustes no agente, qualidade dos
 *   leads, premissas financeiras, cobertura dos indicadores (com as
 *   limitações) e metodologia. Fluem: quebram de página quando falta espaço.
 */
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 36, WIDTH = 523, TOP = 806, BOTTOM = 50;

export async function generateMonthlyPdf(r: MonthlyReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Relatório mensal de ROI - ${r.tenantName} - ${r.month}`);
  doc.setAuthor("Mavellium · Fechai");
  doc.setCreationDate(new Date(r.generatedAt));
  doc.setModificationDate(new Date(r.generatedAt));
  let page: PDFPage = doc.addPage(A4);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.06, 0.06, 0.06), muted = rgb(0.35, 0.35, 0.35), rule = rgb(0.88, 0.88, 0.88), card = rgb(0.95, 0.95, 0.95);
  const band = rgb(0.07, 0.1, 0.16), white = rgb(1, 1, 1), bandMuted = rgb(0.72, 0.76, 0.84);
  const warnBg = rgb(0.99, 0.91, 0.85), warn = rgb(0.72, 0.3, 0.08);
  const [fechai, mavellium] = await Promise.all([
    readFile(join(process.cwd(), "public/brand/fechai-black.png")).then((bytes) => doc.embedPng(bytes)),
    readFile(join(process.cwd(), "public/brand/mavellium-black.png")).then((bytes) => doc.embedPng(bytes)),
  ]);
  const margin = MARGIN, width = WIDTH;
  let y = TOP;
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
  function text(content: string, x = margin, at = y, size = 9, font = regular, color: RGB = ink) {
    page.drawText(safe(content, font), { x, y: at, size, font, color });
  }
  const measure = (content: string, size = 8, maxWidth = width, font = regular) => lines(content, maxWidth, size, font).length * (size + 2);
  function paragraph(content: string, size = 8, maxWidth = width, x = margin, at = y, color: RGB = muted, font = regular) {
    const wrapped = lines(content, maxWidth, size, font);
    wrapped.forEach((line, i) => text(line, x, at - i * (size + 2), size, font, color));
    return wrapped.length * (size + 2);
  }
  const hr = (at = y) => page.drawLine({ start: { x: margin, y: at }, end: { x: margin + width, y: at }, thickness: 0.35, color: rule });

  const closed = r.status === "ready";
  // Fechado com cobertura parcial, o número sem evidência é entregue assim:
  // "pendente" no documento do decisor soaria como "chega depois".
  const unknown = closed ? "Não verificado" : "Pendente";
  const num = (v: number | null, suffix = "") => v === null ? unknown : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`;
  const money = (v: number | null) => v === null ? unknown : formatBRL(v);
  const total = (s: SplitCount) => s.inside + s.outside + s.unclassified;
  const a = r.current, b = r.previous, c = r.assumptions, t = a.time;
  const limitations = r.limitations ?? [];
  // Selo de qualidade do painel, em texto: acompanha o número até o PDF.
  // Relatório fechado antes do selo não tem `quality` e sai sem ele.
  const status = (key: QualityKey) => { const q = r.quality?.[key]; return q ? QUALITY_LABEL[q.status].toUpperCase() : ""; };
  const monthName = r.label.split(" de ")[0];

  /* ---------------------------- Página 1 ---------------------------- */
  // Faixa escura com o título: o decisor sabe de cara o que está lendo.
  page.drawRectangle({ x: margin, y: 724, width, height: 94, color: band });
  text("FECHAI · RELATÓRIO MENSAL", margin + 16, 798, 7.5, bold, bandMuted);
  const stamp = `${closed ? "REVISADO" : "RASCUNHO"}${r.partial ? " · MÊS EM ANDAMENTO" : ""}`;
  text(stamp, margin + width - 16 - bold.widthOfTextAtSize(stamp, 7.5), 798, 7.5, bold, bandMuted);
  text(`Resultados de ${monthName}`, margin + 16, 766, 24, bold, white);
  text(lines(`${r.tenantName} · ${r.label}`, width - 32, 10.5)[0] ?? "", margin + 16, 744, 10.5, regular, white);
  y = 706;
  text("Página 1 — Resumo executivo", margin, y, 8, regular, muted);
  y -= 12;

  // Quatro números. Sem valor, o ROI diz por quê, num selo.
  const cardW = (width - 10) / 2, cardH = 62;
  const roiNull = a.roiPercent === null;
  const cards: { label: string; value: string; badge?: { text: string; alert: boolean } }[] = [
    { label: "Contatos atendidos", value: num(total(a.conversations)) },
    { label: "Conversas só com IA", value: num(a.aiOnlyConversations) },
    { label: "Mensagens respondidas", value: t ? num(t.textMessages + t.audios) : "Não medido" },
    { label: "ROI estimado", value: num(a.roiPercent, "%"),
      badge: roiNull ? { text: "PREMISSAS INCOMPLETAS", alert: true } : status("roi") ? { text: status("roi"), alert: false } : undefined },
  ];
  cards.forEach((item, i) => {
    const x = margin + (i % 2) * (cardW + 10), top = y - Math.floor(i / 2) * (cardH + 10);
    page.drawRectangle({ x, y: top - cardH, width: cardW, height: cardH, color: card });
    text(item.label, x + 12, top - 16, 8.5, regular, muted);
    const isText = !/^[\d.,%\s-]+$/.test(item.value);
    text(item.value, x + 12, top - (isText ? 38 : 44), isText ? 16 : 24, bold, ink);
    if (item.badge) {
      const size = 6.5, w = bold.widthOfTextAtSize(item.badge.text, size) + 10;
      page.drawRectangle({ x: x + 12, y: top - 58, width: w, height: 11, color: item.badge.alert ? warnBg : rgb(0.9, 0.9, 0.9) });
      text(item.badge.text, x + 17, top - 55, size, bold, item.badge.alert ? warn : muted);
    }
  });
  y -= 2 * cardH + 10 + 16;
  y -= paragraph(`Receita estimada ${money(a.revenueCents)} · Economia estimada ${money(a.savingsCents)} · Mensalidade ${money(a.investmentCents)}. Valores estimados; o cálculo está nas páginas seguintes.`, 8.5, width, margin, y, ink);
  if (t) { y -= 2; y -= paragraph(timeHeadline(t, total(a.conversations), a.assumedHours, a.savingsCents), 8.5, width, margin, y, muted); }
  y -= 6; hr(); y -= 22;

  text("Resumo do período", margin, y, 13, bold, ink);
  y -= 16;
  y -= r.highlights ? paragraph(r.highlights, 9.5, width, margin, y, ink) : paragraph("Aguardando a síntese da Mavellium.", 9.5, width, margin, y, muted);
  if (limitations.length) {
    y -= 4;
    y -= paragraph(`${closed ? "Fechado com cobertura parcial" : "Cobertura parcial"}: ${limitations.length} ${limitations.length === 1 ? "limitação" : "limitações"}; números sem evidência saem como NÃO VERIFICADO. Detalhes em "Cobertura dos indicadores".`, 8, width, margin, y, warn);
  } else if (!r.limitations && a.missing.length) {
    y -= 4; y -= paragraph(`Pendências: ${a.missing.join(" ")}`, 8, width, margin, y, warn);
  }
  y -= 6; hr(); y -= 22;

  text("Próximas ações", margin, y, 13, bold, ink);
  y -= 10;
  const actions = r.nextActions ?? [];
  if (actions.length) {
    actions.forEach((item, i) => {
      const titleH = measure(item.action, 9.5, width - 44, bold), metaH = measure(`Responsável: ${item.owner} · Indicador: ${item.indicator}`, 8, width - 44);
      const h = titleH + metaH + 14;
      page.drawRectangle({ x: margin, y: y - h, width, height: h, color: card });
      text(String(i + 1), margin + 12, y - 16, 11, bold, ink);
      const at = y - 16;
      paragraph(item.action, 9.5, width - 44, margin + 32, at, ink, bold);
      paragraph(`Responsável: ${item.owner} · Indicador: ${item.indicator}`, 8, width - 44, margin + 32, at - titleH, muted);
      y -= h + 6;
    });
  } else {
    // Relatórios salvos antes das ações estruturadas: o texto livre de sempre.
    y -= 6;
    y -= paragraph(r.nextMonth || "Aguardando o plano da Mavellium.", 9.5, width, margin, y, r.nextMonth ? ink : muted);
  }
  if (y < BOTTOM) throw new Error("O resumo executivo excedeu a página 1. Reduza o resumo do período ou as próximas ações.");

  /* ---------------------- Páginas seguintes (fluem) ---------------------- */
  function newPage() {
    page = doc.addPage(A4);
    y = TOP;
    page.drawImage(fechai, { x: margin - 3, y: y - 7, width: 24, height: 24 });
    text("fechai.", margin + 24, y - 1, 15, bold, ink);
    page.drawImage(mavellium, { x: margin + width - 90, y: y - 3, width: 90, height: 90 * mavellium.height / mavellium.width });
    y -= 22;
    text(`${lines(r.tenantName, 330, 8.5)[0] ?? ""} · ${r.label} · ${closed ? "revisado" : "RASCUNHO"}`, margin, y, 8.5, regular, muted);
    y -= 12;
  }
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(); };
  function section(title: string, first = 30) {
    ensure(28 + first);
    y -= 16;
    text(title, margin, y, 10, bold, ink);
    y -= 15;
  }
  function flow(content: string, size = 8, color: RGB = muted, x = margin, maxWidth = width) {
    const wrapped = lines(content, maxWidth, size);
    for (const line of wrapped) { ensure(size + 2); text(line, x, y, size, regular, color); y -= size + 2; }
  }
  function row(cells: [string, number, number?, RGB?, PDFFont?][]) {
    ensure(14);
    for (const [content, x, size = 8.5, color = ink, font = regular] of cells) text(content, x, y, size, font, color);
    page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + width, y: y - 4 }, thickness: 0.35, color: rule });
    y -= 14;
  }

  newPage();
  text("Análise detalhada", margin, y - 6, 16, bold, ink);
  y -= 22;
  text("Evidências e metodologia: de onde vem cada número da página 1.", margin, y, 9, regular, muted);
  y -= 6;

  section("DADOS DE ATENDIMENTO");
  const QUALITY_X = 250;
  row([["Indicador", margin, 8, ink, bold], ...(r.quality ? [["Qualidade", QUALITY_X, 8, ink, bold] as [string, number, number, RGB, PDFFont]] : []), [r.month, 343, 8, ink, bold], [r.previousMonth, 456, 8, ink, bold]]);
  const split = (s: SplitCount, hours: unknown) => hours ? `${s.inside} / ${s.outside}` : unknown;
  const star = (m: typeof a) => m.trackingComplete ? "" : "*";
  const rows: [QualityKey, string, string, string][] = [
    ["newContacts", "Novos contatos atendidos", num(a.newContacts), num(b.newContacts)],
    ["conversations", "Conversas respondidas · dentro / fora", split(a.conversations, c.humanHours), split(b.conversations, r.previousAssumptions.humanHours)],
    ["firstResponse", "Primeira resposta média", num(a.firstResponseSeconds, " s"), num(b.firstResponseSeconds, " s")],
    ["qualified", "Leads qualificados", `${a.qualified}${star(a)}`, `${b.qualified}${star(b)}`],
    ["scheduled", "Avaliações agendadas · dentro / fora", split(a.scheduled, c.humanHours), split(b.scheduled, r.previousAssumptions.humanHours)],
    ["attended", "Avaliações realizadas · dentro / fora", split(a.attended, c.humanHours), split(b.attended, r.previousAssumptions.humanHours)],
    ["handoffs", "Transbordos para humano", `${a.handoffs}${star(a)}`, `${b.handoffs}${star(b)}`],
    ["unanswered", "Perguntas sem resposta · tempo p/ responder", `${a.unanswered}${star(a)}${gapTime(a)}`, `${b.unanswered}${star(b)}${gapTime(b)}`],
    ["assumedHours", "Horas devolvidas à equipe (estimadas)", num(a.assumedHours, " h"), num(b.assumedHours, " h")],
    ["roi", "ROI estimado", num(a.roiPercent, "%"), num(b.roiPercent, "%")],
  ];
  for (const [key, label, value, previous] of rows) row([[label, margin], [status(key), QUALITY_X, 6.5, muted, bold], [value, 343, 8.5, ink, bold], [previous, 456, 8.5, muted]]);
  y -= 2;
  flow([
    r.agentNames?.length ? `Agentes: ${r.agentNames.join(", ")}.` : "Agentes: todos os agentes da conta.",
    !a.trackingComplete || !b.trackingComplete ? "* Cobertura parcial: somente eventos registrados; histórico ausente não significa zero." : "",
    `Sem horário: ${a.conversations.unclassified} conversas, ${a.scheduled.unclassified} agendadas, ${a.attended.unclassified} realizadas; presença pendente: ${a.attendanceUnknown}; sem tipo: ${a.untypedAppointments}.`,
    !r.previousConfigured ? "Mês anterior sem premissas financeiras/horário; apenas totais operacionais comparáveis." : "",
    Object.keys(r.metricOverrides?.current ?? {}).length || Object.keys(r.metricOverrides?.previous ?? {}).length ? "Inclui dados ajustados manualmente pela Mavellium; origens e detalhes disponíveis no painel." : "",
  ].filter(Boolean).join(" "), 7.5);

  // Funil: cada etapa sobre a anterior. As etapas não são o mesmo grupo de
  // pessoas (agendadas pelo mês da marcação, realizadas pelo da consulta), e a
  // nota diz isso para ninguém ler como coorte.
  section("FUNIL DE CONVERSÃO");
  const pct = (n: number, d: number) => d > 0 ? `${Math.round(n / d * 100)}%` : "—";
  const steps: [string, number][] = [
    ["Contatos atendidos", total(a.conversations)], [`Leads qualificados${star(a)}`, a.qualified],
    ["Avaliações agendadas", total(a.scheduled)], ["Avaliações realizadas", total(a.attended)],
  ];
  row([["Etapa", margin, 8, ink, bold], ["Quantidade", 250, 8, ink, bold], ["Da etapa anterior", 343, 8, ink, bold], ["Dos contatos", 456, 8, ink, bold]]);
  steps.forEach(([label, n], i) => row([[label, margin], [String(n), 250, 8.5, ink, bold], [i ? pct(n, steps[i - 1][1]) : "—", 343], [i ? pct(n, steps[0][1]) : "100%", 456, 8.5, muted]]));
  y -= 2;
  flow(`Realizadas: ${a.attendanceUnknown} ${a.attendanceUnknown === 1 ? "avaliação aguarda" : "avaliações aguardam"} confirmação de comparecimento. Agendadas contam pelo mês da marcação e realizadas pelo mês da consulta: as etapas não são exatamente o mesmo grupo de pessoas.`, 7.5);

  if (t) {
    section("TEMPO QUE O FECHAI DEVOLVEU PARA SUA EQUIPE (ESTIMADO)");
    flow(timeHeadline(t, total(a.conversations), a.assumedHours, a.savingsCents), 8.6, ink);
    flow([
      b.assumedHours === null ? "" : `Mês anterior: ${formatDuration(b.assumedHours * 3600)} devolvidas.`,
      t.audios ? `Áudios ouvidos: ${t.audios} · acima de 2 min: ${t.longAudios} · maior: ${formatDuration(t.longestAudioSeconds)}${t.unmeasuredAudios ? ` · ${t.unmeasuredAudios} sem duração medida` : ""}.` : "",
      t.toSchedule.count ? `Até agendar: média ${formatMinutes(t.toSchedule.averageMinutes)}, mediana ${formatMinutes(t.toSchedule.medianMinutes)}, ${num(t.toSchedule.averageMessages)} mensagens.` : "",
      t.sessions.all.count ? "Duração dos atendimentos por resultado no painel." : "",
    ].filter(Boolean).join(" "), 7.5);
    if (r.featuredCase) { y -= 2; flow(`Caso do mês: ${r.featuredCase}`, 8.2, ink); }
  }

  section("PROCEDIMENTOS E HORÁRIOS DE PICO");
  if (a.procedures.length) for (const p of a.procedures) flow(`${p.name}: ${p.qualified} qualificados · ${p.attendedOutside} avaliações realizadas de contatos fora do expediente · receita ${money(p.revenueCents)}`, 8, ink);
  else flow("Sem procedimento registrado no período.", 8);
  flow(`Picos: ${a.peaks.map((p) => `${String(p.hour).padStart(2, "0")}h (${p.messages} mensagens)`).join(", ") || "sem mensagens"} · ${c.timezone}.`, 8);

  section("O QUE AJUSTAMOS NO AGENTE");
  flow(r.adjustments || "Aguardando revisão da Mavellium.", 8.6, r.adjustments ? ink : muted);

  const quality = r.leadQuality;
  if (quality && quality.leads > 0) {
    section("QUALIDADE DOS LEADS E MELHORIAS PARA O TRÁFEGO", 60);
    flow(leadQualityHeadline(quality), 9, ink);
    y -= 4;
    const summary: [string, string][] = [
      ["Leads novos no mês", num(quality.leads)],
      ["Informaram a cidade", `${quality.withCity} (${pct(quality.withCity, quality.leads)})`],
      ["Fora do raio de atendimento", quality.areaConfigured ? `${quality.outOfRadius} de ${quality.withCity} (${pct(quality.outOfRadius, quality.withCity)})` : "Área não configurada"],
      ["Agendaram · dentro / fora do raio", quality.areaConfigured ? `${quality.inScheduled} / ${quality.outScheduled}` : "—"],
      ["Agendaram · total", `${quality.outcomes.scheduled} (${pct(quality.outcomes.scheduled, quality.leads)})`],
      ["Transbordaram para a equipe", num(quality.outcomes.handoff)],
      ["Perderam", `${quality.outcomes.lost} (${pct(quality.outcomes.lost, quality.leads)})`],
    ];
    summary.forEach(([label, value], i) => row([[label, margin], ...(i === 0 ? [[status("leads"), QUALITY_X, 6.5, muted, bold] as [string, number, number, RGB, PDFFont]] : []), [value, 343, 8.5, ink, bold]]));
    const list = (title: string, items: { label: string; count: number; note?: string }[], empty: string) => {
      ensure(40); y -= 8; text(title, margin, y, 8.5, bold, ink); y -= 13;
      if (!items.length) { flow(empty, 8); return; }
      for (const item of items.slice(0, 6)) row([[item.label, margin], [`${item.count}${item.note ? ` · ${item.note}` : ""}`, 343, 8.5, ink, bold]]);
    };
    list("Cidades mais citadas", quality.cities.map((city) => ({ label: city.city, count: city.count, note: city.verdict === "out" ? "fora do raio" : undefined })), "Nenhum lead informou a cidade.");
    list("Primeiras dúvidas", quality.doubts, "Nenhuma dúvida registrada.");
    list("Motivos de perda", quality.losses, "Nenhum lead perdido no mês.");
    ensure(40); y -= 8; text("Melhorias sugeridas para o tráfego", margin, y, 8.5, bold, ink); y -= 13;
    if (quality.suggestions.length) for (const suggestion of quality.suggestions) { flow(`• ${suggestion}`, 8.4, ink, margin + 8, width - 8); y -= 2; }
    else flow(quality.lowSample ? `Poucos leads informaram a cidade (${quality.withCity}); as sugestões só aparecem com pelo menos 10.` : "Os dados do mês não indicam mudança de tráfego.", 8);
    y -= 2;
    flow(SUGGESTION_DISCLAIMER, 7.3);
    flow("Conta os leads reais criados no mês. Cidade, dúvida e motivo são o que o agente registrou do que o contato disse, sem dedução. Dentro ou fora do raio usa a área de atendimento cadastrada. Perdeu: motivo registrado, triagem, follow-up de quem recusou ou 72 horas sem resposta.", 7.2);
  }

  section("PREMISSAS FINANCEIRAS");
  const days = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const time = (v: number) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  // Premissa vazia é "não informada": "não verificado" é para número, não para dado que a clínica passa.
  const given = (v: number | null) => v === null ? "não informado" : formatBRL(v);
  flow(`Atendente: ${given(c.attendantMonthlyCents)}/mês ÷ ${c.attendantMonthlyHours === null ? "carga não informada" : `${c.attendantMonthlyHours} h/mês`}. Horas devolvidas: ${hoursPremise(r, true)}. Mensalidade: ${given(c.investmentCents)}.`, 8, ink);
  flow(`Horário humano: ${c.humanHours ? c.humanHours.map((h, i) => `${days[i]} ${h.map((p) => `${time(p.start)}-${time(p.end)}`).join(",") || "fechado"}`).join("; ") : unknown.toLowerCase()}.`, 8, ink);
  if (c.procedures.length) flow(`Procedimentos: ${c.procedures.map((p) => `${p.name}: ticket ${given(p.ticketCents)} · conversão ${p.conversionBps === null ? "não informada" : `${(p.conversionBps / 100).toLocaleString("pt-BR")}%`}`).join("; ")}.`, 8, ink);
  flow(`Avaliações: ${c.evaluationTypes.join(", ")}${c.countUntypedAsEvaluations ? " + sem tipo (conferidos)" : ""}. Comparecimento Clinicorp: ${c.completedStatusTypes.join(", ") || "status não definidos"}; variável: ${c.procedureVariable}.`, 7.5);
  if (a.investmentCents === 0) flow("Investimento zero: ROI percentual não se aplica.", 7.5);

  // O selo de cada número e, quando houver, as limitações do fechamento.
  section("COBERTURA DOS INDICADORES");
  if (r.quality) {
    for (const key of QUALITY_KEYS) {
      const q = r.quality[key];
      if (q) flow(`${QUALITY_KEY_LABEL[key]}: ${QUALITY_LABEL[q.status].toLowerCase()}${q.reasons[0] ? ` — ${q.reasons[0]}` : ""}`, 7.5, q.status === "verified" || q.status === "estimated" ? muted : ink);
    }
    y -= 2; flow(QUALITY_FOOTER, 7);
  } else flow("Relatório fechado antes do selo de qualidade.", 7.5);
  if (limitations.length) {
    ensure(40); y -= 8; text("Limitações deste fechamento", margin, y, 8.5, bold, ink); y -= 13;
    flow(closed
      ? "Este relatório foi fechado com cobertura parcial. Os indicadores sem evidência aparecem como NÃO VERIFICADO e não entram na conta do retorno; nada foi estimado no lugar deles."
      : "Rascunho com cobertura parcial. Os indicadores sem evidência aparecem como PENDENTE e não entram na conta do retorno.", 8.4, ink);
    if (r.limitationsNote) { y -= 2; flow(r.limitationsNote, 8.4, ink); }
    const unverified = unverifiedMetrics(r);
    if (unverified.length) { y -= 2; flow(`${closed ? "Não verificados" : "Pendentes"} neste fechamento: ${unverified.join(", ")}.`, 8.4, ink); }
    for (const item of limitations) { y -= 2; flow(`• ${item.text}`, 8.2, ink, margin + 8, width - 8); flow(`Afeta: ${item.affects.join(", ")}.`, 7.3, muted, margin + 18, width - 18); }
  } else if (!r.limitations && a.missing.length) flow(`Pendências: ${a.missing.join(" ")}`, 7.5, ink);

  section("METODOLOGIA DE CÁLCULO");
  flow("Receita = avaliações realizadas de contatos que chegaram fora do horário humano × conversão × ticket, somada por procedimento. Economia = horas devolvidas × custo/hora do atendente. ROI = (receita + economia - investimento) ÷ investimento. Os valores financeiros são estimativas.", 7.8, ink);
  flow("As conversas são contadas pela primeira interação respondida no mês. Nas avaliações, o horário é classificado pela primeira mensagem do contato, antes da marcação. Agendadas entram pelo mês da marcação; realizadas, pelo mês da consulta, e só com comparecimento confirmado (agendado ou confirmado nunca é presença). Cancelamentos, testes e marcações manuais ficam fora. A primeira resposta também considera respostas humanas. A qualificação depende do registro do agente. A lista de registros de cada número está no painel.", 7.5);

  // Rodapé de todas as páginas, desenhado no fim para saber o total.
  const due = new Intl.DateTimeFormat("pt-BR", { timeZone: c.timezone }).format(new Date(r.dueAt));
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: margin, y: 38 }, end: { x: margin + width, y: 38 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    const left = safe(i === 0 ? `Decisor: ${r.decisionMaker || "a definir"} · entrega até ${due} · preparado pela Mavellium` : `${r.tenantName} · ${r.label}`, regular);
    p.drawText(lines(left, width - 70, 7)[0] ?? "", { x: margin, y: 24, size: 7, font: regular, color: muted });
    p.drawText(`Página ${i + 1} de ${pages.length}`, { x: margin + width - 52, y: 24, size: 7, font: regular, color: muted });
  });
  return doc.save();
}
