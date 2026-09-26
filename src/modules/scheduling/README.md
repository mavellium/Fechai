# Agenda (scheduling)

A agenda do fechai é a **fonte da verdade**. Google Agenda e Clinicorp são
espelhos opcionais, ligados por conta (tenant). Nenhum dos dois pode derrubar um
atendimento: as funções de integração **nunca lançam** — a falha é registrada e
mostrada no painel, e o horário combinado com o lead continua de pé.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `repository.ts` | Toda leitura/escrita da agenda. Filtra por `tenantId` sempre. A tela, as server actions e a tool `schedule_meeting` passam por aqui. |
| `config.ts` | `ScheduleConfig` (expediente, fuso, duração padrão + variações) em `TenantAction.config`, chave `schedule_meeting`. Por agente. |
| `time.ts` | Fuso: `parseLocalDateTime`, `partsInZone`, `monthRangeUtc`. Nada de data no projeto sem passar por aqui. |
| `google.ts` | Espelho no Google Agenda (OAuth por tenant). |
| `clinicorp.ts` | Espelho + leitura de disponibilidade no Clinicorp (Basic auth por tenant). |
| `features.ts` | Quais calendários a conta habilitou em /integracoes. |

## Configuração do agendamento por agente

### Grade semanal

`weeklyAvailability` guarda sete listas de `{ start, end }` em minutos locais,
domingo primeiro. Os intervalos são fechados no início e abertos no fim;
`1440` representa 24:00. Lista vazia fecha o dia; sete listas vazias fecham toda
a semana, sem cair no expediente padrão. A escrita valida os limites e une
períodos adjacentes; uma grade malformada na leitura nunca reabre horários.

`WeeklyAvailabilityGrid` substitui os campos de dias, abertura, fechamento e
pausas. Arrastar seleciona um retângulo de dias e horas; iniciar sobre um bloco
preenchido remove. Há desfazer, teclado, seleção do dia inteiro e visualização
em blocos de 60/30/15 minutos. Trocar a visualização não arredonda os períodos:
horários parciais aparecem parcialmente preenchidos. Pausas são os espaços
desmarcados entre períodos e podem variar de um dia para outro.

Configurações sem a propriedade continuam usando `workdays`, `startTime`,
`endTime` e `breaks`. `getWeeklyAvailability` converte esses dados sem perder
minutos nem pausas, e a nova tela grava a grade na próxima confirmação.
Não remova a compatibilidade de leitura sem migrar as linhas existentes.
`slotStartTimes(cfg, weekday)`, a validação de marcar/reagendar e o prompt usam
os períodos do dia. A consulta de conflitos cobre o dia local completo, inclusive
o último bloco até meia-noite. Regressões em `weekly-availability*.test.ts` e
`agendamento-tools.test.ts`.

Em Agentes › Ações › Agendar horário, `TenantAction.config` guarda também:

- `allowCancellation` e `allowRescheduling`: desligados por padrão, inclusive
  para configs antigas. As ferramentas de cancelar/reagendar só são expostas
  quando a opção e a ação principal estão ligadas; o handler relê essa permissão.
- `recognizeExisting`: ligado por padrão. Acrescenta ao contexto os próximos
  horários do contato na nossa agenda, mesmo sem estarem no histórico recente.
  Retorno e confirmação de lembrete não devem reiniciar o agendamento.
