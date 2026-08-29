/**
 * Conteúdo da landing que também vira dado estruturado (JSON-LD).
 *
 * Fica num módulo separado por uma razão de SEO, não de organização: o Google
 * exige que o FAQ/HowTo marcado no JSON-LD seja o MESMO texto visível na
 * página. Duas cópias divergentes = rich result removido. Com uma fonte só,
 * não há como divergir.
 */

export const PERGUNTAS = [
  {
    q: "O que é o fechai?",
    a: "O fechai é uma plataforma brasileira que cria um agente de inteligência artificial para atender pelo WhatsApp do seu negócio. Ele responde clientes 24 horas por dia, tira dúvidas com base nas informações que você fornece, qualifica leads e agenda compromissos automaticamente — sem você precisar programar nada.",
  },
  {
    q: "Quanto custa o fechai?",
    a: "O fechai tem plano grátis com 1 agente, 7 dias de uso ilimitado e depois 10 conversas por mês, sem cartão de crédito. Os planos pagos são R$ 199/mês (Starter, 1.000 conversas), R$ 399/mês (Pro, 3.000 conversas) e R$ 899/mês (Business, 10.000 conversas).",
  },
  {
    q: "Preciso saber programar?",
    a: "Não. Todo o processo é guiado no painel: você define a persona do agente, sobe a base de conhecimento, escolhe as ações permitidas e conecta o WhatsApp. Nenhuma linha de código e nenhum prompt escrito à mão.",
  },
  {
    q: "Como o agente aprende sobre o meu negócio?",
    a: "Você sobe um documento (PDF ou texto) com preços, horários, serviços e regras. O agente responde com base nesse material usando busca semântica (RAG), então ele não inventa informação que você não forneceu.",
  },
  {
    q: "Funciona com meu número atual do WhatsApp?",
    a: "Você conecta um número escaneando um QR code, como no WhatsApp Web. Recomendamos usar um número dedicado ao atendimento para manter o histórico organizado.",
  },
  {
    q: "E se o agente não souber responder?",
    a: "Você pode ativar a ação 'transferir para humano'. A conversa é marcada como 'precisa de atenção' no painel e você assume o atendimento de onde ele parou.",
  },
  {
    q: "O fechai agenda compromissos sozinho?",
    a: "Sim. Com a ação de agendamento ativada e o Google Calendar conectado, o agente consulta os horários livres, confirma com o cliente e cria o evento na sua agenda durante a própria conversa.",
  },
  {
    q: "Em quanto tempo consigo colocar no ar?",
    a: "Em poucos minutos. Criar a conta, definir a persona, subir a base de conhecimento e conectar o WhatsApp é um fluxo guiado — a maioria dos negócios coloca o agente para rodar na primeira sessão.",
  },
] as const;

export const PASSOS = [
  {
    n: "01",
    title: "Crie a conta e a persona",
    desc: "Perguntas guiadas montam o comportamento do agente — tom de voz, o que oferecer, o que evitar. Sem escrever prompt.",
  },
  {
    n: "02",
    title: "Ensine o que ele sabe",
    desc: "Suba um PDF ou cole o texto com preços, horários e regras. Ele responde só com base nisso — não inventa.",
  },
  {
    n: "03",
    title: "Ligue as ações permitidas",
    desc: "Agendar, registrar lead, marcar quente, follow-up, transferir pra você. Cada uma é um interruptor.",
  },
  {
    n: "04",
    title: "Conecte e deixe rodar",
    desc: "QR code no WhatsApp, snippet no site. Cada mensagem atendida na hora, tudo visível no seu painel.",
  },
] as const;
