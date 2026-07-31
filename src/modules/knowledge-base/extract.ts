// Extrai texto de um arquivo enviado. Suporta texto puro (.txt/.md) e PDF.
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";

  if (!isPdf) {
    return (await file.text()).trim();
  }

  // PDF: import dinâmico para não carregar a lib no bundle quando não usada.
  // pdf-parse v2 expõe a classe PDFParse: new PDFParse({ data }).getText().
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data });
    const result = await parser.getText();
    return result.text.trim();
  } catch (err) {
    console.error("[knowledge-base] falha ao extrair PDF", err);
    throw new Error("Não consegui ler este PDF. Tente colar o texto ou enviar um .txt.");
  }
}
