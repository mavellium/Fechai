import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center">
      <p className="text-5xl font-bold text-iris">404</p>
      <h1 className="text-xl font-semibold text-gray-900">Página não encontrada</h1>
      <Link href="/">
        <Button variant="outline">Voltar ao início</Button>
      </Link>
    </main>
  );
}
