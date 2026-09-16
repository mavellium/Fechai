/** Cada request continua com um arquivo: vários arquivos de 50MB não viram um body enorme. */
export const MAX_KNOWLEDGE_FILE_BYTES = 50 * 1024 * 1024;
export type SelectedKnowledgeFile = { id: string; file: File; title: string; error?: string };
export type KnowledgeUploadItem = { id: string; title: string; file?: File };
type UploadResult = { ok: boolean; error?: string; info?: string };

export function selectKnowledgeFiles(current: SelectedKnowledgeFile[], incoming: File[]) {
  const files = [...current];
  const errors: string[] = [];
  for (const file of incoming) {
    if (!/\.(txt|md|pdf)$/i.test(file.name)) { errors.push(`"${file.name}": formato não aceito. Use .txt, .md ou .pdf.`); continue; }
    if (!file.size) { errors.push(`"${file.name}" está vazio.`); continue; }
    if (file.size > MAX_KNOWLEDGE_FILE_BYTES) { errors.push(`"${file.name}": o máximo é 50MB por arquivo.`); continue; }
    if (files.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
    files.push({ id: crypto.randomUUID(), file, title: file.name.replace(/\.[^.]+$/, "").slice(0, 200) || file.name });
  }
  return { files, errors };
}

/** Sucesso parcial não reenvia os itens já salvos; falha de um não impede os demais. */
export async function uploadKnowledgeItems(items: KnowledgeUploadItem[], send: (item: KnowledgeUploadItem, index: number, total: number) => Promise<UploadResult>) {
  const results: (UploadResult & { id: string })[] = [];
  for (const [index, item] of items.entries()) {
    try { results.push({ ...await send(item, index, items.length), id: item.id }); }
    catch { results.push({ id: item.id, ok: false, error: "Não foi possível enviar. Tente novamente." }); }
  }
  return results;
}
