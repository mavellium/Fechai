import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

/**
 * Sitemap. Só entram rotas públicas e indexáveis — páginas atrás de login
 * (dashboard, admin, onboarding) ficam de fora de propósito: sitemap com URL
 * que devolve redirect de auth queima orçamento de rastreamento.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: absoluteUrl("/"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    // /planos NÃO entra: exige sessão (requireTenant) e redireciona o crawler
    // para o login. Os preços públicos vivem na âncora /#planos da home.
    {
      url: absoluteUrl("/cadastro"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: absoluteUrl("/login"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: absoluteUrl("/privacidade"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/termos"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
