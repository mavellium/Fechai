/** Lê também controles desabilitados durante o envio e inputs ocultos de menus. */
export function snapshotForm(form: HTMLFormElement | null): string {
  if (!form) return "";
  return JSON.stringify(Array.from(form.elements).flatMap<unknown>((element, index) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return [];
    if (element instanceof HTMLInputElement && ["submit", "button", "reset"].includes(element.type)) return [];
    const key = element.name || element.id || String(index);
    if (element instanceof HTMLInputElement) {
      if (["checkbox", "radio"].includes(element.type)) return [[key, element.value, element.checked]];
      if (element.type === "file") return [[key, Array.from(element.files ?? []).map((file) => [file.name, file.size, file.lastModified])]];
    }
    if (element instanceof HTMLSelectElement && element.multiple) return [[key, Array.from(element.selectedOptions).map((option) => option.value)]];
    return [[key, element.value]];
  }));
}
