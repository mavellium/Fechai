# Plano: confirmação das avaliações do Clinicorp

Data: 09/10/2026. Status: implementado e publicado; sandbox validado. Ativação QR da conta depende da declaração da clínica.
Base inspecionada: eb9562f. Escopo: confirmar no dia anterior avaliações marcadas
pela recepção ou pelo agente, sem depender da configuração da Meta, e evitar
sobreposição com a confirmação manual.

## 1. Pedido da cliente

Os três áudios foram transcritos localmente. São relatos para análise, não
instruções de execução ou autorização para enviar mensagens a pacientes.

- 10h13: confirmações chegaram para parte dos pacientes de amanhã; pelo menos
  duas não chegaram. Quando a recepção envia, o automático pode mandar em cima.
- 10h18, áudio de cerca de 77s: buscar as avaliações no sistema, inclusive as
  marcadas pela recepção, e confirmar um dia antes. A cliente estima que o agente
  marca apenas 2% das avaliações; isso é relato, não métrica verificada.
- 10h18, áudio de cerca de 39s: o marcador de avaliação, visualmente laranja, é
  o critério esperado. Sem o marcador, não enviar. Ela relata que o fornecedor
  anterior fazia isso sem configurar a Meta; a arquitetura dele não foi verificada.

## 2. O que o código comprova

| Ponto | Situação atual | Consequência |
| --- | --- | --- |
| Agenda externa | listClinicorpAgenda lê consultas; worker roda a cada 5 min | Já existe base para consultas marcadas na recepção |
| Avaliação | Leitura de CategoryId/CategoryDescription e /appointment/list_categories | Pode filtrar categoria, mas falta conferir o marcador real da conta |
| QR | chooseChannel exige lastInboundAt no Fechai e canal diferente de Meta | Paciente sem histórico local não recebe por QR |
| Meta | Para externos exige conexão e template aprovado | Sem QR elegível e sem Meta, envio fica sem canal |
| Manual | Mensagem humana pausa conversa, mas não fecha o lembrete da consulta | Automático não sabe que a recepção já confirmou |
| Duplicação | POST precede marcação em ClinicorpReminder; sem claim por envio | Timeout/reinício/concorrência podem repetir envio |
| Visibilidade | remindersSent mistura enviado com fechado sem envio | Recepção não consegue distinguir todos os motivos |

Arquivos: workers/follow-up-worker/{clinicorp-reminders,reminders}.ts,
src/modules/whatsapp/{evolution,process-incoming}.ts,
src/modules/scheduling/clinicorp.ts e prisma/schema.prisma.

Não consultamos os registros reais da clínica nesta análise. Portanto, o filtro
por canal é uma causa comprovada no código, mas não explica sozinho cada paciente
citado nos áudios. Categoria, telefone, configuração, falha ou entrega precisam
ser conferidos por consulta.

## 3. Meta e viabilidade