- `durations`: lista de `{ label, minutes }`, vazia em configs antigas e no caso
  comum. São tipos de atendimento com duração própria ("Limpeza · 30 min"), não
  um catálogo de serviços: só existe aqui o que muda o tamanho do bloco.
  `durationMinutes` continua sendo **o padrão** — o bloco de quem não disse o
  tipo, e a grade de `slotStartTimes`/`listFreeSlots`. O agente recebe a lista no
  prompt e devolve o nome em `tipoAtendimento`; `resolveDuration()` compara sem
  caixa nem acento e **cai no padrão quando o nome não existe**, porque um bloco
  do tamanho errado a clínica corrige e um lead perdido não. Nesse caso a
  resposta da tool avisa o LLM, para ele não confirmar ao contato um tipo que a
  agenda não registrou. Variação sem nome, fora de 5–480 min ou com nome
  repetido é descartada na leitura (`parseScheduleConfig`) e recusada na escrita
  (`validateDurations`) — nome repetido o agente não teria como escolher.
  `list_available_slots` continua listando a grade do padrão: uma grade por
  variação daria listas concorrentes para o mesmo dia. Um tipo mais longo que
  não couber é recusado por `schedule_meeting`, que já devolve os livres junto.
  Com o Clinicorp habilitado **e** conectado, a tela oferece trazer os nomes de
  lá (`loadClinicorpDurationNamesAction`) — ver "Tipos de atendimento" abaixo.
- `breaks`: lista de `{ label, startTime, endTime }`, vazia em configs antigas.
  Pausas repetem-se nos dias atendidos. O formulário recusa sobreposição,
  intervalos invertidos e pausas fora do expediente. `isWithinBusinessHours`
  recusa qualquer consulta que atravesse uma pausa; encostar é permitido.
- `blockedDates`: dias em que o negócio não atende (feriado, recesso), lista de
  `{ date, label }` com `date` em `YYYY-MM-DD` **no fuso do negócio** — é um dia
  do calendário de quem atende, não um instante; guardar UTC faria o bloqueio
  escorregar de dia. É a **exceção da grade**: a grade só conhece dia da semana,
  então sem isto 25/12 numa quarta é só mais uma quarta. `isWithinBusinessHours`
  checa `isBlockedDate` **antes** da grade, e por isso `listFreeSlots` e
  `schedule_meeting` já herdam a recusa — nenhum dos dois precisou mudar.
  `scheduleSystemContext` lista só as datas **futuras** (teto
  `MAX_BLOCKED_DATES_IN_PROMPT`) para o agente explicar em vez de só recusar.
  A lista é **manual de propósito**: feriado nacional não é feriado para toda
  clínica (muitas atendem), municipal não caberia numa tabela nossa e recesso
  não é feriado nenhum — uma lista automática erraria dos dois lados. Config
  antiga não tem o campo e vira lista vazia, que é o comportamento que ela já
  tinha. `parseBlockedDates` aceita também uma lista de strings simples.
- `reminderEnabled` e `reminders`: os lembretes pré-consulta. Ver a seção abaixo.

## Lembretes de consulta

Entre "marcado" e o dia da consulta não havia nenhum contato, e cadeira vazia
por paciente que esqueceu é o custo que a clínica mais sente. Com a opção
ligada, o agente manda mensagens antes do horário.

**É configuração da ação `schedule_meeting`, não uma ação nova.** Lembrete sem
agendamento não existe — não há consulta para lembrar — e uma ação própria
consumiria outra vaga do limite do plano para cobrar de novo pelo que a conta
já ligou. Como toda config de ação, só age com a ação **ligada**: a varredura
filtra `TenantAction.enabled`, mesma regra de `getActiveHandoffConfig`.

### São vários, não um

