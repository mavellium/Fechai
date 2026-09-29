# ADR-005: agenda do Clinicorp na /agenda, ao vivo, com lembretes

## Contexto

Clínicas que usam o Clinicorp marcam boa parte das consultas direto na
recepção, lá. A `/agenda` do fechai lia só o próprio banco: o Clinicorp era
espelho de ida (o que o agente marca vai para lá) e fonte de disponibilidade
para o agente, mas nada marcado lá aparecia aqui. O relato que abriu o trabalho
foi de um tenant com o dia cheio no Clinicorp e a agenda do fechai mostrando
dois compromissos.

Depois vieram mais três pedidos: a tela precisava refletir uma consulta nova
lá "em tempo real", os pacientes de lá precisavam receber os lembretes de
consulta, e trocar de mês precisava ser o mais rápido possível.

Restrições que moldaram as decisões:

- A API do Clinicorp **não tem webhook de agendamento** (o único da API é de
  upload de arquivo). Saber que algo mudou exige reler.
- `GET /appointment/list` de um mês leva segundos numa clínica movimentada.
- O paciente do Clinicorp quase sempre **nunca conversou** com o número da
  clínica. Na Meta, fora da janela de 24h, só template aprovado passa; pelo
  Evolution (sessão de aparelho), mensagem a número desconhecido é o que mais
  leva o WhatsApp a bloquear o número — e o bloqueio cala a clínica com todos
  os pacientes.

## Decisão

**Ler, não importar.** A `/agenda` lê o mês aberto do Clinicorp
(`listClinicorpAgenda`) e mescla na tela; nada vira `Appointment`. Importar
exigiria sincronização contínua, deduplicação e uma regra de quem vence numa
divergência — e o Clinicorp continua dono do que foi marcado nele. O que o
próprio fechai espelhou aparece uma vez só, deduplicado por
`Appointment.clinicorpAppointmentId`. Consultas de lá são só leitura na tela.

**Tempo real é releitura barata.** `AgendaLiveRefresh` pergunta a cada 15 s a
**versão** do mês a uma rota (`/api/agenda/pulso`, `fetch` comum) e só chama
`router.refresh()` quando ela muda. Rota, e não Server Action ou
`router.refresh()` a cada volta: os dois entram na fila do roteador do Next e
seguravam os cliques da tela enquanto o Clinicorp respondia. A versão
(`agendaVersion`) ignora a ordem das consultas, para página e rota nunca
divergirem por nada.

**Trocar de mês nunca espera o Clinicorp**, em quatro camadas:

1. `prefetch` completo nos botões de mês — o vizinho já está no navegador;
2. streaming: a página sai com o banco e a agenda de lá entra num
   `<Suspense key={mês}>` (sem a chave a navegação segura a tela antiga);
3. `after()` aquece o mês anterior e o seguinte no servidor;
4. cache de 30 min servido enquanto é revalidado — o pulso relê o mês aberto
   com `fresh`, e na hora quando a página chega com leitura antiga
   (`fetchedAt`).

**Lembretes com canal restrito.** Os pacientes do Clinicorp recebem os mesmos
lembretes da conta (`workers/follow-up-worker/clinicorp-reminders.ts`, a cada
5 min), com uma regra de canal que não se negocia:

- **Meta**: só por template aprovado escolhido pela clínica
  (`ScheduleConfig.metaReminderTemplate`, congelado e conferido com a Meta ao
  salvar, como nos Disparos). Sem template, não envia.
- **Evolution**: nunca primeiro contato. Só quem já conversou com o número.

O controle do que saiu fica numa tabela própria, `ClinicorpReminder` (id do
Clinicorp + horário), porque a consulta não existe no nosso banco. Envio pela
Meta com resultado incerto não é repetido (mesma regra do `unknown` do
ADR-003).

## Consequências

- A agenda mostra a realidade da clínica sem assumir a sincronização dela. Em
  troca, as consultas de lá não têm ações nem override de lembrete aqui, não
  entram em relatório, e o agente não consegue cancelar/remarcar uma consulta
  que só existe no Clinicorp — ele conversa, a clínica ajusta lá.
- "Tempo real" tem atraso de até 15 s na tela e até 5 min nos lembretes. Cada
  aba aberta faz uma chamada ao Clinicorp a cada 15 s; a aba escondida não faz
  nenhuma. Baixar o intervalo multiplica chamadas por aba.
- O cache vive na memória do processo (`globalThis`). Com vários processos web,
  um processo pode servir leitura mais antiga até o pulso seguinte corrigir.
- Cada mês aberto custa até duas leituras extras (vizinhos), guardadas por
  30 min.
- Conta no Evolution com pacientes que nunca falaram com o número não lembra
  esses pacientes — a tela de lembretes diz isso. Conta na Meta precisa de um
  template aprovado no Gerenciador do WhatsApp.
- Schema: `ClinicorpReminder` (`db push` + `generate` na web e no worker).
- Regras detalhadas: `src/modules/scheduling/README.md` e
  `workers/follow-up-worker/README.md`. Regressões: `tests/clinicorp.test.ts`,
  `tests/agenda-pulse.test.ts`, `tests/clinicorp-lembrete.test.ts`.
