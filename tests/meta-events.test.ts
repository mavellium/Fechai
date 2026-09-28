import { describe, expect, it } from "vitest";
import {
  parseMetaMessages,
  parseMetaStatuses,
} from "@/modules/whatsapp/meta-events";
const change = (
  phone: string,
  messages: unknown[],
  statuses: unknown[] = [],
) => ({
  field: "messages",
  value: {
    metadata: { phone_number_id: phone },
    contacts: [
      { wa_id: "2", profile: { name: "Bia" } },
      { wa_id: "1", profile: { name: "Ana" } },
    ],
    messages,
    statuses,
  },
});
const message = (id: string, from: string) => ({
  id,
  from,
  type: "text",
  text: { body: "Oi" },
  timestamp: "1790500000",
});
describe("lotes da Meta", () => {
  it("percorre mensagens, mudanças e entradas, associando o nome pelo wa_id", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            change("p1", [message("a", "1"), message("b", "2")]),
            change("p2", [message("c", "3")]),
          ],
        },
        { changes: [change("p3", [message("d", "4")])] },
      ],
    };
    const parsed = parseMetaMessages(payload);
    expect(parsed.map((m) => m.messageKeyId)).toEqual(["a", "b", "c", "d"]);
    expect(parsed.map((m) => m.fromName)).toEqual([
      "Ana",
      "Bia",
      undefined,
      undefined,
    ]);
    expect(parsed.map((m) => m.instanceExternalId)).toEqual([
      "p1",
      "p1",
      "p2",
      "p3",
    ]);
    expect(parsed[0].occurredAt).toEqual(new Date(1790500000000));
  });
  it.each([
    null,
    {},
    {
      object: "whatsapp_business_account",
      entry: [
        null,
        { changes: [null, { field: "messages", value: { messages: [null] } }] },
      ],
    },
  ])("ignora payload malformado", (payload) =>
    expect(parseMetaMessages(payload)).toEqual([]),
  );
  it("separa recibos e guarda código sem persistir corpo externo", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            change(
              "p1",
              [],
              ["sent", "delivered", "read", "failed"].map((status) => ({
                id: "wa1",
                recipient_id: "5511999999999",
                timestamp: "1790500000",
                status,
                errors: [{ code: 131047, message: "dado sensível" }],
              })),
            ),
          ],
        },
      ],
    };
    expect(parseMetaMessages(payload)).toEqual([]);
    const statuses = parseMetaStatuses(payload);
    expect(statuses).toHaveLength(4);
    expect(statuses[3].error).toContain("131047");
    expect(JSON.stringify(statuses)).not.toContain("sensível");
  });
});
