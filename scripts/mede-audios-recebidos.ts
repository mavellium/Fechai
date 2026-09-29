/**
 * Mede a duração dos áudios recebidos antes de `Message.audioSeconds` existir,
 * lendo o arquivo que já está na CDN (`audioUrl`, guardado desde 23/09/2026).
 * Sem arquivo não há o que medir: o relatório mostra esses áudios como "sem
 * duração medida", nunca como zero.
 *
 * Prévia: npx tsx scripts/mede-audios-recebidos.ts
 * Aplicar: npx tsx scripts/mede-audios-recebidos.ts --apply
 *
 * Só mensagens do contato (role "user"), que são as que o ROI mensal soma.
 * Sem `--apply`, baixa e mede, mas nada é gravado.
 *
 * Roda direto no servidor, sem entrar em container e sem depender do client
 * do Prisma estar gerado com a coluna nova:
 * - a conexão é a mesma que o docker-compose monta para o app (POSTGRES_* do
 *   `.env`, pela porta de loopback). O `DATABASE_URL` escrito no `.env` do
 *   servidor não é o do app e não é usado quando há `POSTGRES_PASSWORD`;
 * - leitura e gravação em SQL, com a coluna conferida no próprio banco. O
 *   script não altera o schema: sem a coluna, a prévia mede e o `--apply` para
 *   pedindo o `db push` do deploy.
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { audioDurationSeconds } from "../src/modules/voice/received-audio";

const BATCH = 50;
const PARALLEL = 5;

/** A mesma URL do app no docker-compose, pela porta publicada só em 127.0.0.1. */
function databaseUrl(): string | undefined {
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_HOST_PORT, DATABASE_URL } = process.env;
  if (!POSTGRES_PASSWORD) return DATABASE_URL;
  const user = encodeURIComponent(POSTGRES_USER || "postgres");
  return `postgresql://${user}:${encodeURIComponent(POSTGRES_PASSWORD)}@127.0.0.1:${POSTGRES_HOST_PORT || "5433"}/${POSTGRES_DB || "saas"}?schema=public`;
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });

async function measure(url: string): Promise<number | null | "falha"> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return "falha";
    return audioDurationSeconds(Buffer.from(await res.arrayBuffer()));
  } catch {
    return "falha";
  }
}

async function hasColumn(): Promise<boolean> {
  const rows = await prisma.$queryRaw<unknown[]>`SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Message' AND column_name = 'audioSeconds'`;
  return rows.length > 0;
}

async function main() {
  const flag = process.argv[2];
  if (flag && flag !== "--apply") throw new Error("Uso: npx tsx scripts/mede-audios-recebidos.ts [--apply]");
  const apply = flag === "--apply";

  const column = await hasColumn();
  if (!column && apply) {
    throw new Error('A coluna "Message"."audioSeconds" ainda não existe neste banco. Aplique o schema no deploy (db push) e rode de novo.');
  }
  if (!column) console.log('A coluna "Message"."audioSeconds" ainda não existe: esta prévia mede tudo, mas o --apply só grava depois do db push.');

  let cursor: string | null = null;
  let measured = 0, unreadable = 0, failed = 0, seconds = 0;
  for (;;) {
    // `id > cursor`, não OFFSET: com --apply as linhas medidas saem do filtro.
    const rows: { id: string; audioUrl: string }[] = await prisma.$queryRaw`
      SELECT m."id", m."audioUrl" FROM "Message" m
      JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE m."role" = 'user' AND m."audioUrl" IS NOT NULL AND c."isTest" = false
        ${column ? Prisma.sql`AND m."audioSeconds" IS NULL` : Prisma.empty}
        ${cursor ? Prisma.sql`AND m."id" > ${cursor}` : Prisma.empty}
      ORDER BY m."id" ASC LIMIT ${Prisma.raw(String(BATCH))}`;
    if (!rows.length) break;
    cursor = rows.at(-1)!.id;
    for (let i = 0; i < rows.length; i += PARALLEL) {
      await Promise.all(rows.slice(i, i + PARALLEL).map(async (row) => {
        const duration = await measure(row.audioUrl);
        if (duration === "falha") { failed++; return; }
        if (duration === null) { unreadable++; return; }
        measured++;
        seconds += duration;
        // Só preenche o que continua vazio: o webhook pode ter medido no meio tempo.
        if (apply) await prisma.$executeRaw`UPDATE "Message" SET "audioSeconds" = ${duration} WHERE "id" = ${row.id} AND "audioSeconds" IS NULL`;
      }));
    }
    console.log(`… ${measured} medidos, ${unreadable} em formato não lido, ${failed} sem download`);
  }

  console.log(`Medidos: ${measured} (${Math.round(seconds / 60)} min de áudio)`);
  console.log(`Formato que não sabemos ler (ficam sem duração): ${unreadable}`);
  console.log(`Falha ao baixar da CDN (rode de novo depois): ${failed}`);
  console.log(apply ? "Durações gravadas." : "Prévia apenas. Use --apply para gravar.");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
