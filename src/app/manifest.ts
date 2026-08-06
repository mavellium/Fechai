import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";

/** Web app manifest — instalável e contabilizado como sinal de PWA/mobile. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "fechai — agente de IA para WhatsApp",
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#14171F",
    theme_color: "#14171F",
    lang: "pt-BR",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
