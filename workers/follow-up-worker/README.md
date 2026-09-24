# Worker: follow-up-worker

## O que faz

Processo separado (BullMQ + Redis) que roda periodicamente e faz **duas
varreduras independentes** — as mensagens que o produto manda por conta do
relógio, não por uma resposta do contato:

| varredura | reage a | para quem |
| --- | --- | --- |
| **follow-up** | silêncio do lead sem consulta atual/futura | tenants com a ação `follow_up` ativa |
| **lembretes** | consultas chegando | tenants com `schedule_meeting` ativa **e** lembrete configurado |

Cada varredura tem sua própria fila: follow-up roda a cada 15 minutos e
lembretes a cada minuto por padrão. Assim um lembrete configurado para 23h
não espera o próximo ciclo do follow-up. As falhas de uma fila não param a outra.

## Arquivos

- `scan.ts` — follow-up em esteira (testável; ver seção abaixo):
  - `nextFollowUp(conv, cfg)` — regra pura: qual etapa vem agora e quando vence (null sem esteira, com consulta, `needsHuman` ou última msg do contato).
  - `stepsSentInRun(conv)` — quantas etapas desta esteira já saíram (`followUpStep`, só enquanto `followUpSentAt >= lastInboundAt`).
  - `isWithinFollowUpWindow(now, window, tz)` e `isStale(dueAt, now)` — janela de horas locais e etapa velha demais.
  - `scanAndSendFollowUps(now?)` — varre, compõe (IA quando a etapa pede), envia e marca `followUpSentAt` + `followUpStep`. Retorna `{ scanned, sent }`.
- `reminders.ts` — lembretes pré-consulta (ver seção abaixo):
  - `dueReminders(appt, reminders, now)` — regra pura: quais disparos venceram.
  - `staleReminders(appt, reminders, now)` — quais perderam a janela e são fechados sem envio.
  - `remindersFor(appt, cfg)` — os da consulta, ou os do agente.
  - `scanAndSendReminders(now?)` — varre consultas próximas e marca `Appointment.remindersSent`.
- `index.ts` — cria as filas, agenda os jobs repetíveis (`upsertJobScheduler`) e roda os workers.

## Lembretes de consulta (`reminders.ts`)

A antecedência e o texto de cada lembrete são configurados por agente, dentro
da ação "Agendar horário" (`TenantAction.config` da chave `schedule_meeting` —
ver `src/modules/scheduling/README.md`), e uma consulta pode ter os seus
próprios (`Appointment.reminderOverride`).

Regras que não são óbvias:

- **A config geral é da conta, não do `agentId` da consulta.** Vale a do
  agente principal (o que atende o WhatsApp, mesma ordem de `resolveAgent`),
  que é a que `/agenda` mostra como "Do agente". Ler pelo `agentId` gravado
  fazia consulta marcada antes de trocar o agente do WhatsApp — ou de agente
  apagado, com `agentId` null — seguir outra config (ou nenhuma), e ela só
  disparava depois de alguém salvar lembretes próprios. Só o override muda o
  que uma consulta recebe.

- **`Appointment.remindersSent` é uma lista, não um booleano.** Uma consulta
  tem vários disparos ("1 semana antes", "1 dia antes", "2 horas antes") e
  cada um é marcado sozinho — um booleano calaria todos depois do primeiro. E
  fica em `Appointment`, não em `Conversation` como o follow-up, porque o
  lembrete é **por consulta**: o mesmo paciente volta no mês seguinte.
- **Vários disparos vencidos de uma vez mandam UM só: o mais próximo da
  consulta.** Acontece quando o worker fica fora do ar, ou quando dois
  lembretes estão muito perto um do outro. Mandar os dois faria chegarem
  juntas "falta uma semana" e "é amanhã" — a primeira já mentindo. Os outros
  são fechados sem envio.
- **Consulta que já passou não recebe lembrete.** Worker parado por duas horas
  não pode acordar e avisar "sua consulta é amanhã" para quem já foi atendido.
  Os disparos pendentes dela são marcados **sem enviar nada**, senão seriam
  reavaliados em todo ciclo para sempre.
