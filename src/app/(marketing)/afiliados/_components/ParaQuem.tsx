import { Megaphone, Code2, Users, Store } from "lucide-react";

/**
 * Seção de identificação ("isso é para mim?").
 *
 * Perfis concretos em vez de "para todos": quem se reconhece numa linha
 * converte, e quem não se reconhece em nenhuma economiza o cadastro — o
 * programa não ganha nada com afiliado que nunca vai indicar.
 */
const PERFIS = [
  {
    icon: Megaphone,
    titulo: "Agências e social media",
    desc: "Você já cuida do digital de vários clientes. O agente resolve o atendimento que sobra pra eles — e vira receita recorrente pra você.",
  },
  {
    icon: Code2,
    titulo: "Quem presta serviço de tecnologia",
    desc: "Implanta sistema, faz site, automatiza processo. O fechai entra como mais uma peça da entrega, com comissão todo mês.",
  },
  {
    icon: Users,
    titulo: "Consultores e mentores",
    desc: "Você recomenda ferramenta o tempo todo e nunca ganhou nada por isso. Aqui a recomendação que você já faz passa a pagar.",
  },
  {
    icon: Store,
    titulo: "Quem já usa o fechai",
    desc: "Seu vizinho de ramo pergunta como você atende tão rápido. Responda com seu link e transforme a conversa em renda.",
  },
];

export function ParaQuem() {
  return (
    <section
      id="para-quem"
      className="border-t border-ink/10 bg-paper px-4 py-20 md:py-28"
      aria-labelledby="para-quem-titulo"
    >
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <p className="reveal font-mono text-micro uppercase tracking-[0.3em] text-neutral">
              para quem é
            </p>
            <h2
              id="para-quem-titulo"
              className="reveal font-display mt-5 text-3xl font-bold leading-[1.08] tracking-tight text-ink sm:text-4xl"
            >
              Você não precisa ser vendedor. Precisa conhecer gente que perde cliente no WhatsApp.
            </h2>
          </div>
          <div className="reveal">
            <p className="max-w-prose text-lg leading-relaxed text-ink/80">
              O fechai se vende sozinho para quem tem o problema: mensagem sem resposta vira venda
              perdida, e todo dono de negócio sabe disso. Seu trabalho é fazer a ponte — o teste
              grátis faz o resto.
            </p>
          </div>
        </div>

        <ul className="mt-16 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {PERFIS.map(({ icon: Icon, titulo, desc }) => (
            <li key={titulo} className="reveal">
              <Icon size={22} className="text-iris" aria-hidden />
              <h3 className="font-display mt-4 text-lg font-semibold text-ink">{titulo}</h3>
              <p className="mt-2 leading-relaxed text-neutral">{desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
