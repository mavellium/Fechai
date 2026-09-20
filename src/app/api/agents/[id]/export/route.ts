import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { buildAgentPackage } from "@/modules/agent-engine/transfer";
import { safeAgentFilename } from "@/modules/agent-engine/agent-package";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await requireTenant();
  const { id } = await params;
  const portable = await buildAgentPackage(id, tenantId);
  if (!portable) {
    return NextResponse.json({ error: "Agente não encontrado." }, { status: 404 });
  }

  const filename = safeAgentFilename(portable.agent.name);
  return new NextResponse(JSON.stringify(portable, null, 2), {
    headers: {
      "Content-Type": "application/vnd.fechai.agent+json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