A Evolution oferece envio de texto pela sessão conectada do WhatsApp; o adapter
atual já chama /message/sendText. O bloqueio por falta de lastInboundAt está no
Fechai. Não é uma exigência da API da Meta para ler o Clinicorp ou usar esse adapter.
Fonte primária: [envio Evolution](https://github.com/evolution-foundation/evolution-docs/blob/main/docs/05-Endpoints/00-send-plain-text.md).

Na Plataforma oficial da Meta, fora das 24h ou para iniciar conversa, usa-se
modelo aprovado. A política também exige adesão do destinatário e respeito ao
pedido de parar. Usar QR não comprova essa adesão e não garante ausência de
restrições do WhatsApp. [Política oficial](https://business.whatsapp.com/policy?lang=pt_BR).

A proposta exige revisar a restrição de primeiro contato registrada em AGENTS.md,
README de WhatsApp/agenda e ADR-005. Não basta apagar o if: criar opção específica
por conta para confirmações de avaliações pelo QR, com registro da configuração,
pacientes autorizados e controle de envio. Manter o número conhecido do paciente;
quem está vinculado à Meta não deve migrar silenciosamente para o QR.

## 4. Implementação em ordem

### A. Conferência do caso

1. Comparar avaliações de 10/10 com confirmações enviadas em 09/10: IDs das consultas,
   categoria, horário local, telefone válido, canal e resultado. Examinar também
   histórico humano no próprio WhatsApp: ausência no Fechai não prova ausência lá.
2. Confirmar qual ID/campo representa o marcador laranja. Usar o identificador
   estável devolvido pelo Clinicorp; nunca deduzir só pela cor, notas ou nome.
3. Separar: sem categoria, sem telefone, sem canal, fora do horário, já tratado,
   recusado ou sem confirmação de entrega. Não reenviar a lista inteira.

### B. Público e horário

- Selecionar explicitamente a categoria de avaliação da clínica; incluir marcações
  da recepção e do agente, excluindo canceladas/deletadas, testes e outros tipos.
- Usar mecanismo atual: um dia antes, no horário local configurado pela clínica.
  Definir horário de corte para avaliação criada depois desse momento; enquanto
  futura, enviar uma vez dentro da janela acordada ou sinalizar para recepção.
- Se a agenda já foi espelhada pelo Fechai, usar uma identidade comum para não
  disparar nas duas filas. Não importar toda a agenda como Appointment.

### C. Canal pelo QR

- Configurar a modalidade por conta, no lembrete de schedule_meeting, sem nova
  habilidade. QR conectado + telefone válido + destinatário autorizado permitem
  envio a avaliações externas sem depender de lastInboundAt do Fechai.
- Número que pertence a outro canal continua nele. Desconexão espera/sinaliza;
  nunca trocar automaticamente de número. Bloqueio e pedido para parar impedem envio.
- Criar contexto mínimo da consulta ao enviar, sem inventar entrada do paciente,
  adesão ou resposta. Não iniciar follow-up comercial só porque saiu um lembrete.

### D. Envio único e ação manual

- Registro durável por tenant/consulta/versão do horário/momento do lembrete;
  claim condicional antes do POST, compartilhado entre filas e ação manual.
- Estados distintos: aguardando, em envio, aceito, entregue quando confirmado,
  falhou, resultado incerto, tratado manualmente, não elegível; motivo separado.
- Persistir intenção antes de enviar e ID do provedor quando disponível. Timeout
  ambíguo não repete automaticamente: consultar recibo/histórico ou conferir.
- Botões na consulta: "Enviar confirmação agora" e "Já enviei pelo WhatsApp".
  Ambos usam o mesmo registro; o segundo dispensa o automático desse momento.
- Webhook humano/recibos reconciliam quando há vínculo confiável à consulta.
  Texto parecido sozinho não fecha todas as consultas do paciente. Envio no
  celular sem vínculo confiável precisa da ação explícita; não prometer deduplicação
  absoluta antes de o webhook chegar.
- Remarcação invalida o lembrete do horário anterior; cancelar interrompe pendentes.
  Confirmar presença é separado de enviar pedido de confirmação e de comparecer.

### E. Painel e resposta do paciente

- Na agenda, mostrar por consulta o estado, canal, horário e motivo da ausência;
  resumo do dia com avaliações elegíveis, tratadas e que exigem conferência.
- Resposta entra na conversa com vínculo à consulta externa correta. Não prometer
  confirmação/cancelamento gravado no Clinicorp sem método e resultado comprovados;
  quando necessário, a recepção ajusta lá. Isso não bloqueia o envio do lembrete.

## 5. Testes de aceite

1. Recepção marca avaliação no Clinicorp; paciente autorizado sem conversa no
   Fechai; apenas QR ligado → uma confirmação no dia anterior, recebida no celular.
2. Mesma consulta sem marcador/consulta de outro tipo → nenhum envio.
3. Consulta do agente espelhada no Clinicorp → uma mensagem, não uma por fila.
4. Recepção usa enviar agora ou já enviei → automático do mesmo momento não sai.
5. Dois workers/reinício → um claim; timeout após possível aceite → conferência,
   sem repetição automática.
6. Remarcação/cancelamento, telefone inválido, bloqueado, pedido de parar,
   canal desconectado ou categoria desconhecida → resultado correto e motivo visível.
7. Virada de dia/fuso/consulta criada após horário de corte → não perde nem duplica.
8. Registro antigo sem evidência não migra como entregue. Resposta "sim" tem contexto
   correto e nunca vira comparecimento automaticamente.

## 6. Liberação e documentação

Validar primeiro com números controlados e uma consulta de teste identificada no
Clinicorp. Depois acompanhar um dia completo na conta da cliente: total elegível,
aceites, entregas comprovadas, manuais, impedidos e incertos. Critério: cada avaliação
elegível deve ter uma mensagem comprovada ou um motivo acionável; nenhuma duplicação
nos cenários controlados. Teste real não deve virar disparo para a agenda inteira.

Schema novo pede db push + generate na imagem de web/worker, migração conservadora
do histórico e opção inicialmente desligada nas demais contas. Atualizar ADR-005,
READMEs de WhatsApp/agenda/worker, contexto .claude/context/scheduling e CHANGELOG
após implementação. Publicar e conferir web/worker e um ciclo real da fila.


## Implementação e validação (09/10/2026)

- QR opcional por conta, desligado por padrão; seleção resolve os IDs reais das
  categorias e registra a declaração de autorização ao salvar.
- Agenda: enviar agora ou registrar confirmação já enviada pela equipe. O mesmo
  registro é usado na fila automática; mensagem enviada fora do painel exige
  usar “Já enviei pelo WhatsApp”. Não inferimos confirmação por texto genérico.
- `ReminderDispatch`: claim SQL antes do POST; consulta espelhada usa a chave
  Clinicorp. Timeout, resposta sem ID ou processo interrompido exigem conferência.
- `ReminderReceipt`: callbacks autenticados; chegada antes do commit e eventos
  fora de ordem tratados. Envio aceito não comprova entrega.
- Configuração, consulta e conexão conferidas antes do envio. Cancelamento ou
  remarcação durante a fila bloqueiam a mensagem antiga.
- Botão de teste adiciona o texto à conversa de teste existente do agente. Teste
  posterior pela operação usa esse mesmo caminho e verifica resposta do agente;
  não envia WhatsApp, não grava no Clinicorp e não comprova entrega real.
- Smoke com PostgreSQL isolado passou: concorrência, confirmação manual, timeout,
  reinício, remarcação e recibos antecipados/fora de ordem.
- Publicação, conferência da categoria real da clínica e resultado do sandbox:
  registrar após execução. Não ativar QR de todas as contas na migração.

Verificações locais concluídas: **1.619 testes**, lint e build passaram.


## Resultado após a publicação

- Commit funcional `d71d73c`; [publicação](https://github.com/mavellium/Fechai/actions/runs/37943122010)
  concluída: schema aplicado, client gerado, web e worker saudáveis.
- [Teste na conta autorizada](https://github.com/mavellium/Fechai/actions/runs/37944702133/attempts/2)
  passou às 11h33 de 09/10: SQL real validou posse concorrente, manual, timeout,
  reinício, remarcação e recibos antecipados/monotônicos. Primeira tentativa não
  executou por timeout de conexão SSH; repetição conectou e passou.
- Leitura real do Clinicorp para 10/10: **13 consultas**; categoria **Avaliação**
  resolvida como `6365429488680960`. Isso identifica a categoria pelo cadastro,
  não comprova a cor visual nem conta todas as consultas como avaliações.
- O texto salvo foi inserido na conversa de teste existente. O agente respondeu,
  salvou a resposta (120 caracteres), sem ferramentas ou chamadas externas
  bloqueadas. A consulta sintética foi removida; histórico de teste preservado.
- Nenhum envio WhatsApp ou alteração Clinicorp foi feito pelo teste. Portanto,
  entrega no celular e confirmação/cancelamento gravados no Clinicorp **não**
  foram comprovados. O aceite do teste substitui apenas a conferência da mensagem
  e da resposta, conforme escolha do usuário.
- A opção QR estava **desligada** na conta, sem declaração/categorias novas
  gravadas. Não se inventou autorização dos pacientes. Ativar em Agentes →
  Agendar horário → Lembretes: selecionar Avaliação, habilitar confirmação pelo
  QR, ler os termos, aceitar os riscos e informar o responsável no modal.
  O botão “Aceitar e ativar confirmações” salva o aceite e a configuração.

## Revisão: termos de risco antes da ativação

Pedido de 09/10: modal para a opção Evolution, com texto sobre integração não
oficial, restrição/suspensão/bloqueio do número, limites das proteções e API
oficial como alternativa. Checkbox e nome obrigatórios; só ativa após gravação
validada pelo servidor. Cancelar/Esc/fechar não ativa. Usuário/data/texto/versão
ficam no JSON da ação e o evento vai à auditoria. Aceite antigo sem prova atual
não libera QR; desligar preserva a prova, reativar pede novo aceite. Não se aceita
em nome da clínica durante os testes. Sem mudança de schema.

Teste local da interface utiliza o componente real em ambiente isolado: campos
obrigatórios, cancelar/Esc, reabertura sem aceite automático, espera do servidor,
erro inline, sucesso e layout desktop/mobile. Actions testam isolamento por
conta, POST incompleto/forjado, normalização do nome e versão do texto.
Verificação local: **1.644 testes**, lint e build passaram. A interface real
`ScheduleSettings` + diálogo, em desktop/mobile com servidor simulado, validou
também POST completo e saída após salvar sem falso aviso de rascunho. Nenhum
aceite foi gravado para a clínica nem mensagem externa enviada.
Publicação funcional `ad77741`: [execução concluída](https://github.com/mavellium/Fechai/actions/runs/37949905017),
web/worker saudáveis e HTTP 200 com banco/Redis OK. [Teste posterior](https://github.com/mavellium/Fechai/actions/runs/37950488018)
passou às 12h16 de 09/10: proteção dos termos validada no runtime publicado,
SQL de claim/recibos, leitura do Clinicorp e resposta do agente no sandbox salva
(202 caracteres, nenhuma ferramenta/chamada bloqueada). A consulta sintética
foi removida. QR continuou desligado, sem aceite ou consentimento registrados
para a clínica; não houve envio WhatsApp nem escrita no Clinicorp.

A interface foi testada localmente com os componentes reais e servidor simulado;
o acesso de navegador ao painel de produção não foi verificado nesta execução.
O teste no sandbox não comprova entrega no celular. A atualização documental
posterior não altera o código funcional testado.
