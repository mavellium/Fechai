import { auth } from "@/auth";
import { prepareTenantExport } from "@/modules/admin/tenant-export";
import { recordAudit } from "@/modules/audit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Entre na conta para continuar." }, { status: 401 });
  if (session.user.role !== "SUPERADMIN") return Response.json({ error: "Acesso restrito ao administrador." }, { status: 403 });

  const { id } = await params;
  const result = await prepareTenantExport(id);
  if (!result) return Response.json({ error: "Conta não encontrada." }, { status: 404 });

  await recordAudit({
    event: "admin.tenant_export_requested", tenantId: id,
    target: { type: "Tenant", id, label: result.tenant.name },
  });

  const iterator = result.chunks();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        console.error("[admin] exportação do tenant falhou", id, error);
        controller.error(new Error("Não foi possível concluir a exportação."));
      }
    },
    async cancel() { await iterator.return(); },
  });
  const filename = `fechai-tenant-${id.replace(/[^a-zA-Z0-9_-]/g, "")}-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(body, { headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