- **`reminderSentAt` só é gravado quando uma mensagem saiu.** A tela mostra
  "lembrete enviado há X" a partir dele; um disparo fechado sem envio (consulta
  passada, contato sem telefone) faria essa frase mentir. `remindersSent` é
  quem controla o que falta.
- **A busca tem teto**: a maior antecedência configurada entre os agentes com
  lembrete ligado. Sem ele, a varredura carregaria a agenda do ano inteiro para
  descartar quase tudo em memória. Consultas com lembretes próprios entram por
  um `OR`, porque a antecedência delas pode passar desse teto. Lembretes com
  horário fixo acrescentam até um dia de margem, pois a manhã da véspera pode
  ficar mais de 24 horas antes de uma consulta noturna.
- **A mensagem entra na conversa** (`role: "assistant"`). É isso que faz a
  resposta do paciente cair no `runAgentTurn` normal — "não vou poder" vira
  reagendamento pelo fluxo que já existe, em vez de chegar como conversa nova.
- **Conversa de teste fica de fora** (`lead.isTest`), como no follow-up: o
  telefone do sandbox é sintético.
- **Número bloqueado não recebe lembrete.** Os disparos vencidos são fechados
  em `remindersSent`, sem mensagem e sem `reminderSentAt`, para não voltarem
  depois de desbloquear o contato nem aparecerem como enviados na agenda.
- **Falha ou desconexão do WhatsApp não marca como enviado.** A varredura tenta
  novamente enquanto a consulta ainda não começou. Depois dela, os disparos
  pendentes são fechados sem enviar mensagem atrasada.

Regressões: `tests/agendamento-lembrete.test.ts`.

## Como rodar

```bash
npm run db:up        # Redis precisa estar de pé
npm run worker       # tsx workers/follow-up-worker/index.ts
```

Env: `REDIS_URL`, `FOLLOWUP_SCAN_EVERY_MINUTES` (intervalo da varredura, padrão 15).

## Follow-up em esteira (`scan.ts`)

Configurado por agente em `/agentes/[id]` → Ações → Follow-up automático
(`TenantAction.config` da chave `follow_up`, ver `src/modules/follow-up/config.ts`).
São **duas esteiras** de mensagens espaçadas, mais uma janela de envio:

- `noReply` — o contato parou de responder. Padrão: 10 mensagens em ~29 dias,
  a primeira em 30 minutos.
- `declined` — o contato disse que não quer agendar agora. Padrão: 1, 4, 11 e
  26 dias. Quem põe a conversa aqui é o agente, pela tool `follow_up`
  (`Conversation.followUpReason = "declined"`); `"stop"` (pediu para parar)
  não recebe esteira nenhuma.

Regras que não são óbvias:

- **Não há coluna de "esteira ativa".** A esteira é o silêncio: começa na
  última fala do agente sem resposta, avança uma etapa por envio
  (`followUpStep`, com `followUpSentAt` no último) e acaba quando o contato
  escreve — `followUpStep` só vale enquanto `followUpSentAt >= lastInboundAt`,
  então a próxima esteira recomeça da etapa 1 sem ninguém zerar nada.
- **A espera da primeira etapa conta da última fala do agente**, não da
  mensagem do contato: quando quem respondeu foi um humano dias depois, contar
  do contato faria a etapa já nascer velha. As seguintes contam do envio
  anterior, para que duas etapas atrasadas pela janela não saiam juntas.
- **Janela de envio** (`window`, horas locais no fuso da agenda do agente,
  padrão 6h–22h): fora dela a etapa espera.
- **Etapa vencida há mais de `FOLLOWUP_STALE_AFTER_MINUTES` (26h) não sai**, e
  a esteira para ali até o contato escrever. Cobre o worker parado e a conta
  que acabou de ligar a ação — sem isso, toda conversa antiga e silenciosa
  receberia a primeira mensagem de uma vez. A busca também só olha conversas
  cujo último contato cabe na esteira mais longa configurada.
