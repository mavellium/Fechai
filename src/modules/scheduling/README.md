# Agenda (scheduling)

A agenda do fechai é a **fonte da verdade**. Google Agenda e Clinicorp são
espelhos opcionais, ligados por conta (tenant). Nenhum dos dois pode derrubar um
atendimento: as funções de integração **nunca lançam** — a falha é registrada e
mostrada no painel, e o horário combinado com o lead continua de pé.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `repository.ts` | Toda leitura/escrita da agenda. Filtra por `tenantId` sempre. A tela, as server actions e a tool `schedule_meeting` passam por aqui. |
| `config.ts` | `ScheduleConfig` (expediente, fuso, duração) em `TenantAction.config`, chave `schedule_meeting`. Por agente. |
| `time.ts` | Fuso: `parseLocalDateTime`, `partsInZone`, `monthRangeUtc`. Nada de data no projeto sem passar por aqui. |
| `google.ts` | Espelho no Google Agenda (OAuth por tenant). |
| `clinicorp.ts` | Espelho + leitura de disponibilidade no Clinicorp (Basic auth por tenant). |
| `features.ts` | Quais calendários a conta habilitou em /integracoes. |

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
- **`IgnoreSameName: "X"` ao criar paciente.** Sem isso o Clinicorp recusa quando
  já existe alguém com o mesmo nome — e "João Silva" repetido é rotina numa base
  de pacientes. O telefone é o que de fato distingue, e ele já foi consultado
  antes (`GET /patient/get?Phone=`, que aceita qualquer formato; mandamos só
  dígitos).
- **Falha na consulta de disponibilidade devolve `false`, não `true`.** O
  Clinicorp é fonte extra de informação, não porteiro. Se ele estiver fora do ar,
  recusar todo horário significaria perder o lead por indisponibilidade de um
  terceiro.
- **`syncEnabled` e `checkAvailability` são independentes.** Uma clínica pode
  querer só enviar, sem a leitura extra a cada horário oferecido.
- **Filtro por profissional só quando a conta fixou um** (`dentistId`). Com
  dentista definido, a agenda de um colega não bloqueia o horário; sem ele, o
  agendamento é da clínica e tudo conta.
- **`lastError`/`lastErrorAt`** existem para a tela avisar que a credencial
  venceu. Sem isso, um token expirado só apareceria quando a clínica reclamasse
  de um paciente que não chegou na agenda.

### Confirmação de envio e preferências

- `pushAppointmentToClinicorp` devolve `ClinicorpSyncResult`: `synced` com id,
  `failed` com motivo ou `skipped` quando desligado/sem conexão. HTTP 200 vazio,
  objeto de erro e resposta sem id válido **não são confirmação de criação**.
  Só uma criação confirmada atualiza `lastSyncAt` e limpa o erro de envio.
- `createAppointment` conserva o compromisso local e devolve esse resultado.
  A criação manual mostra aviso de falha; a ferramenta do agente não afirma
  que o horário já aparece no Clinicorp. A agenda indica o envio por compromisso
  usando `clinicorpAppointmentId`, inclusive quando outro envio posterior deu certo.
- O contato com telefone é obrigatório no formulário manual quando o envio ao
  Clinicorp está ativado; sem espelho continua opcional. O servidor também valida.
- Profissional, clínica e categoria são campos controlados no formulário. O
  envio usa `onSubmit` + `startTransition` + `useActionState`, sem `<form action>`:
  seu reset nativo altera até um select controlado sem disparar `onChange`.
  Uma lista que falhou ao
  carregar não apaga a opção salva, e o erro permite tentar carregar novamente.
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

### Estendendo

Endpoints úteis ainda não usados: `/appointment/change_status` +
`/appointment/status_list` (marcar "realizado" aqui refletir lá),
`/business/list_available_times` (oferecer os slots reais da clínica em vez de
derivar do expediente configurado no fechai).

Não há webhook de entrada: o que for marcado **no** Clinicorp não aparece na
agenda daqui. Só a checagem de conflito enxerga esses horários. Trazer os
agendamentos de lá exigiria polling, deduplicação e uma regra de quem vence em
divergência — decisão em aberto, não um esquecimento.
