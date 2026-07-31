import { Navbar } from "./_components/Navbar";
import { Footer } from "./_components/Footer";
import { ScrollProgress } from "./_components/ScrollProgress";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <ScrollProgress />
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
