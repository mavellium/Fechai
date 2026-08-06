import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

// Fontes de marca: Clash Display (títulos) + Satoshi (corpo) via next/font/local
// assim que os arquivos da Fontshare forem adicionados em src/app/fonts/.
// Até lá, usamos fallbacks próximos do Google Fonts (encadeados no @theme).
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // metadataBase resolve toda URL relativa de OG/canonical. Sem ele, o Next
  // emite OG image relativa — que várias plataformas simplesmente ignoram.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "fechai — agente de IA que atende e vende pelo seu WhatsApp",
    template: "%s · fechai",
  },
  description: SITE_DESCRIPTION,
  applicationName: "fechai",
  keywords: SITE_KEYWORDS,
  authors: [{ name: "fechai", url: SITE_URL }],
  creator: "fechai",
  publisher: "fechai",
  category: "technology",
  alternates: {
    canonical: "/",
    languages: { "pt-BR": "/" },
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "fechai — agente de IA que atende e vende pelo seu WhatsApp",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "fechai — agente de IA que atende e vende pelo seu WhatsApp",
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Preencha quando registrar o domínio no Google Search Console — é o passo
  // que efetivamente inicia a indexação (ver docs/SEO.md).
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION && {
      google: process.env.GOOGLE_SITE_VERIFICATION,
    }),
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8FB" },
    { media: "(prefers-color-scheme: dark)", color: "#14171F" },
  ],
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${spaceGrotesk.variable} ${jakarta.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
