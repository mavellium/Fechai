import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { dueBroadcastCampaigns } from "../src/modules/broadcasts/queue";
import {
  sameBroadcastTemplate,
  type BroadcastTemplate,
} from "../src/modules/broadcasts/template";

// Smoke local, sempre rollback. Nunca inicia worker nem faz chamadas à Meta.
const url = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  throw new Error("Este smoke só pode usar banco local.");
const db = new PrismaClient();
const rollback = new Error("SMOKE_ROLLBACK");
async function main() {
  const before = await db.broadcastCampaign.count();
  try {
    await db.$transaction(
      async (tx) => {
        const now = new Date("2000-01-01T00:00:00Z");
        const template: BroadcastTemplate = {
          id: "test",
          name: "test",
          language: "pt_BR",
          body: "Olá",
          header: "",
          footer: "",
          parameterCount: 0,
        };
        const tenants = await Promise.all(
          Array.from({ length: 25 }, () =>
            tx.tenant.create({ data: { name: "Smoke Disparos (rollback)" } }),
          ),
        );
        for (let i = 0; i < tenants.length; i++) {
          await tx.broadcastCampaign.createMany({
            data: Array.from({ length: i === 0 ? 30 : 1 }, () => ({
              tenantId: tenants[i].id,
              name: "Smoke",
              phoneNumberId: "fake",
              template,
              status: "queued",
              nextAttemptAt: now,
            })),
          });
        }
        const first = await dueBroadcastCampaigns(now, tx);
        assert.equal(first.length, 20);
        assert.equal(new Set(first.map((c) => c.tenantId)).size, 20);
        const waiting = tenants.filter(
          (t) => !first.some((c) => c.tenantId === t.id),
        );
        await tx.broadcastCampaign.updateMany({
          where: { id: { in: first.map((c) => c.id) } },
          data: { nextAttemptAt: new Date(now.getTime() + 300_000) },
        });
        const second = await dueBroadcastCampaigns(now, tx);
        for (const t of waiting)
          assert(
            second.some((c) => c.tenantId === t.id),
            "Tenant não atendido precisa ter oportunidade no ciclo seguinte",
          );
        const campaign = first[0];
        assert(
          sameBroadcastTemplate(
            campaign.template as BroadcastTemplate,
            template,
          ),
        );
        const recipient = await tx.broadcastRecipient.create({
          data: {
            campaignId: campaign.id,
            phone: "5511987654321",
            row: 1,
            parameters: [],
            content: "Olá",
          },
        });
        const claims = await Promise.all(
          [1, 2].map(() =>
            tx.broadcastRecipient.updateMany({
              where: {
                id: recipient.id,
                status: "pending",
                campaign: { status: "queued", tenantId: campaign.tenantId },
              },
              data: { status: "sending" },
            }),
          ),
        );
        assert.equal(
          claims.reduce((sum, r) => sum + r.count, 0),
          1,
        );
        const duplicate = await tx.broadcastRecipient.createMany({
          data: [
            {
              campaignId: campaign.id,
              phone: recipient.phone,
              row: 2,
              parameters: [],
              content: "Olá",
            },
          ],
          skipDuplicates: true,
        });
        assert.equal(duplicate.count, 0);
        const test = await tx.broadcastRecipient.create({
          data: {
            campaignId: campaign.id,
            phone: recipient.phone,
            row: 0,
            parameters: [],
            content: "Olá",
            isTest: true,
          },
        });
        assert(test.isTest);
        const receipt = {
          tenantId: campaign.tenantId,
          messageId: "fake-wamid",
          phoneNumberId: "fake",
          recipientPhone: recipient.phone,
          status: "read",
          occurredAt: now,
        };
        await tx.broadcastReceipt.createMany({
          data: [receipt, receipt],
          skipDuplicates: true,
        });
        assert.equal(
          await tx.broadcastReceipt.count({
            where: { tenantId: campaign.tenantId },
          }),
          1,
        );
        throw rollback;
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await db.broadcastCampaign.count(), before);
  console.log(
    "OK: distribuição entre 25 tenants, cursor de retry, JsonB, claim único, teste separado e recibo idempotente. Rollback confirmado; nenhuma mensagem enviada.",
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
