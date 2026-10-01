import { signPrintToken } from "@/lib/print-token";

/*
 * PDF do relatório mensal v2: o Chromium do servidor abre a rota de impressão
 * (a mesma árvore de componentes do painel) e imprime em A4. Assim o PDF é o
 * que a Mavellium viu na tela, com as fontes e os gráficos, e nenhum número é
 * redesenhado à mão.
 *
 * O navegador vem da imagem (`chromium` no Dockerfile); em desenvolvimento,
 * aponte `CHROMIUM_PATH` para o Chrome local. Sem navegador a função lança, e
 * a rota de PDF devolve a página de impressão para salvar pelo navegador.
 */

const CANDIDATES = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];

async function executablePath(): Promise<string> {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const { access } = await import("node:fs/promises");
  for (const path of CANDIDATES) {
    try { await access(path); return path; } catch { /* próximo */ }
  }
  throw new Error("Chromium não encontrado. Defina CHROMIUM_PATH.");
}

/** Caminho da página de impressão, com o token que a abre. */
export function monthlyPrintPath(grant: { tenantId: string; month: string; draft: boolean }): string {
  return `/imprimir/relatorio-mensal?token=${encodeURIComponent(signPrintToken(grant))}`;
}

/**
 * `origin` é de onde o Chromium alcança o próprio app: `PDF_BASE_URL` (ex.:
 * http://127.0.0.1:3000 dentro do container) ou a origem da requisição.
 */
export async function printMonthlyPdf(grant: { tenantId: string; month: string; draft: boolean }, origin: string): Promise<Uint8Array> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: await executablePath(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    const response = await page.goto(`${process.env.PDF_BASE_URL ?? origin}${monthlyPrintPath(grant)}`, { waitUntil: "networkidle", timeout: 30_000 });
    if (!response?.ok()) throw new Error(`Página de impressão respondeu ${response?.status() ?? "sem resposta"}.`);
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  } finally {
    await browser.close();
  }
}

/** fechai-relatorio-{slug-clinica}-{YYYY-MM}-v{versao}.pdf */
export function monthlyPdfFilename(tenantName: string, month: string, version: number | undefined, draft: boolean): string {
  const slug = tenantName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "clinica";
  return `fechai-relatorio-${slug}-${month}-${draft ? "rascunho" : `v${version || 1}`}.pdf`;
}
