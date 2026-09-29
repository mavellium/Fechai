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
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { audioDurationSeconds } from "../src/modules/voice/received-audio";

const BATCH = 50;
const PARALLEL = 5;

async function measure(url: string): Promise<number | null | "falha"> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return "falha";
    return audioDurationSeconds(Buffer.from(await res.arrayBuffer()));
  } catch {
    return "falha";
  }
}

async function main() {
  const flag = process.argv[2];
  if (flag && flag !== "--apply") throw new Error("Uso: npx tsx scripts/mede-audios-recebidos.ts [--apply]");
  const apply = flag === "--apply";
  let cursor: string | undefined;
  let measured = 0, unreadable = 0, failed = 0;

  for (;;) {
    const rows = await prisma.message.findMany({
      // `id > cursor`, não o cursor do Prisma: com --apply a linha do cursor
      // deixa de casar com o filtro e o `skip: 1` pularia outra no lugar dela.
      where: { role: "user", audioSeconds: null, audioUrl: { not: null }, conversation: { isTest: false }, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, audioUrl: true }, orderBy: { id: "asc" }, take: BATCH,
    });
    if (!rows.length) break;
    cursor = rows.at(-1)!.id;
    for (let i = 0; i < rows.length; i += PARALLEL) {
      await Promise.all(rows.slice(i, i + PARALLEL).map(async (row) => {
        const seconds = await measure(row.audioUrl!);
        if (seconds === "falha") { failed++; return; }
        if (seconds === null) { unreadable++; return; }
        measured++;
        // Só preenche o que continua vazio: o webhook pode ter medido no meio tempo.
        if (apply) await prisma.message.updateMany({ where: { id: row.id, audioSeconds: null }, data: { audioSeconds: seconds } });
      }));
    }
    console.log(`… ${measured} medidos, ${unreadable} em formato não lido, ${failed} sem download`);
  }

  console.log(`Medidos: ${measured}`);
  console.log(`Formato que não sabemos ler (ficam sem duração): ${unreadable}`);
  console.log(`Falha ao baixar da CDN (rode de novo depois): ${failed}`);
  if (!apply) console.log("Prévia apenas. Use --apply para gravar.");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