`reminders` é uma **lista** de `{ minutesBefore, template }`, ordenada do mais
distante para o mais próximo. Uma clínica costuma querer mais de um ("1 semana
antes" para dar tempo de remarcar, "2 horas antes" para quem já esqueceu), e
cada disparo diz algo diferente — por isso o texto mora em cada linha, e não
num template único para todos.

**Não há teto de quantidade.** Quantos lembretes o paciente aguenta é decisão
de quem conhece a própria base. A tela avisa em bloco a partir de
`REMINDER_COUNT_WARNING` (10) e interrompe com um popup ao ultrapassar — uma
vez por edição, porque aviso repetido treina a pessoa a fechar sem ler. O que
está em jogo é que **quem leva o bloqueio no WhatsApp é o número da clínica**,
e um número bloqueado deixa de alcançar também os outros pacientes.

**A antecedência vai de minutos a semanas** (`REMINDER_UNITS`), guardada em
minutos — a unidade é só a forma de digitar, como em `FollowUpStep.
delayMinutes`. `splitReminderLead()` devolve o valor na maior unidade inteira,
que é como a tela reabre o que foi salvo (1440 vira "1 dia", não "1440
minutos"). Teto por lembrete: `MAX_REMINDER_MINUTES` (8 semanas).

**Dois lembretes no mesmo momento são recusados** (`validateReminders`, na tela
e no servidor): "1 dia" e "24 horas" digitados sem perceber que são a mesma
coisa chegariam como duas mensagens coladas.

Lembretes com antecedência em dias ou semanas podem ter `sendTime` (`HH:mm`):
o disparo ocorre nesse horário do dia local calculado antes da consulta, usando o fuso
da agenda. Por exemplo, `minutesBefore: 1440` e `sendTime: "08:30"` disparam
às 08h30 da véspera, mesmo que a consulta seja às 15h. Sem `sendTime`, a
antecedência continua sendo uma duração exata, como nas configs antigas. O
worker amplia o teto da busca em até um dia para incluir consultas noturnas
cujo lembrete fixo vence na manhã da véspera. `remindersSent` continua usando
`minutesBefore` como identidade do disparo.

**Configs antigas continuam valendo.** Antes o lembrete era um só, em
`reminderMinutesBefore` + `reminderTemplate`. `parseScheduleConfig` lê os dois
formatos e converte na leitura, dando preferência à lista. **Não remova esse
fallback** sem migrar as linhas — mesma lição do `delayHours` do follow-up.

### O texto é template, não IA

Cada `template` aceita `{{nome}}`, `{{data}}`, `{{hora}}` e `{{local}}`
(`REMINDER_VARIABLES`), substituídos por `renderReminder()`. Gerar cada
lembrete por LLM gastaria a cota do plano (`modules/billing/usage.ts`) para
produzir uma frase que precisa sair igual todas as vezes. Duas regras dessa
função:

- **`{{local}}` já vem com a preposição** e some quando a conta não configurou
  local — o template padrão escreve `às {{hora}}{{local}}.` por isso, senão
  sobraria "às 15:00 em ." na mensagem.
- **Token desconhecido é apagado**, não impresso cru: `{{medico}}` vira um
  buraco na frase, que é ruim, mas melhor do que mandar `{{medico}}` ao
  paciente. A tela mostra a prévia já substituída justamente para esse erro
  aparecer antes de salvar.

Contato sem nome cadastrado existe, então a limpeza final tira espaço e
pontuação órfãos: "Oi {{nome}}!" não pode virar "Oi !".

### Lembretes de UMA consulta (`reminderOverride`)

O padrão do agente serve ao caso comum, não a toda consulta: um procedimento
que exige preparo pede um aviso que a consulta de rotina não pede. Por isso
`Appointment.reminderOverride` (Json), editado no botão "Lembretes" de cada
compromisso em `/agenda`. Três estados, e a diferença entre os dois últimos é
o motivo de ser Json e não uma relação:

| valor | significado |
| --- | --- |
| `null` | segue os lembretes do agente (o caso comum) |
| `[]` | esta consulta **não recebe** lembrete nenhum |
| `[...]` | esta consulta usa exatamente estes |

Tratar `[]` como "não configurado" faria a consulta que a clínica marcou para
não lembrar receber os lembretes do agente assim mesmo. `remindersFor()` é
quem resolve isso, e o override vale **mesmo com o lembrete desligado no
agente** — são duas decisões diferentes.

**"Os lembretes do agente" são os gerais da conta**: os do agente principal
(o que atende o WhatsApp), não os do `Appointment.agentId`. É o que `/agenda`
mostra no modal, e o worker lê a mesma fonte. Seguir o `agentId` gravado
deixava sem lembrete a consulta marcada antes de trocar o agente do WhatsApp
(ou de um agente apagado), até alguém salvar um override nela.

### O que já foi enviado

**`Appointment.remindersSent`** guarda as antecedências (em minutos) dos
disparos que já saíram. É uma **lista, não um booleano**: uma consulta tem
vários disparos e cada um precisa ser marcado sozinho, senão o primeiro
calaria todos os outros. E fica em `Appointment`, não em `Conversation` como o
`followUpSentAt` do follow-up, porque o lembrete é **por consulta** — o mesmo
paciente marca de novo no mês seguinte e precisa ser lembrado outra vez.

`reminderSentAt` é só para a tela ("lembrete enviado há 2h") e **só é gravado
quando uma mensagem de fato saiu**: um disparo fechado sem envio faria essa
frase mentir.

Mudar a régua de uma consulta não reenvia o que já saiu — os marcados
continuam marcados.

Quem envia é `workers/follow-up-worker/reminders.ts`, na mesma varredura
periódica do follow-up (ver o README de lá, que documenta as regras de janela
e de consulta atrasada). A mensagem entra na conversa como `role: "assistant"`,
e é isso que faz a resposta do paciente ("não vou poder") cair no
`runAgentTurn` normal — com `recognizeExisting` dando o contexto da consulta,
cancelar e reagendar já existentes atuam sem código novo.

Regressões: `tests/agendamento-lembrete.test.ts`.

`agent-engine/scheduling-tools.ts` fornece `list_appointments`, `cancel_meeting`
e `reschedule_meeting`, como capacidades da mesma ação (sem consumir novas
ações do plano). Consulta e alteração filtram por tenant e lead. O prompt exige
identificar a consulta, perguntar a confirmação e esperar a resposta clara;
os handlers recusam alterações sem `confirmed: true`. A interpretação da
confirmação na conversa cabe ao LLM.

Reagendar preserva o ID e a duração da consulta original, valida expediente,
pausas e conflitos **antes** da alteração e sincroniza os espelhos. O conflito
ignora somente o ID local e o ID espelhado da própria consulta. Falha de
disponibilidade preserva o original; falha de espelho mantém o novo horário
na agenda local. Uma atualização concorrente impede a alteração.
Se remover o espelho antigo falhar, não cria uma segunda cópia nesse serviço e
preserva o ID antigo para uma tentativa posterior de cancelamento.

`schedule_meeting` recusa duplicar uma consulta existente, salvo pedido de uma
consulta adicional (`additionalAppointment: true`); trocar data usa reagendamento.
O agente exige `patientName`: quem conversa no WhatsApp pode marcar para outra
pessoa. Esse nome vai em `Appointment.patientName`, no título da agenda e em
`PatientName` no Clinicorp; `Lead.name` continua sendo o nome do contato. Quando
os dois nomes diferem, a integração não associa o prontuário encontrado pelo
telefone do contato à paciente nem grava esse telefone como sendo dela. Se o
Clinicorp exigir telefone do paciente, o espelho pode falhar; a consulta local
permanece e a falha aparece no painel. Reagendar preserva o nome salvo na consulta.
Regressões: `tests/agendamento-config.test.ts` e `tests/agendamento-tools.test.ts`.

## Onde cada coisa acontece

- **`/integracoes?aba=calendarios`** — habilitar E configurar. O toggle grava em
  `CalendarFeatures`; ligado, o formulário de credenciais daquele calendário
  abre dentro do mesmo card (`CalendarFeatureToggles`, prop `panels`).
- **`/agenda`** — só o **status** (`CalendarSyncStatus`): "conectado · enviando e
  recebendo", com link para gerenciar. Nada de formulário: quem olha a agenda
  quer saber se o horário que vai marcar chega na clínica, não preencher token.

Desabilitar **não apaga credencial** (isso é desconectar) — quem desliga por uma
semana reencontra tudo ao religar. Mas desabilitar **para a sincronização de
verdade**: a checagem mora em `getIntegration()` (clinicorp) e em
`pushEventToGoogle()`, no caminho por onde toda chamada passa, não só na
renderização.

A exceção é **cancelar**: `cancelAppointmentInClinicorp` usa
`ignoreFeatureFlag: true` e `deleteEventFromGoogle` não checa a flag. Cancelar um
horário aqui tem que sumir com ele lá mesmo depois de desabilitar — senão fica um
paciente fantasma na agenda da clínica.

Os cards (`GoogleCalendarCard`, `ClinicorpCard`) vivem em `(dashboard)/integracoes/`
e são **painéis**, não cards: sem título nem moldura próprios, porque o card do
toggle já os fornece — repetir dava dois "Google Agenda" na mesma caixa.

## Credenciais cifradas

`ClinicorpIntegration.apiUser` e `.apiToken` ficam cifrados com AES-256-GCM
(`src/lib/crypto.ts`), chave em `ENCRYPTION_KEY`. Isso protege um dump do banco;
não protege quem já tem a chave **e** o banco.

Regras:

- **Nunca leia a linha do banco direto.** `getIntegration()` é o único caminho de
  leitura e devolve as credenciais já decifradas; `saveClinicorpCredentials()` é
  o único de escrita e cifra. Uma tela que fizesse `prisma.clinicorpIntegration.
  findUnique()` mandaria o token cifrado no header Basic e colheria um 401 difícil
  de diagnosticar.
- Credencial que não decifra (chave trocada, linha corrompida) vira `null`, o que
  para o módulo é igual a "não conectado" — a pessoa reconecta na tela.
- Isso é o **oposto de senha de usuário**, que usa hash e nunca é lida de volta
  (`src/lib/password.ts`). O token do Clinicorp precisa voltar em texto claro.

## Conflito de horário: duas funções, não uma

- `hasConflict(tenantId, startsAt, endsAt, ignoreId?)` — só a nossa base.
- `hasConflictAnywhere(tenantId, startsAt, endsAt, timezone, ignoreId?)` — a
  nossa base **e** a agenda do Clinicorp.

Use `hasConflictAnywhere` em qualquer caminho que marque horário (a tool do
agente e a criação manual já usam). `hasConflict` continua existindo porque a
consulta local é barata e vem primeiro: quando ela já acusa conflito, não se
gasta uma chamada de rede.

Sobreposição é `início < fimExistente && fim > inícioExistente`. Encostar não é
conflito: 14:00–15:00 e 15:00–16:00 convivem.

## Horários livres: o agente só oferece o que está vago

O expediente no prompt diz quando atendemos, **não o que está livre**. Sem mais
nada, o agente sugeria um horário já ocupado, o contato aceitava e só então
`schedule_meeting` recusava — e o agente voltava atrás pedindo outra data.

- `listFreeSlots(tenantId, cfg, date)` (repository) devolve os inícios livres de
  um dia local pelas **mesmas regras da gravação**: dia atendido, expediente,
  pausas, antecedência (`>=`, igual à recusa de `schedule_meeting`) e conflito na
  nossa base e no Clinicorp (`listClinicorpBusyBlocks`, uma chamada por dia).
  A integração nunca lança: devolve `null` se não conseguiu conferir. O repository
  converte isso em `AvailabilityUnavailableError`; a tela mostra o erro e o agente
  encerra o turno sem oferecer ou confirmar novos horários. `[]` significa uma
  agenda realmente vazia ou a consulta externa desabilitada.
- Candidatos: `slotStartTimes(cfg)` (grade da duração, recomeçada no fim de cada
  pausa) mais o fim de cada compromisso ocupado, para um encaixe fora da grade
  não sumir.
- Tool `list_available_slots` (`date` + `days` até 14 + `excludeDates` +
  `excludeWeekdays`), sempre exposta com o agendamento ligado. Sem uma data exata pedida pelo contato, ela
  pesquisa 14 dias por padrão e devolve até cinco dias com vaga, cada um com o
  expediente daquele dia e os horários realmente livres. Datas que o contato
  recusou entram em `excludeDates`; dias da semana recusados (como quinta e
  sexta) entram em `excludeWeekdays`. Nenhum deles volta nas opções; o prompt manda
  avançar para o próximo dia da grade em vez de insistir. A tool continua sendo
  obrigatória antes de sugerir ou aceitar qualquer horário.
- A recusa por conflito em `schedule_meeting` e `reschedule_meeting` já oferece
  alternativas conferidas (`offerAlternativeSlots`), para a segunda sugestão não ser outro
  chute. A lista é orientação: `hasConflictAnywhere` continua sendo a checagem
  final antes de gravar (alguém pode marcar entre a consulta e a confirmação).

## Clinicorp

Sistema de gestão de clínicas. Documentação: `https://api.clinicorp.com/api-docs/`
(o spec real está embutido em `swagger-ui-init.js`, não em `swagger.json` — esse
devolve o HTML do Swagger UI).

**Autenticação: HTTP Basic, não OAuth.** Usuário = "Usuário API", senha = "Token
API", ambos gerados pela clínica em *Gerenciar Assinatura › Acesso Externo e
Integrações*. Por isso a pessoa cola as credenciais na tela (`ClinicorpCard`) em
vez de passar por um consentimento — e por isso a tela precisa dizer onde achar
esses campos. As credenciais são **do cliente** e ficam em
`ClinicorpIntegration`, uma linha por tenant, nunca em env.

Base: `https://api.clinicorp.com/rest/v1`. Quase todo endpoint pede
`subscriber_id`.

### O que a integração faz

1. **Espelho** (`pushAppointmentToClinicorp`) — `POST /appointment/create_appointment_by_api`.
   O id que volta é gravado em `Appointment.clinicorpAppointmentId`. Cancelar
   aqui chama `POST /appointment/cancel_appointment`.
2. **Disponibilidade** (`hasClinicorpConflict`) — `GET /appointment/list` do dia,
   com `includeAssigns` para trazer também eventos e bloqueios (almoço, férias):
   para o agente, esses horários são tão ocupados quanto uma consulta.

### Regras que não são óbvias

- **Ids são inteiros e ficam como `String` no banco.** O exemplo
  `4791226171916288` cabe no `Number` seguro do JS; nem todo inteiro de 64 bits
  cabe. O envio valida a faixa segura antes de converter, recusando ids fora
  dela em vez de arredondar e enviar para outra clínica/profissional/paciente.
- **A data vai como dia local, não instante UTC.** `fromTime`/`toTime` são hora
  local (`HH:mm`) e `date` é o dia local em ISO com `T00:00:00.000Z`. Mandar o
  instante UTC cru jogaria horários da manhã no Brasil para o dia anterior.
- **Chat de teste marca em todas as integrações**, como um contato real — é assim
  que o dono vê o fluxo inteiro. Só muda o paciente: o telefone do sandbox é
  sintético (`sandbox:<agente>`), então o envio vai **sem telefone e sem
  cadastro de paciente**, com `PatientName` "TESTE fechai" e nota dizendo que
  pode excluir. Exigir telefone gravava "Vincule um contato com telefone" no
  card; usar os dígitos do id criava paciente com celular inventado.
- **`IgnoreSameName: "X"` ao criar paciente.** Sem isso o Clinicorp recusa quando
  já existe alguém com o mesmo nome — e "João Silva" repetido é rotina numa base
  de pacientes. O telefone é o que de fato distingue, e ele já foi consultado
  antes (`GET /patient/get?Phone=`, que aceita qualquer formato; mandamos só
  dígitos).
- **Falha na consulta de disponibilidade devolve `null`.** Com a checagem
  habilitada, uma falha, credencial ilegível ou resposta incompleta não prova que
  o horário esteja livre. Nenhuma reserva nova é confirmada até conseguir
  conferir; consultas já combinadas são preservadas. Desligar a integração ou
  `checkAvailability` continua permitindo usar só a agenda local.
- **`syncEnabled` e `checkAvailability` são independentes.** Uma clínica pode
  querer só enviar, sem a leitura extra a cada horário oferecido.
- **Filtro por profissional só quando a conta fixou um** (`dentistId`). Com
  dentista definido, a agenda de um colega não bloqueia o horário; sem ele, o
  agendamento é da clínica e tudo conta.
- **`lastError`/`lastErrorAt`** existem para a tela avisar que a credencial
  venceu. Sem isso, um token expirado só apareceria quando a clínica reclamasse
  de um paciente que não chegou na agenda. **O erro gravado tem que se explicar
  sozinho**: `pushAppointmentToClinicorp` prefixa de quem é o agendamento e para
  quando ("Agendamento de Maria para seg., 14 de set., 16:30, salvo só no
  fechai."), o motivo diz o que fazer, e `clinicorpReason()` repassa o texto que
  o próprio Clinicorp escreveu (JSON `message`/`error`; página HTML é ignorada).
  O card mostra ainda "há 3 horas" (`lastErrorWhen`, formatado no servidor).
  Quem chama o push recebe só o motivo, sem o prefixo — já tem o contexto.

### Confirmação de envio e preferências

- `pushAppointmentToClinicorp` devolve `ClinicorpSyncResult`: `synced` com id,
  `failed` com motivo ou `skipped` quando desligado/sem conexão. HTTP 200 vazio,
  objeto de erro e resposta sem id válido **não são confirmação de criação**.
  Só uma criação confirmada atualiza `lastSyncAt` e limpa o erro de envio.
- `createAppointment` conserva o compromisso local e devolve esse resultado.
  A criação manual mostra aviso de falha; a ferramenta do agente não afirma
  que o horário já aparece no Clinicorp. A agenda indica o envio por compromisso
  usando `clinicorpAppointmentId`, inclusive quando outro envio posterior deu certo.
- A recusa explícita "horário ocupado" retorna `failed` com `reason: "conflict"`.
  Uma tentativa nova é cancelada localmente, sem promover o lead a agendado nem
  enviar ao Google. Ao reagendar, o horário original é reposto e seus espelhos
  são restaurados. Falha genérica do espelho continua preservando a consulta.
  **Conflito não transfere para humano.** `offerAlternativeSlots` consulta até
  três opções livres nos próximos 14 dias, com a duração do atendimento, e exclui
  o intervalo recusado mesmo se a leitura externa estiver desatualizada.
  `ToolContext.replyOverride` entrega essas opções diretamente e pede a escolha
  do contato antes de reservar outra. A conversa permanece com o agente.
  Regressões em `clinicorp.test.ts`, `agendamento-tools.test.ts` e
  `agente-desligado.test.ts`.
- O contato com telefone é obrigatório no formulário manual quando o envio ao
  Clinicorp está ativado; sem espelho continua opcional. O servidor também valida.
- Profissional, clínica e categoria são campos controlados no formulário. O
  envio usa `onSubmit` + `startTransition` + `useActionState`, sem `<form action>`:
  seu reset nativo altera até um select controlado sem disparar `onChange`.
  Uma lista que falhou ao
  carregar não apaga a opção salva, e o erro permite tentar carregar novamente.
- Os três são `SelectMenu` (`components/ui/select-menu.tsx`), **não o `<select>`
  nativo**: o menu nativo é pintado pelo sistema operacional e abre uma lista
  clara sobre este painel escuro, ignorando os tokens da marca — não há CSS que
  alcance aquele popup. Três consequências de trocar, todas já tratadas aqui:
  - **A opção vazia precisa existir na lista.** `SelectMenu` cai na primeira
    opção quando o valor atual não está entre elas (`Math.max(findIndex, 0)`),
    então sem um `{ value: "" }` explícito o botão mostraria a primeira clínica
    como se estivesse escolhida, e o envio falharia contradizendo a tela.
  - **A carga preguiçosa mudou de gatilho.** Profissionais e categorias são
    chamadas de rede feitas só quando a pessoa abre o menu; o `<select>` usava
    `onFocus`/`onMouseDown`, que o `SelectMenu` não expõe (o controle é um
    `<button>`). O disparo vive num `onPointerDownCapture` no wrapper, que
    acontece antes do clique que abre o menu.
  - **Não há validação nativa.** O `required` do `<select>` sumiu junto; quem
    recusa clínica vazia é `clinicorpSettingsSchema` no servidor, com mensagem
    exibida no `Alert` do formulário.
  - O rótulo é um `<p id>` + `labelledBy`, não o `<label>` do `Field`: aquele
    associa por `htmlFor` a um controle nativo, que o `SelectMenu` não é.
- Categorias vêm de `GET /appointment/list_categories`. Mantemos o nome na coluna
  existente e resolvemos o `CategoryId` antes de enviar, exigindo nome único.
  Categoria ausente ou duplicada gera aviso para corrigir no Clinicorp. Não há
  alteração de schema. **Categoria “Avaliação” é diferente de `Procedures`**
  (“Avaliação para aparelho”, por exemplo); este campo ainda não é configurado aqui.
- `getClinicorpStatus` é a leitura de metadados para as telas, passando pela
  decifragem sem expor as credenciais. “Credenciais salvas” não garante envio.
  “Testar conexão” consulta a clínica pela API, sem criar dados, sem atualizar
  `lastSyncAt` e sem apagar um erro anterior de criação.
- Regressões: `tests/clinicorp.test.ts` e `tests/clinicorp-actions.test.ts`, com
  API e banco simulados. Nenhum teste cria agendamentos na conta de um cliente.

### Tipos de atendimento: a API não tem duração

O botão "Trazer tipos do Clinicorp" (Agentes › Agendar horário › Durações por
tipo de atendimento) importa **só os nomes**. Isso não é economia de escopo — a
API não expõe duração por tipo, e vale conferir antes de tentar de novo:

| Endpoint | O que devolve | Duração? |
| --- | --- | --- |
| `/appointment/list_categories` | `id`, `Description`, `Color` | não |
| `/procedures/list` | `ProcedureName`, `ProcedureExpertiseName`, `PriceListId`, `Type` | não (é tabela de **preço**) |
| `/group/list_subscribers_clinics` | `SlotTime` | sim, mas **da clínica inteira** ("se o slot for 30, este é o tempo de consulta da clinica"), não por tipo |

Por isso cada linha importada nasce com o campo de minutos **em branco**, e o
`required` do input mais o `superRefine` de `saveScheduleConfigAction` (mensagem
com o nome do tipo) obrigam a preencher antes de salvar. Preencher com um chute
— a duração padrão, ou o `SlotTime` — faria a tela afirmar um dado que a clínica
nunca informou, e ninguém revisa um campo que já parece respondido.

Outras regras do botão:

- **Só aparece com `clinicorpEnabled` E credencial salva** (`getClinicorpStatus`
  devolve `null` sem credencial). Para as outras contas seria um botão que só
  sabe dizer "não está conectado". Esconder não é autorização: a action confere
  a flag de novo no servidor.
- **Importar não sobrescreve.** Quem já ajustou "Limpeza" para 30 min não perde
  isso ao clicar; a comparação é por `normalizeDurationLabel`, e só o que falta
  é acrescentado. Nome repetido no Clinicorp entra uma vez só — duas linhas com
  o mesmo nome fariam `validateDurations` recusar o formulário inteiro depois.
- **Falha nunca trava o formulário**: erro de rede ou credencial vira aviso na
  própria seção e o resto da configuração continua salvável à mão.
- Regressões: `tests/clinicorp-actions.test.ts`.

### Estendendo

Endpoints úteis ainda não usados: `/appointment/change_status` +
`/appointment/status_list` (marcar "realizado" aqui refletir lá),
`/business/list_available_times` (oferecer os slots reais da clínica em vez de
derivar do expediente configurado no fechai).

Para a duração por tipo (que a API não informa, ver acima), o único caminho
seria **deduzir do histórico**: ler `/appointment/list` de semanas passadas e
tirar a duração média real por categoria. Daria nome *e* tempo de verdade, mas
depende de haver histórico, são várias chamadas e leva segundos — foi avaliado e
deixado de fora do botão de importar, que é síncrono.

Não há webhook de entrada: o que for marcado **no** Clinicorp não aparece na
agenda daqui. Só a checagem de conflito enxerga esses horários. Trazer os
agendamentos de lá exigiria polling, deduplicação e uma regra de quem vence em
divergência — decisão em aberto, não um esquecimento.
