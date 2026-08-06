import { MessageSquareText, BrainCircuit, CalendarCheck, UserRoundCheck } from "lucide-react";

/**
 * Seção definicional — "o que é o fechai".
 *
 * Existe por SEO/GEO, não por decoração. Duas coisas dependem dela:
 *  - Busca por marca: para ranquear em "fechai", a página precisa dizer em
 *    texto o que "fechai" É. O H1 é uma promessa ("ele vende"); nenhum trecho
 *    definia o produto de forma citável.
 *  - Motores de resposta: LLM cita parágrafo curto que responde a pergunta
 *    inteira sem depender do contexto ao redor. O primeiro parágrafo abaixo é
 *    escrito exatamente nesse formato (sujeito + categoria + o que faz).
 */

const CAPACIDADES = [
  {
    icon: MessageSquareText,
    titulo: "Responde na hora, sempre",
    desc: "Cada mensagem recebe resposta no momento em que chega — 3h da manhã, domingo, feriado.",
  },
  {
    icon: BrainCircuit,
    titulo: "Sabe do seu negócio",
    desc: "Responde com base nos seus preços, horários e regras. O que você não ensinou, ele não inventa.",
  },
  {
    icon: CalendarCheck,
    titulo: "Agenda sozinho",
    desc: "Consulta os horários livres, confirma com o cliente e cria o evento no seu Google Calendar.",
  },
  {
    icon: UserRoundCheck,
    titulo: "Qualifica e entrega",
    desc: "Separa curioso de comprador, marca lead quente e passa a conversa pra você quando precisa.",
  },
];

export function OQueE() {
  return (
    <section
      id="o-que-e"
      className="border-t border-ink/10 bg-paper px-4 py-20 md:py-28"
      aria-labelledby="o-que-e-titulo"
    >
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <p className="reveal font-mono text-micro uppercase tracking-[0.3em] text-neutral">
              o que é
            </p>
            <h2
              id="o-que-e-titulo"
              className="reveal font-display mt-5 text-3xl font-bold leading-[1.08] tracking-tight text-ink sm:text-4xl"
            >
              O fechai é um agente de IA para o WhatsApp do seu negócio.
            </h2>
          </div>

          <div className="reveal">
            {/* Parágrafo-resposta: definição completa e autossuficiente. */}
            <p className="max-w-prose text-lg leading-relaxed text-ink/80">
              O <strong className="font-semibold text-ink">fechai</strong> é uma plataforma
              brasileira que coloca um agente de inteligência artificial para atender pelo WhatsApp
              da sua empresa. Ele responde clientes 24 horas por dia, tira dúvidas usando as
              informações que você fornece, qualifica leads e agenda compromissos — sem que você
              precise programar, escrever prompt ou contratar mais alguém para o atendimento.
            </p>
            <p className="mt-5 max-w-prose leading-relaxed text-neutral">
              Funciona para clínicas, escolas, academias, prestadores de serviço e comércio: você
              define a persona do agente, sobe a base de conhecimento do seu negócio e escolhe quais
              ações ele pode executar. Começa grátis, sem cartão de crédito.
            </p>
          </div>
        </div>

        <ul className="mt-16 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {CAPACIDADES.map(({ icon: Icon, titulo, desc }) => (
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
