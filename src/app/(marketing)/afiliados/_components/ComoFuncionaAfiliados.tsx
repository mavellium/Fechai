import { UserPlus, Link2, TrendingUp, Wallet } from "lucide-react";

/**
 * Os quatro passos do programa. Numerados e curtos de propósito: a objeção
 * silenciosa de quem lê é "isso deve dar trabalho" — mostrar que são quatro
 * passos, sendo dois automáticos, responde antes da pergunta.
 */
const PASSOS = [
  {
    icon: UserPlus,
    titulo: "Crie sua conta",
    desc: "Marque a opção “afiliado” no cadastro. É grátis, não tem análise nem meta mínima. Já é cliente? Ative a aba de afiliado no painel.",
  },
  {
    icon: Link2,
    titulo: "Gere seu link",
    desc: "No painel você gera um link para cada plano. Compartilhe onde fizer sentido: WhatsApp, Instagram, seu site, sua carteira de clientes.",
  },
  {
    icon: TrendingUp,
    titulo: "Acompanhe as conversões",
    desc: "Cliques, cadastros e assinaturas aparecem no seu painel em tempo real — você vê qual link converte melhor.",
  },
  {
    icon: Wallet,
    titulo: "Receba todo mês",
    desc: "A comissão cai a cada mensalidade paga pelo cliente indicado. Acumulou R$ 100 liberados, você solicita o saque via Pix.",
  },
];

export function ComoFuncionaAfiliados() {
  return (
    <section
      id="como-funciona-afiliados"
      className="border-t border-ink/10 bg-white px-4 py-20 md:py-28"
      aria-labelledby="como-funciona-afiliados-titulo"
    >
      <div className="mx-auto max-w-6xl">
        <p className="reveal font-mono text-micro uppercase tracking-[0.3em] text-neutral">
          como funciona
        </p>
        <h2
          id="como-funciona-afiliados-titulo"
          className="reveal font-display mt-5 max-w-2xl text-3xl font-bold leading-[1.08] tracking-tight text-ink sm:text-4xl"
        >
          Quatro passos. Dois deles acontecem sozinhos.
        </h2>

        <ol className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {PASSOS.map(({ icon: Icon, titulo, desc }, i) => (
            <li key={titulo} className="reveal">
              <div className="flex items-center gap-3">
                <span className="font-mono text-micro tabular-nums text-neutral/60">
                  0{i + 1}
                </span>
                <span className="h-px flex-1 bg-ink/10" aria-hidden />
              </div>
              <Icon size={22} className="mt-5 text-iris" aria-hidden />
              <h3 className="font-display mt-4 text-lg font-semibold text-ink">{titulo}</h3>
              <p className="mt-2 leading-relaxed text-neutral">{desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
