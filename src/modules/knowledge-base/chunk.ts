// Divide texto em pedaços para embeddings/RAG. Simples e determinístico:
// ~800 caracteres por chunk com sobreposição, quebrando por parágrafo quando dá.
const MAX_CHARS = 800;
const OVERLAP = 120;

export function chunkText(input: string): string[] {
  const text = input.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = "";

  const flush = () => {
    const t = buffer.trim();
    if (t) chunks.push(t);
    buffer = "";
  };

  for (const para of paragraphs) {
    if (para.length > MAX_CHARS) {
      flush();
      for (let i = 0; i < para.length; i += MAX_CHARS - OVERLAP) {
        chunks.push(para.slice(i, i + MAX_CHARS).trim());
      }
      continue;
    }
    if (buffer.length + para.length + 2 > MAX_CHARS) flush();
    buffer += (buffer ? "\n\n" : "") + para;
  }
  flush();
  return chunks;
}
