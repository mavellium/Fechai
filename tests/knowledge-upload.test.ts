import { describe, expect, it, vi } from "vitest";
import { MAX_KNOWLEDGE_FILE_BYTES, selectKnowledgeFiles, uploadKnowledgeItems, type KnowledgeUploadItem } from "@/modules/knowledge-base/upload-batch";

const file = (name: string, content = "conteúdo") => new File([content], name, { lastModified: 123 });

describe("seleção de documentos do Cérebro", () => {
  it("aceita vários formatos, mantém títulos e evita duplicar a seleção", () => {
    const first = selectKnowledgeFiles([], [file("Guia.PDF"), file("Horários.md")]);
    first.files[0].title = "Guia da clínica";
    const next = selectKnowledgeFiles(first.files, [file("Guia.PDF"), file("Preços.txt")]);
    expect(next.errors).toEqual([]);
    expect(next.files.map((f) => f.title)).toEqual(["Guia da clínica", "Horários", "Preços"]);
    expect(new Set(next.files.map((f) => f.id)).size).toBe(3);
  });

  it("recusa vazios, formatos incorretos e arquivos acima do limite sem perder os válidos", () => {
    const large = file("Grande.pdf");
    Object.defineProperty(large, "size", { value: MAX_KNOWLEDGE_FILE_BYTES + 1 });
    const result = selectKnowledgeFiles([], [file("Vazio.txt", ""), file("Planilha.xlsx"), large, file("Válido.md")]);
    expect(result.errors).toHaveLength(3);
    expect(result.files.map((f) => f.file.name)).toEqual(["Válido.md"]);
  });

  it("permite selecionar novamente o arquivo removido", () => {
    const selected = selectKnowledgeFiles([], [file("A.txt"), file("B.txt")]);
    const kept = selected.files.filter((f) => f.file.name !== "A.txt");
    const next = selectKnowledgeFiles(kept, [file("A.txt")]);
    expect(next.files.map((f) => f.file.name)).toEqual(["B.txt", "A.txt"]);
    expect(next.files[1].id).not.toBe(selected.files[0].id);
  });
});

describe("envio de vários documentos", () => {
  it("continua após rejeição ou exceção e permite repetir somente os pendentes", async () => {
    const items = ["a", "b", "c", "d"].map((id) => ({ id, title: id, file: file(`${id}.txt`) }));
    let active = 0;
    let maximumActive = 0;
    const send = vi.fn(async (item: KnowledgeUploadItem) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active--;
      if (item.id === "b") throw new Error("conexão interrompida");
      return item.id === "c" ? { ok: false, error: "PDF inválido" } : { ok: true, info: "Salvo" };
    });
    const results = await uploadKnowledgeItems(items, send);
    expect(maximumActive).toBe(1);
    expect(send).toHaveBeenCalledTimes(4);
    expect(results.map((r) => [r.id, r.ok])).toEqual([["a", true], ["b", false], ["c", false], ["d", true]]);
    expect(results[1].error).toContain("Tente novamente");
    expect(results[2].error).toBe("PDF inválido");
    const pending = items.filter((item) => !results.find((r) => r.id === item.id)?.ok);
    const retry = vi.fn(async () => ({ ok: true }));
    await uploadKnowledgeItems(pending, retry);
    expect(retry.mock.calls).toHaveLength(2);
    expect(pending.map((item) => item.id)).toEqual(["b", "c"]);
  });
});