- **WhatsApp desconectado ou envio com falha não consome a etapa**: a próxima
  varredura tenta de novo, até a etapa ficar velha. A conexão é checada
  **antes** da IA, para não pagar por texto que não tem como sair.
- **Etapa com `ai: true`** é reescrita pela IA a partir da conversa
  (`src/modules/follow-up/compose.ts`) e grava `sentBy: "agent"` — conta na
  cota do plano, como resposta do atendimento. Sem cota, IA fora do ar ou
  resposta vazia, sai o texto fixo, que não conta.
- **Configs antigas continuam valendo.** Antes era uma mensagem só
  (`delayMinutes`, ou `delayHours` ainda antes, + `message`).
  `parseFollowUpConfig` converte numa esteira `noReply` de uma etapa, com o
  intervalo e o texto escolhidos. **Não remova esse fallback** sem migrar as
  linhas — sem ele, todo follow-up já configurado viraria em silêncio a
  esteira padrão de 10 mensagens.

A cadência da varredura (`FOLLOWUP_SCAN_EVERY_MINUTES`) é o retardo mínimo
real: uma espera menor que ela sai no próximo ciclo. Teto de cada espera:
`MAX_FOLLOWUP_DELAY_MINUTES` (30 dias); de mensagens por esteira:
`MAX_FOLLOWUP_STEPS` (15).

Regressões: `tests/follow-up-agendamento.test.ts` (varredura),
`tests/follow-up-intervalo.test.ts` (config) e `tests/follow-up-compose.test.ts` (IA).

**Consulta marcada encerra o reengajamento.** O worker ignora a conversa quando
o lead tem um `Appointment` com status `scheduled` que ainda não terminou. A
checagem é pelo `leadId`, e não só por `conversationId`, para cobrir também uma
consulta marcada manualmente em `/agenda`. A tool `follow_up` faz a mesma
checagem antes de pôr o contato na esteira de recusa ("pediu para parar" vale
mesmo com consulta marcada). Depois de agendar, mensagens
automáticas relacionadas à consulta são responsabilidade dos lembretes.

**Agente pausado ou conversa com humano nunca recebem follow-up.** Duas
chaves, dois efeitos diferentes, as duas checadas na busca (`where`) e de novo
em `nextFollowUp` (defesa em memória, mesmo padrão da consulta marcada):

- `Agent.enabled = false` é a pausa geral (ver `prisma/schema.prisma`): o dono
  desligou o agente inteiro para não atender cliente nenhum. Follow-up é
  exatamente isso — reengajar cliente — então continuar mandando por trás
  contradiz a pausa.
- `Conversation.agentPaused = true` é um humano tendo assumido *esta* conversa
  pelo painel (`sendManualMessage`). As outras conversas do mesmo agente
  continuam recebendo follow-up normalmente; só essa aqui não, para a esteira
  automática não falar por cima de quem está atendendo.

Nenhuma das duas apaga a esteira em andamento — só a pausa enquanto dura.
Agente religado ou conversa devolvida ao agente voltam a contar do
`followUpSentAt`/`followUpStep` de onde pararam, como qualquer etapa que
esperou a janela de envio.

## O que NÃO faz

- Lembretes nunca passam por IA (template fixo). No follow-up, só a etapa
  marcada com `ai: true` passa — e só ela consome a cota do plano.
- Não repete uma etapa (`followUpStep` no follow-up,
  `Appointment.remindersSent` nos lembretes — um por antecedência).
- Não responde ao que o contato escrever de volta: a mensagem entra na conversa
  e quem conduz dali em diante é o `runAgentTurn`, pelo webhook.
- Não envia follow-up para números bloqueados. Não preenche `followUpSentAt`
  nesses casos porque a tela e o relatório tratam a data como envio real.
- Não roda dentro do Next — é um processo à parte (deploy no Railway/Fly.io).
