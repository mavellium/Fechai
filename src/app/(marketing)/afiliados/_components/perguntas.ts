/**
 * Perguntas do FAQ de afiliados.
 *
 * Vive num módulo próprio, e não dentro de `FAQAfiliados.tsx`, porque a página
 * (Server Component) usa a mesma lista para gerar o JSON-LD. Importar um dado
 * de um arquivo `"use client"` faz o valor atravessar a fronteira como
 * referência serializável, e o `JSON.stringify` do JSON-LD quebra.
 */
export const PERGUNTAS_AFILIADOS = [
  {
    q: "Preciso ser cliente do fechai para ser afiliado?",
    a: "Não. Você pode entrar só como afiliado, só como cliente, ou os dois — a escolha é sua no cadastro e pode mudar depois. Quem usa o produto costuma indicar melhor, mas não é exigência.",
  },
  {
    q: "A comissão é só na primeira compra?",
    a: "Não. Ela é recorrente: você recebe uma porcentagem de cada mensalidade paga pelo cliente indicado, todo mês, enquanto ele mantiver a assinatura. Uma indicação de hoje continua pagando daqui a um ano.",
  },
  {
    q: "Quanto é a comissão?",
    a: "Começa em 5% e sobe com o volume: a partir de 5 vendas ativas você passa a 10%, a partir de 25 vai a 15% e com 100 ou mais chega a 20%. Vale para qualquer plano, e ao subir de nível o novo percentual passa a valer para todas as suas assinaturas, não só para as próximas.",
  },
  {
    q: "Se um cliente meu cancelar, eu perco o nível?",
    a: "O nível considera as assinaturas ativas. Se um cliente cancela, ele sai da contagem e o percentual pode voltar à faixa anterior — mas as comissões que você já ganhou continuam suas, calculadas pela taxa da época.",
  },
  {
    q: "Quando e como eu recebo?",
    a: "Cada mensalidade paga gera uma comissão que fica 30 dias em análise (janela de estorno). Depois disso o valor é liberado, e a partir de R$ 100 acumulados você solicita o saque via Pix pelo painel.",
  },
  {
    q: "Por quanto tempo o meu link fica válido?",
    a: "O clique fica registrado por 30 dias. Se a pessoa entrar pelo seu link hoje e criar a conta duas semanas depois, a indicação continua sendo sua. O crédito é do primeiro link que trouxe a pessoa.",
  },
  {
    q: "Tem custo ou meta mínima?",
    a: "Nenhum dos dois. Entrar é grátis, não há mensalidade, e você não perde nada se ficar um mês sem indicar. Também não existe limite de quantas indicações você pode fazer.",
  },
  {
    q: "Como sei que a venda foi contabilizada?",
    a: "No painel de afiliado você acompanha cliques, cadastros e assinaturas de cada link, além do extrato de comissões mês a mês. Em Relatórios há uma aba com a evolução dos seus ganhos.",
  },
  {
    q: "E se o cliente que eu indiquei cancelar?",
    a: "As comissões que você já ganhou continuam suas. Você apenas deixa de receber pelas mensalidades seguintes, já que não há mais mensalidade sendo paga.",
  },
] as const;
