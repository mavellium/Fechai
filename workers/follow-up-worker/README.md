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

- `scan.ts` — follow-up (testável):
  - `isEligible(conv, cutoff)` — regra pura: não `needsHuman`, sem `followUpSentAt`, sem consulta atual/futura, `lastInboundAt` antigo, última msg do agente.
  - `scanAndSendFollowUps(now?)` — varre elegíveis, envia via WhatsApp (se conectado), grava a mensagem e marca `followUpSentAt`. Retorna `{ scanned, sent }`.
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

O silêncio até o follow-up e o texto da mensagem são configurados por agente
(não são mais env/constante global) — `TenantAction.config` da chave
`follow_up`, editado em `/agentes/[id]` → Ações → Follow-up automático (ver
`src/modules/follow-up/config.ts`). Padrão: 24h, mensagem genérica de reengajamento.

`FollowUpConfig.delayMinutes` é guardado em **minutos**, não horas — a tela
deixa escolher a unidade (minutos ou horas) porque um follow-up de vendas
rápidas às vezes precisa de "15 minutos", não "1 hora" arredondado para cima.
O campo guarda o total em minutos e a unidade é só como a pessoa digita: ao
reabrir, o formulário mostra horas quando o valor é hora cheia (24h é mais
legível que 1440) e minutos quando não é.

**Configs antigas continuam valendo.** Antes o campo era `delayHours`, e toda
conta com follow-up ligado tem um no banco. `parseFollowUpConfig` lê os dois e
converte na leitura (`delayHours: 24` → `1440`), dando preferência a
`delayMinutes` quando ambos existem. Não houve migração de dados: a linha só é
reescrita quando alguém salva o formulário. **Não remova esse fallback** sem
antes migrar as linhas existentes — sem ele, todo intervalo escolhido volta
silenciosamente para o padrão de 24h.

Um intervalo configurado abaixo de `FOLLOWUP_SCAN_EVERY_MINUTES` dispara no
próximo ciclo de varredura, não no minuto exato — a cadência do scan é o
retardo mínimo real, então diminuir o intervalo configurado só ajuda até esse
teto. Teto do próprio intervalo: `MAX_FOLLOWUP_DELAY_MINUTES` (30 dias).

Regressões da conversão em `tests/follow-up-intervalo.test.ts`.

**Consulta marcada encerra o reengajamento.** O worker ignora a conversa quando
o lead tem um `Appointment` com status `scheduled` que ainda não terminou. A
checagem é pelo `leadId`, e não só por `conversationId`, para cobrir também uma
consulta marcada manualmente em `/agenda`. A própria tool `follow_up` faz a
mesma checagem antes de sinalizar o follow-up. Depois de agendar, mensagens
automáticas relacionadas à consulta são responsabilidade dos lembretes.

## O que NÃO faz

- Não gera texto por IA em nenhuma das duas varreduras (texto fixo salvo na
  config, não um LLM) — por isso nada daqui consome a cota do plano.
- Não reenvia mais de uma vez (`followUpSentAt` no follow-up,
  `Appointment.remindersSent` nos lembretes — um por antecedência).
- Não responde ao que o contato escrever de volta: a mensagem entra na conversa
  e quem conduz dali em diante é o `runAgentTurn`, pelo webhook.
- Não envia follow-up para números bloqueados. Não preenche `followUpSentAt`
  nesses casos porque a tela e o relatório tratam a data como envio real.
- Não roda dentro do Next — é um processo à parte (deploy no Railway/Fly.io).
