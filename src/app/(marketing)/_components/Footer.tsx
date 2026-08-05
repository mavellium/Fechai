import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-ink px-4 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <span className="font-display text-base font-bold text-white">
          fechai<span className="text-signal">.</span>
        </span>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
          © {new Date().getFullYear()} fechai · agente de whatsapp com ia
        </p>
        <div className="flex gap-5 text-sm text-white/50">
          <Link href="/privacidade" className="hover:text-white">
            Privacidade
          </Link>
          <Link href="/termos" className="hover:text-white">
            Termos
          </Link>
          <Link href="/login" className="hover:text-white">
            Entrar
          </Link>
          <Link href="/cadastro" className="hover:text-white">
            Criar conta
          </Link>
        </div>
      </div>
    </footer>
  );
}
