import type { Metadata } from "next";
import { Space_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Fontes de marca: Clash Display (títulos) + Satoshi (corpo) via next/font/local
// assim que os arquivos da Fontshare forem adicionados em src/app/fonts/.
// Até lá, usamos fallbacks próximos do Google Fonts (encadeados no @theme).
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "fechai — seu WhatsApp vendendo no automático",
    template: "%s · fechai",
  },
  description:
    "O fechai configura um agente de IA para atender, qualificar e agendar pelo WhatsApp do seu negócio. Sem suporte humano no onboarding.",
  applicationName: "fechai",
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
