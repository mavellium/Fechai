import { prisma } from "@/lib/prisma";

/**
 * Remove uma entrada da trilha. A autorização fica na Server Action, que é a
 * única porta exposta para a interface administrativa.
 */
export async function deleteAuditLog(logId: string): Promise<boolean> {
  const id = logId.trim();
  if (!id) return false;

  const result = await prisma.auditLog.deleteMany({ where: { id } });
  return result.count === 1;
}
