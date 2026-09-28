# P-79 — Relatório mensal de ROI odontológico

Implementação do escopo mínimo solicitado para 30/09/2026. Primeira entrega ao
Instituto do Sorriso até 05/10/2026. Base: requisitos fornecidos na conversa;
a especificação citada no Obsidian não estava disponível.

## Operação mensal

1. Mavellium abre **Admin → ROI mensal**, seleciona a clínica e a competência.
2. Preenche os números levantados com a clínica (P-78): ticket e conversão de
   cada procedimento, custo mensal do atendente, carga mensal em horas,
   expediente humano e mensalidade. Declara também os minutos humanos por
   conversa usados para a estimativa de economia. Nada é preenchido com chute.
3. Confere a variável de procedimento, os tipos de avaliação e os status do
   Clinicorp que efetivamente comprovam realização. Status vêm de
   `/appointment/status_list`, vinculados pelo `StatusId`; o nome livre não
   é usado para inferir comparecimento. `CONFIRMED` não comprova realização.
4. Nos agendamentos históricos sem tipo, só habilita a classificação como
   avaliação depois de conferir. Essa decisão fica nas premissas do mês.
5. Escreve **O que ajustamos no agente**, **Próximo mês** e o nome do decisor.
6. Salva, confere o relatório e fecha após o término do mês. Pendências de
   dados e premissas bloqueiam o fechamento. Eventos históricos com cobertura
   parcial exigem ciência explícita; o aviso continua no PDF e no painel.
7. Exporta o PDF A4 de uma página, envia ao decisor e registra **Já enviei ao
   decisor**. Depois da reunião curta, registra **Reunião realizada**.

O painel registra o envio e a reunião feitos pela equipe. Não há disparo
automático de e-mail/WhatsApp nem automação de apresentação. O cliente vê a
versão fechada em **Relatórios → ROI mensal** e pode baixar o mesmo PDF.
Rascunhos e a revisão das premissas são restritos ao superadmin.

## Regra do ROI

Por procedimento:

`receita estimada = avaliações realizadas de contatos que chegaram fora do
expediente humano × conversão em basis points ÷ 10.000 × ticket em centavos`

A receita é somada por procedimento. A origem usa a **primeira mensagem do
contato, anterior à marcação**, nunca a hora da consulta nem a hora em que o
agendamento foi criado. Contato sem origem identificável não vira “fora”.

`horas estimadas = conversas respondidas pela IA, sem resposta humana no mês
× minutos humanos declarados por conversa ÷ 60`

`custo/hora = custo mensal em centavos ÷ carga mensal em horas`

`economia estimada = horas estimadas × custo/hora`

`ROI = (receita + economia − mensalidade) ÷ mensalidade`

Os valores são explicitamente estimados. Mensalidade zero não gera divisão
por zero: ROI percentual não se aplica. Conversão zero e custo zero são
premissas válidas. Ausência de premissas gera `null`/“Pendente”, nunca um
número financeiro inventado.

## Fontes e limites da medição

- `Message`/`Conversation`/`Lead`: contatos novos atendidos pela IA, conversas
  com resposta do agente, primeira resposta média, mensagens por hora.
- Conversas entram uma vez por mês, classificadas pela primeira interação
  recebida/respondida na competência; a média inclui primeiras respostas
  humanas e da IA, um par por conversa no mês. Uma resposta na virada do mês
  pode corresponder a uma chegada no mês anterior.
- `Appointment`: avaliações criadas pelo agente; agendadas pela criação,
  realizadas pela data da consulta. Canceladas e marcações manuais não contam.
  `serviceType` registra o tipo escolhido em `schedule_meeting`; linhas antigas
  permanecem `null`, sem inferência do título/nome do paciente.
- Clinicorp: confirma presença dos agendamentos **vinculados pelo ID do
  espelho**, sem modificar a agenda local. Nunca associa paciente por nome ou
  telefone e nunca duplica o agendamento local com o espelho. Cancelamento
  externo prevalece; falha de leitura/ID desconhecido deixa presença pendente.
- IDs string preservam 64 bits; números fora da precisão segura são recusados.
- `ReportEvent`: qualificação explícita (lead quente), transbordo e pergunta
  sem resposta. As ferramentas registram eventos idempotentes e o webhook
  registra assunção por reação. `report_unanswered` é observação interna, sem
  vaga de habilidade, pausa ou mensagem adicional. Participa do loop normal
  de ferramentas; a geração do relatório não inicia chamadas de IA.
- Todos os dados operacionais filtram tenant e excluem lead/conversa de teste.
- A implantação **não reconstrói** eventos que nunca foram registrados.
  `Tenant.reportTrackingStartedAt` declara o início da cobertura; contagens
  históricas são apresentadas como registros parciais, não como zero medido.
- O procedimento usa o valor explicitamente guardado na variável configurada
  da conversa ou no evento de qualificação. Valores sem correspondência nas
  premissas não recebem ticket/conversão por aproximação.
- Não há chamada de IA para produzir o relatório. Ajustes e plano são
  escritos/revisados pela Mavellium. P-86 (tráfego) e a fila P-87 ficam fora.

## Histórico, revisão e autorização

`MonthlyRoiReport` é único por tenant + `YYYY-MM`. Premissas são mensais; editar
uma competência não altera outra. Uma competência nova oferece uma cópia das
últimas premissas anteriores, identificada na tela, que precisa ser conferida
e salva para este mês; nunca usa premissas de um mês futuro. Fechar salva um snapshot de métricas,
premissas e textos. O fechamento verifica `updatedAt` para não congelar uma
revisão concorrente. Reabrir é permitido antes do envio; relatório enviado
é preservado. Exportação e tela do cliente usam o snapshot, sem reconsultar o
Clinicorp. Alterações, fechamento, reabertura e entrega entram na auditoria.

As actions e rotas de exportação verificam autorização no servidor. O PDF do
cliente exige papel de produto, tenant ativo, competência fechada e usa apenas
o tenant da sessão, ignorando IDs forjados na query. PDF não inclui dados de
pacientes.

## Arquivos e implantação

- `src/modules/reports/monthly-config.ts`: validação e competências/fusos.
- `src/modules/reports/monthly.ts`: cálculo e carregamento.
- `src/modules/reports/events.ts`: registro explícito, best-effort e idempotente.
- `src/modules/reports/monthly-pdf.ts`: PDF de uma página.
- `src/app/(admin)/admin/relatorios/`: fila mensal, revisão, fechamento, entrega.
- `src/app/(dashboard)/relatorios/MonthlyView.tsx`: apresentação das cinco partes.
- `scripts/check-monthly-roi.ts`: consulta de prontidão no banco configurado.
- `scripts/preview-monthly-roi.ts`: gera PDFs **fictícios** para inspeção visual.

O projeto usa `prisma db push` + `prisma generate`. Na implantação, regenerar o
client e reiniciar **web e worker**; não iniciar o worker em uma amostra de
teste que tenha números/compromissos reais. O novo client é necessário tanto
para `Appointment.serviceType` quanto para os eventos das tools.

Validação: testes de fórmula, limites/fusos, presença, isolamento, autorização,
snapshot, concorrência e PDF A4 de uma página. Typecheck, lint e inspeção visual
dos PDFs de demonstração e de conteúdo máximo.

No banco local consultado em 27/09/2026, não havia tenant com “sorriso” no nome.
O relatório real do Instituto depende do cadastro/conexão no ambiente correto
e dos números do P-78; nenhum dado foi fabricado para a clínica.
