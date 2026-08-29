import { headers } from "next/headers";

/**
 * URL base da aplicação em execução — a que vai dentro de links enviados por
 * e-mail (redefinição de senha, por exemplo).
 *
 * NÃO usa `SITE_URL` de `lib/seo`: aquela é a URL *canônica* do site e cai no
 * domínio de produção mesmo em desenvolvimento (de propósito, para o canonical
 * nunca apontar para localhost). Um link de redefinição gerado assim mandaria
 * quem está testando localmente para o site publicado.
 *
 * Ordem: env explícita → cabeçalhos do proxy → host da requisição.
 */
export async function appBaseUrl(): Promise<string> {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (configured) return configured.trim().replace(/\/+$/, "");

  const headersList = await headers();
  const host =
    headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "localhost:3001";
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}
