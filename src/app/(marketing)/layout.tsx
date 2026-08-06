import { Navbar } from "./_components/Navbar";
import { Footer } from "./_components/Footer";
import { ScrollProgress } from "./_components/ScrollProgress";
import { OrganizationJsonLd } from "@/components/seo/JsonLd";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      {/* Entidade da marca: vale para todas as páginas públicas. */}
      <OrganizationJsonLd />
      <ScrollProgress />
      <Navbar />
      <main id="conteudo" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
