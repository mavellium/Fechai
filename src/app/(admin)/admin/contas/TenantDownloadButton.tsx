"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TenantDownloadButton({ tenantId }: { tenantId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/export`, { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Não foi possível baixar os dados. Tente novamente.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]
        || `fechai-tenant-${tenantId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir o download.");
    } finally {
      setLoading(false);
    }
  }

  return <section className="space-y-2">
    <h3 className="text-sm font-medium text-white/85">Dados da conta</h3>
    <p className="text-sm text-white/50">Baixe configurações, conversas completas, contatos, agendamentos e histórico em JSON. Senhas e chaves de acesso ficam de fora.</p>
    <Button type="button" variant="outline" size="sm" loading={loading} loadingLabel="Preparando download" onClick={download}>
      <Download size={15} aria-hidden /> Baixar dados do tenant
    </Button>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
