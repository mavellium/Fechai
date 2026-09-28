# ADR-003: disparos confirmados e persistidos no banco

**Data:** 2026-09-27 · **Status:** aceito

## Contexto

A conta com Meta liberada precisa importar Excel/JSON e enviar uma mensagem
para vários contatos. O envio precisa continuar com a página fechada e não
pode duplicar mensagens por um clique repetido ou pelo restart do worker.

## Decisão

Importar cria um rascunho de campanha com destinatários e texto renderizado.
Confirmar muda atomicamente o estado para `queued`. O worker existente ganha
uma fila de varredura própria; PostgreSQL guarda o trabalho pendente e os
resultados. Não há publicação individual de contatos no Redis depois do commit.

Cada destinatário precisa ser reservado por atualização condicional antes de
qualquer chamada paga. Timeout/queda durante envio gera resultado `unknown`,
sem retry automático. A Meta e o banco não participam da mesma transação, então
exatamente uma entrega não é uma garantia possível: preferimos revisão humana
do resultado incerto a um segundo envio involuntário.

O primeiro formato usa templates aprovados de texto, com variáveis posicionais
no corpo; templates mais complexos ficam fora da seleção. O template e o
remetente revisados são congelados e revalidados no servidor.

## Consequências

- Usa a liberação Meta existente e repete autorização nas actions e no worker.
- Requer tabelas de campanhas, destinatários, recibos e sinal do serviço, além
  da atualização do processo de worker.
- Falhas/resultado incerto são visíveis por contato; nova tentativa é deliberada.
- Status `sent` significa aceitação da API, não entrega ou leitura.
- Recibos assinados atualizam entrega/leitura separadamente, com inbox durável
  para a corrida entre callback e commit; estados não regridem.
- Desconexão pausa pendentes. Agenda/fuso, distribuição por tenant e recuo nas
  consultas evitam envios fora da faixa e monopolização por contas com falha.
- Testes são explícitos, isolados dos totais, com idempotência por número/rascunho.
- Confirmação registra autor/versão; reconsulta envios recentes. Resultados têm
  atribuição operacional de sete dias, sem alegação de causalidade.
- ExcelJS lê `.xlsx`; `.xls` exige conversão explícita. Arquivos são limitados
  antes da persistência e não ficam guardados depois da importação.

Detalhes e operação: [broadcasts/README.md](../../src/modules/broadcasts/README.md).
