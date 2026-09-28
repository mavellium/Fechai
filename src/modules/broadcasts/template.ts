/** Formato inicial: template aprovado de texto, com variáveis posicionais no corpo. */
export type BroadcastTemplate = {
  id: string;
  name: string;
  language: string;
  body: string;
  header: string;
  footer: string;
  parameterCount: number;
};

export type MetaTemplateRecord = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  parameter_format?: string;
  components?: { type: string; format?: string; text?: string }[];
};

/** PostgreSQL JsonB reordena chaves: comparar JSON.stringify cancelaria rascunhos válidos. */
export function sameBroadcastTemplate(
  left: BroadcastTemplate,
  right: BroadcastTemplate,
): boolean {
  return (
    [
      "id",
      "name",
      "language",
      "body",
      "header",
      "footer",
      "parameterCount",
    ] as const
  ).every((field) => left[field] === right[field]);
}

export function supportedTemplate(
  raw: MetaTemplateRecord,
): BroadcastTemplate | null {
  if (
    raw.status !== "APPROVED" ||
    !raw.id ||
    !raw.name ||
    !raw.language ||
    raw.parameter_format === "NAMED"
  )
    return null;
  const components = raw.components ?? [];
  if (components.some((c) => !["BODY", "HEADER", "FOOTER"].includes(c.type)))
    return null;
  const header = components.find((c) => c.type === "HEADER");
  const footer = components.find((c) => c.type === "FOOTER")?.text ?? "";
  if (header && (header.format !== "TEXT" || /{{/.test(header.text ?? "")))
    return null;
  if (/{{/.test(footer)) return null;
  const body = components.find((c) => c.type === "BODY")?.text;
  if (!body) return null;
  const slots = [
    ...new Set([...body.matchAll(/{{(\d+)}}/g)].map((m) => Number(m[1]))),
  ].sort((a, b) => a - b);
  if (
    slots.length > 20 ||
    slots.some((slot, i) => slot !== i + 1) ||
    /{{|}}/.test(body.replace(/{{\d+}}/g, ""))
  )
    return null;
  return {
    id: raw.id,
    name: raw.name,
    language: raw.language,
    body,
    header: header?.text ?? "",
    footer,
    parameterCount: slots.length,
  };
}

export function renderBroadcast(
  template: BroadcastTemplate,
  parameters: string[],
): string {
  if (parameters.length !== template.parameterCount)
    throw new Error("Quantidade de variáveis diferente do template.");
  return [
    template.header,
    template.body.replace(
      /{{(\d+)}}/g,
      (_, index) => parameters[Number(index) - 1],
    ),
    template.footer,
  ]
    .filter(Boolean)
    .join("\n\n");
}
