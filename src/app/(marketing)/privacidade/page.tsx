import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Como o fechai coleta, usa e protege os dados da sua conta, dos seus leads e das integrações (WhatsApp, Google Agenda, pagamento).",
};

const ATUALIZADO_EM = "5 de agosto de 2026";
const CONTATO_EMAIL = "mavellium@gmail.com";

export default function PoliticaDePrivacidadePage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 md:py-24">
      <Link
        href="/"
        className="font-mono text-micro uppercase tracking-[0.2em] text-white/40 transition hover:text-white/70"
      >
        ← Voltar para o fechai
      </Link>

      <h1 className="mt-6 font-display text-4xl font-bold leading-tight text-white md:text-5xl">
        Política de Privacidade
      </h1>
      <p className="mt-3 font-mono text-micro uppercase tracking-[0.2em] text-white/40">
        Última atualização: {ATUALIZADO_EM}
      </p>

      <div className="mt-12 max-w-prose space-y-10 text-base leading-relaxed text-white/80">
        <section>
          <p>
            Esta política explica quais dados o <strong className="text-white">fechai</strong>{" "}
            coleta quando você cria uma conta, conecta o WhatsApp da sua empresa, configura um
            agente de IA e integra outros serviços (como o Google Agenda), e como esses dados são
            usados, armazenados e protegidos.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">1. Quem somos</h2>
          <p className="mt-3">
            O fechai é um produto que configura um agente de IA para atender, qualificar e
            agendar pelo WhatsApp de empresas clientes. Nesta política, &ldquo;fechai&rdquo;,
            &ldquo;nós&rdquo; ou &ldquo;nosso&rdquo; se referem ao operador do produto;
            &ldquo;você&rdquo; se refere ao titular da conta (a empresa cliente ou seu
            representante) e, quando aplicável, aos contatos/leads gerenciados dentro da conta.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            2. Dados que coletamos
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-white">Dados de conta:</strong> nome, e-mail e senha (com
              hash), dados da empresa e do plano contratado.
            </li>
            <li>
              <strong className="text-white">Dados de conversas:</strong> mensagens trocadas pelo
              WhatsApp da sua empresa com seus leads/clientes, necessárias para o agente de IA
              atender e para você acompanhar o atendimento.
            </li>
            <li>
              <strong className="text-white">Contatos e leads:</strong> nome, telefone e demais
              informações que você ou o agente registram durante o atendimento.
            </li>
            <li>
              <strong className="text-white">Base de conhecimento:</strong> arquivos e textos que
              você envia para treinar o agente sobre o seu negócio.
            </li>
            <li>
              <strong className="text-white">Dados de pagamento:</strong> processados diretamente
              pelo Stripe — o fechai não armazena número de cartão.
            </li>
            <li>
              <strong className="text-white">Dados de integrações opcionais:</strong> quando você
              conecta o Google Agenda, tokens de acesso/atualização e o e-mail da conta Google
              conectada (ver seção 5).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            3. Como usamos os dados
          </h2>
          <p className="mt-3">Usamos os dados acima para:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Operar o atendimento automatizado pelo WhatsApp e o painel do fechai;</li>
            <li>Processar mensagens com provedores de IA para gerar as respostas do agente;</li>
            <li>Espelhar agendamentos feitos pelo agente na sua agenda do Google, quando conectada;</li>
            <li>Processar cobrança do plano contratado;</li>
            <li>Dar suporte à sua conta e comunicar mudanças relevantes no serviço;</li>
            <li>Cumprir obrigações legais e proteger a segurança da plataforma.</li>
          </ul>
          <p className="mt-3">
            Não usamos os dados das suas conversas ou da sua agenda para publicidade, e não
            vendemos dados pessoais a terceiros.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            4. Base legal (LGPD)
          </h2>
          <p className="mt-3">
            Tratamos os dados com base na execução do contrato de uso do fechai, no legítimo
            interesse em manter e melhorar o serviço, no cumprimento de obrigações legais
            (ex.: fiscais) e, quando aplicável, no seu consentimento — por exemplo, ao conectar
            voluntariamente sua conta do Google.
          </p>
        </section>

        <section id="google">
          <h2 className="font-display text-2xl font-semibold text-white">
            5. Integração com o Google Agenda
          </h2>
          <p className="mt-3">
            A integração com o Google Agenda é opcional e só é ativada se você conectá-la em{" "}
            <span className="font-mono text-sm text-white/70">Agenda → Conectar Google</span>.
            Ao conectar, solicitamos apenas dois escopos:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <span className="font-mono text-sm">calendar.events</span> — para criar e editar,
              na sua agenda do Google, os eventos correspondentes aos horários que o agente
              marcou dentro do fechai. Não lemos os eventos que já existem na sua agenda.
            </li>
            <li>
              <span className="font-mono text-sm">userinfo.email</span> — só para identificar e
              exibir qual conta Google está conectada.
            </li>
          </ul>
          <p className="mt-3">
            Os tokens de acesso e atualização ficam armazenados de forma segura, vinculados só à
            sua conta, e são usados exclusivamente para espelhar os compromissos marcados no
            fechai. Você pode desconectar a integração a qualquer momento na tela de Agenda; ao
            desconectar, os tokens são apagados.
          </p>
          <p className="mt-3">
            O uso e a transferência de informações recebidas das APIs do Google pelo fechai para
            qualquer outro aplicativo seguem a{" "}
            <a
              className="text-iris underline underline-offset-2 hover:text-iris/80"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Política de Dados do Usuário dos Serviços de API do Google
            </a>
            , incluindo os requisitos de Uso Limitado (Limited Use).
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            6. Com quem compartilhamos dados
          </h2>
          <p className="mt-3">
            Compartilhamos dados apenas com prestadores de serviço necessários para operar o
            fechai, sob obrigação contratual de confidencialidade e uso limitado à finalidade
            contratada:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Provedores de IA (ex.: Google Gemini, OpenAI) para gerar as respostas do agente;</li>
            <li>Gateway de WhatsApp, para envio e recebimento de mensagens;</li>
            <li>Stripe, para processamento de pagamentos;</li>
            <li>BunnyCDN, para armazenamento dos arquivos da base de conhecimento;</li>
            <li>Google, quando você conecta o Google Agenda (ver seção 5);</li>
            <li>Provedor de hospedagem e infraestrutura do fechai.</li>
          </ul>
          <p className="mt-3">Não compartilhamos dados com terceiros para fins de publicidade.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            7. Retenção e exclusão
          </h2>
          <p className="mt-3">
            Mantemos os dados enquanto sua conta estiver ativa. Ao encerrar a conta, você pode
            solicitar a exclusão dos seus dados pelo canal de contato abaixo, respeitados prazos
            legais de guarda (ex.: fiscais) quando aplicáveis.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">8. Segurança</h2>
          <p className="mt-3">
            Usamos práticas como criptografia em trânsito, controle de acesso por conta/tenant e
            armazenamento seguro de credenciais para proteger seus dados. Nenhum sistema é
            infalível — se identificarmos um incidente de segurança relevante, você será
            notificado conforme exigido pela legislação aplicável.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            9. Seus direitos
          </h2>
          <p className="mt-3">
            Nos termos da LGPD, você pode solicitar a qualquer momento: confirmação do
            tratamento, acesso, correção, portabilidade, anonimização ou exclusão dos seus dados,
            e revogar consentimentos dados (como a conexão com o Google Agenda). Basta escrever
            para o e-mail de contato abaixo.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">
            10. Alterações nesta política
          </h2>
          <p className="mt-3">
            Podemos atualizar esta política para refletir mudanças no produto ou na legislação.
            A data no topo desta página sempre indica a versão vigente.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold text-white">11. Contato</h2>
          <p className="mt-3">
            Dúvidas sobre esta política ou sobre seus dados:{" "}
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
