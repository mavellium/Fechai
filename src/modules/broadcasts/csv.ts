/** Bloqueia fórmulas ao abrir o relatório no Excel, incluindo whitespace inicial. */
export function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function broadcastCsv(rows: unknown[][]) {
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
