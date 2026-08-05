import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: "Condições de uso do fechai — cadastro, planos, integrações e responsabilidades.",
};

const ATUALIZADO_EM = "5 de agosto de 2026";
const CONTATO_EMAIL = "mavellium@gmail.com";

export default function TermosDeUsoPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 md:py-24">
      <Link
        href="/"
        className="font-mono text-micro uppercase tracking-[0.2em] text-white/40 transition hover:text-white/70"
      >
        ← Voltar para o fechai
      </Link>

      <h1 className="mt-6 font-display text-4xl font-bold leading-tight text-white md:text-5xl">
        Termos de Uso
      </h1>
      <p className="mt-3 font-mono text-micro uppercase tracking-[0.2em] text-white/40">
        Última atualização: {ATUALIZADO_EM}
      </p>

      <div className="mt-12 max-w-prose space-y-10 text-base leading-relaxed text-white/80">
        <section>
          <p>
            Estes termos regem o uso do <strong className="text-white">fechai</strong>, um
            produto que configura um agente de IA para atender, qualificar e agendar pelo
            WhatsApp de empresas clientes. Ao criar uma conta, você concorda com estes termos e
            com a{" "}
            <Link href="/privacidade" className="text-iris underline underline-offset-2 hover:text-iris/80">
              Política de Privacidade
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">1. O serviço</h2>
          <p className="mt-3">
            O fechai fornece um painel para configurar um agente de IA que conversa pelo WhatsApp
            da sua empresa, além de ferramentas de gestão de contatos, conversas e agenda. O
            serviço depende de integrações de terceiros (gateway de WhatsApp, provedores de IA e,
            opcionalmente, Google Agenda), cuja disponibilidade não está sob nosso controle
            direto.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">2. Cadastro e conta</h2>
          <p className="mt-3">
            Você é responsável por manter a confidencialidade das credenciais da sua conta e por
            todas as atividades realizadas nela. Informe dados verdadeiros no cadastro e
            atualize-os quando necessário.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            3. Planos e pagamento
          </h2>
          <p className="mt-3">
            O acesso a recursos pagos depende de assinatura de um plano, processada via Stripe.
            Cobranças seguem a periodicidade do plano contratado; o cancelamento interrompe
            cobranças futuras, mas não gera reembolso de períodos já pagos, salvo quando exigido
            por lei.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">4. Uso aceitável</h2>
          <p className="mt-3">Ao usar o fechai, você concorda em não:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Usar o agente para enviar spam ou mensagens não solicitadas em massa;</li>
            <li>Usar o serviço para conteúdo ilegal, enganoso ou que viole direitos de terceiros;</li>
            <li>Tentar acessar dados de outras contas ou contornar limites técnicos da plataforma;</li>
            <li>Usar o serviço em desacordo com os termos do WhatsApp/Meta ou do Google.</li>
          </ul>
          <p className="mt-3">
            Podemos suspender ou encerrar contas que violem este uso aceitável.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            5. Integrações de terceiros
          </h2>
          <p className="mt-3">
            Integrações como WhatsApp e Google Agenda são opcionais e sujeitas também aos termos
            desses provedores. Você é responsável por ter autorização para conectar o número de
            WhatsApp e a conta Google usados na sua conta fechai.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            6. Propriedade intelectual
          </h2>
          <p className="mt-3">
            O fechai, sua marca e seu código pertencem ao operador do produto. Os dados que você
            insere (contatos, conversas, base de conhecimento) continuam seus; concedemos a você
            uma licença de uso do software, não uma transferência de propriedade sobre ele.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            7. Disponibilidade e responsabilidade
          </h2>
          <p className="mt-3">
            Buscamos manter o serviço disponível, mas não garantimos operação ininterrupta,
            especialmente quando a indisponibilidade decorre de provedores terceiros (WhatsApp,
            Google, provedores de IA). Na medida permitida por lei, o fechai não se
            responsabiliza por perdas indiretas decorrentes do uso do serviço.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            8. Cancelamento
          </h2>
          <p className="mt-3">
            Você pode cancelar sua conta a qualquer momento pelo painel ou pelo contato abaixo.
            Podemos encerrar contas por violação destes termos, mediante aviso quando viável.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            9. Alterações nestes termos
          </h2>
          <p className="mt-3">
            Podemos atualizar estes termos para refletir mudanças no produto ou na legislação. A
            data no topo desta página sempre indica a versão vigente.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            10. Lei aplicável
          </h2>
          <p className="mt-3">Estes termos são regidos pela legislação brasileira.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">11. Contato</h2>
          <p className="mt-3">
            Dúvidas sobre estes termos:{" "}
            <a
              className="text-iris underline underline-offset-2 hover:text-iris/80"
              href={`mailto:${CONTATO_EMAIL}`}
            >
              {CONTATO_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
