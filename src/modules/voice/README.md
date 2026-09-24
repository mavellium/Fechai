# Voz do agente (resposta em áudio)

O agente responde **falando na voz do dono da conta**. A voz é clonada uma vez
pela [Fish Audio](https://docs.fish.audio) a partir de uma amostra gravada no
painel, e depois cada resposta em áudio é sintetizada com esse modelo.

## Mapa dos arquivos

| Arquivo | O que faz |
| --- | --- |
| `fish.ts` | Cliente HTTP da Fish Audio: `cloneVoice()` (POST `/model`), `synthesize()` (POST `/v1/tts`), `deleteVoice()`. |
| `reply.ts` | A **regra** do envio automático: `speakReply()` decide se esta resposta vira áudio e produz os bytes. |
| `style.ts` | `VOICE_STYLES` — como a voz se comporta (neutra/calorosa/animada) e os números da Fish por trás de cada uma. |
| `speech-text.ts` | `toSpeech()` — o que é pronunciável no texto da resposta (tira risada escrita, emoji, formatação e a lista do agente). |
| `../../app/(dashboard)/agentes/VoiceStyleSelect.tsx` | O menu "Como ele fala" no passo Comportamento. |
| `../../app/(dashboard)/agentes/VoicePromptForm.tsx` | Instruções do dono para a redação de respostas automáticas em áudio. |
| `../../app/(dashboard)/agentes/SpeechBlocklistForm.tsx` | A lista "o que ele não fala" (`Agent.speechBlocklist`) no passo Comportamento. |
| `storage.ts` | `storeVoiceMessage()` — guarda áudios enviados e recebidos na CDN para dar play no histórico. |
| `../../app/(dashboard)/agentes/VoiceRecorder.tsx` | Gravação da voz do dono (`MediaRecorder`) + upload de arquivo. |
| `../../app/(dashboard)/agentes/actions.ts` | `saveAgentVoice`, `deleteAgentVoice` e o toggle em `setAgentBehavior`. |
| `../../app/(dashboard)/conversas/VoiceMessageRecorder.tsx` | Gravar e mandar a SUA voz numa conversa. |
| `../../app/(dashboard)/conversas/actions.ts` | `sendManualAudioMessage` (texto→voz) e `sendRecordedAudioMessage` (voz gravada). |
| `tests/voz.test.ts` | Cobre a regra de quando falar e **toda** a degradação para texto. |

## Os três caminhos de áudio

Três formas de o cliente receber uma mensagem de voz, com regras diferentes:

| Caminho | Voz de quem | Onde | Precisa de | Falha vira |
| --- | --- | --- | --- | --- |
| **Agente responde sozinho** | agente (clonada) | webhook, `speakReply()` | voz + toggle | texto, em silêncio |
| **"Enviar como áudio"** | agente (clonada) | `/conversas`, `sendManualAudioMessage` | voz clonada | erro na tela |
| **Gravar e enviar** | a sua, de verdade | `/conversas`, `sendRecordedAudioMessage` | só o microfone | erro na tela |

Os dois manuais funcionam **no chat de teste também**: é onde se confere como a
voz soa antes de usá-la com um cliente. A síntese é paga mesmo no teste (a Fish
cobra por caractere, não por destinatário), mas conferir a própria voz antes é
justamente o uso que paga esse custo. No sandbox a mensagem só entra no
histórico — nada sai para o WhatsApp.

Repare que os pré-requisitos são **diferentes**: amarrar os dois botões à mesma
condição escondia o microfone de quem nunca clonou voz nenhuma. Gravar a própria
voz não depende de clonagem.

A diferença de tratamento de falha é deliberada. No automático ninguém está
olhando: cair para texto é a única opção que atende o cliente. Nos manuais tem
alguém na tela que **pediu áudio** — mandar texto no lugar sem avisar trocaria a
decisão da pessoa pela nossa.

O áudio gravado à mão é **transcrito** (`transcribeAudio`, o mesmo do webhook)
antes de sair, e o texto entra na mesma `Message`. Sem isso, o resumo da
conversa, os relatórios e o próximo turno da IA saberiam apenas que "houve um
áudio". A transcrição não bloqueia o envio: falhou, a mensagem sai com um
marcador no lugar do texto.

## As duas regras que não devem ser quebradas

**1. Falar é sempre opcional — a resposta em texto é o piso.**
Nada em `modules/voice` lança para o caminho da conversa. Se a Fish Audio cair,
devolver 4xx/5xx, estourar timeout ou entregar 200 com corpo vazio,
`speakReply()` devolve `{ spoken: false, reason }` e o webhook manda a resposta
em texto. O contato é atendido em qualquer cenário — só não em voz. O mesmo vale
no envio: se o WhatsApp recusar o áudio já sintetizado, o webhook cai para texto
em vez de perder a resposta que o LLM já produziu (e já cobrou).

**2. O agente espelha o contato.**
Só responde em áudio quem mandou áudio (`incomingWasAudio`). Quem escreve recebe
texto. Isso mantém a conversa natural e segura o custo — TTS é cobrado por
caractere, e a maioria das mensagens é texto. A decisão vem **antes** da chamada
paga: responder em texto nunca custa uma síntese jogada fora.

## O que o agente pronuncia não é o que ele escreve

`Message.content` é o texto da resposta e continua intocado — é ele que vai para
o histórico, o resumo, a busca e o próximo turno do LLM. O que vira **som** passa
antes por `toSpeech()` (`speech-text.ts`), e isso tira três coisas:

- **Risada escrita** — `kkkk`, `hahaha`, `rsrs`, `hehe`, `huehue` e rubricas do
  tipo `(risos)`. Lendo, são pontuação emocional; falando, viram gargalhada no
  meio de um orçamento. Foi o defeito relatado em produção: cliente perguntou
  preço e ouviu o agente rir.
- **Emoji** — ou some (e a frase perde o tom) ou é lido literalmente ("rosto
  sorrindo com olhos de coração"). Nenhum dos dois é fala.
- **Formatação** — `*negrito*`, `_itálico_`, `~riscado~`, crase. Delimitador é
  coisa de tela.

Antes da síntese, datas no formato brasileiro (`24/09`) viram
`24 de setembro` e horários à meia-noite (`00h`, `00:00`) viram
`meia-noite`. A mensagem escrita e o histórico continuam intactos. Essa
normalização vale também para "enviar como áudio".

As instruções livres em `Agent.voicePrompt` são aplicadas pelo orquestrador
ao gerar respostas automáticas para contatos que mandaram áudio, quando a voz
está ligada. A Fish Audio recebe o texto pronto. O campo orienta a redação
da fala; ele não altera voz, sotaque ou mensagens digitadas pelo usuário em
"enviar como áudio".

O regex é conservador de propósito: exige repetição (`kk`, não `k`) e só tira
`rs` minúsculo, porque `RS` maiúsculo é o estado e sumir com ele faria o agente
falar um endereço pela metade. Na dúvida entre cortar e manter, **mantém** —
falar de leve errado é melhor que engolir metade do atendimento. Os casos de
"palavra parecida com risada" (`ok`, `Hoje`, `Bahia`, `Porto Alegre - RS`) estão
presos em `tests/voz.test.ts`.

### A lista de cada agente

Em cima disso vem `Agent.speechBlocklist` — um termo por linha, editado em
**Agentes › Comportamento**, dentro do card "A voz do agente"
(`SpeechBlocklistForm.tsx`, salva a cada chip como os toggles ao lado). Ela
**soma** com a limpeza padrão, nunca substitui: ninguém deveria precisar
descobrir que tem de digitar "kkkk" para o agente parar de rir.

Serve para o que é daquele negócio — bordão, apelido, muleta do LLM. **Não é
filtro de assunto**: quem manda no que o agente _diz_ é a persona (as Regras
viram instrução no prompt); aqui a frase já está pronta, e tirar uma palavra de
conteúdo ("não", "sem") só deixaria a fala torta. A dica do campo diz isso.

Detalhes que o regex por termo obriga:

- **Sem `\b`.** O `\w` do JavaScript é ASCII: "né" e "tá" terminam em letra
  acentuada e nunca casariam. A borda é `[^\p{L}\p{N}]` feita à mão, e o grupo
  da esquerda volta no `replace` para não comer o espaço que segurava a frase.
- **Termo de 1 letra é ignorado** (casaria com meia conversa) e a lista para em
  40 termos — na LEITURA, em silêncio, porque linha antiga ou colada de planilha
  não pode derrubar o áudio. Na escrita, `saveSpeechBlocklist` recusa com
  explicação: ali tem alguém na tela para corrigir.
- **Vírgula pendurada** ("beleza então, né" sem o "né") é limpa no fim, senão
  sobra uma pausa sem motivo.

O campo fica **sempre visível** no passo Comportamento, mesmo sem voz escolhida.
A primeira versão o escondia até existir voz ("sem voz nada é pronunciado") e o
efeito foi quem procurava a configuração não encontrar — ela sumia justamente
para quem ainda está montando o agente. Trocar ou remover a voz também não apaga
a lista.

Se sobrar string vazia (a resposta era só "kkkkk 😂"), `speakReply()` devolve
`nothing_to_say` **antes** da chamada paga e a resposta sai em texto. No envio
manual de `/conversas` a tela recusa com "não há nada para falar" em vez de
"falhou" — não houve falha nenhuma.

## Como a voz se comporta: escolha do dono, padrão contido

A outra metade do problema não é o texto, é o modelo. `temperature`/`top_p`
controlam o quanto ele pode interpretar a frase, e nos defaults da Fish
(0.7/0.7) a família s2 improvisa paralinguagem — risadinha, suspiro, mudança de
ânimo — que o texto não pediu.

Isso virou escolha do dono da conta (`Agent.voiceStyle`, catálogo em
`style.ts`), porque não existe número certo: um estúdio de tatuagem quer a voz
solta, uma clínica não. Três opções, do mais contido ao mais solto — **neutra**
(0.3/0.6, o padrão), **calorosa** (0.55/0.75) e **animada** (0.8/0.9).

Duas decisões que não devem ser desfeitas:

- **Neutra é o padrão**, e conta antiga, chave desconhecida ou coluna editada à
  mão caem nela (`parseVoiceStyle` nunca lança). Voz que improvisa é surpresa no
  meio de um atendimento: quem quer, escolhe; ninguém recebe sem pedir.
- **A "animada" avisa** que nessa faixa o modelo pode rir ou suspirar sozinho
  (campo `warning`, mostrado abaixo do menu). Oferecer a opção sem dizer isso
  repetiria o defeito que originou este arquivo.

Três opções e não um slider: entre 0.42 e 0.47 ninguém ouve diferença, e um
controle contínuo pediria que a pessoa descobrisse sozinha onde a voz começa a
rir. Os números ficam no código pelo mesmo motivo do catálogo de vozes — mudar
um deles muda como todas as contas naquele estilo soam, então passa por deploy.

Se o relato de "voz rindo" voltar já na neutra e com o texto limpo, a suspeita
seguinte é a **amostra**: uma gravação em que o dono ri ensina isso ao clone, e
a correção é regravar (`saveAgentVoice` troca o modelo na Fish).

## De onde vem a voz: pronta ou gravada

Duas origens, e `Agent.voiceSource` diz qual (`"catalog"` ou `"recorded"`):

- **Voz pronta** (`catalog.ts`) — lista curada por nós, escolhida em 2 cliques.
  É o caminho padrão: nem todo cliente quer usar a própria voz, e antes disto
  "responder com áudio" ficava atrás de uma gravação que muita gente não faria.
- **Voz gravada** — clonada da amostra do dono (ver custódia acima).

Para `synthesize()` as duas são idênticas: `Agent.voiceId` guarda um
`reference_id` e pronto. A origem só muda o **descarte**.

**Nunca chame `deleteVoice()` numa voz do catálogo.** O modelo é compartilhado
entre todas as contas que escolheram a mesma voz — apagá-lo derruba a voz de
todas elas. Só a voz gravada é nossa para apagar. Isso vale nos três lugares que
trocam voz: `saveAgentVoice`, `setAgentCatalogVoice` e `deleteAgentVoice`.

### Por que a lista é fixa no código, e não o catálogo da Fish em tempo real

`GET /model?language=pt` devolve conteúdo enviado por usuários: nas primeiras
páginas convivem clones de políticos e celebridades (Lula, Bolsonaro, Cristiano
Ronaldo), personagens de anime e memes. Oferecer isso ao cliente seria colocar a
voz de uma pessoa real atendendo comercialmente — problema jurídico e de marca,
não de gosto. A curadoria é nossa e muda por deploy.

Tirar uma voz da lista **não quebra** quem já a usa: `Agent.voiceId` guarda o
`referenceId`, então ela continua funcionando; só deixa de ser oferecida.

### Voice Design (avaliado, não adotado)

`POST /v1/voice-design` gera uma voz original a partir de um prompt — zero risco
de imitar pessoa real. Não foi adotado porque **não tem tier gratuito**: devolve
402 com crédito zero, enquanto o catálogo funciona no `s2.1-pro-free`. Vale
revisitar quando houver saldo (US$ 0,01 por geração).

## Ligar depende de duas coisas

`Agent.speakReplies` (o toggle) **e** `Agent.voiceId` (a voz gravada). Ligar o
toggle sem voz é recusado em `setAgentBehavior` — não porque quebraria (a
resposta sairia em texto de todo jeito), mas porque um toggle ligado que não faz
nada faz a tela mentir. Remover a voz desliga o toggle junto, pelo mesmo motivo.

`speakReplies` nasce **desligado**, ao contrário de `listenAudio`: falar exige
uma voz que a conta só tem depois de gravar.

## Custódia da voz (não relaxe isto)

A amostra **não é guardada por nós**. Ela vai para a Fish Audio, vira um modelo,
e o buffer morre com a request. Guardar a gravação significaria assumir custódia
de um dado biométrico de uma pessoa real para nunca mais usá-lo — o modelo é a
única coisa que o produto precisa de volta.

Regravar **substitui**: o modelo anterior é apagado na Fish Audio antes de
gravarmos o id novo. Sem isso, cada regravação deixaria um modelo órfão na conta
da plataforma, cobrando e guardando a voz de um cliente para sempre. Por isso
também o modelo nasce `private`: a conta da Fish é compartilhada por todos os
tenants, e "quem tiver o link ouve" (`unlist`) não é uma promessa que dá para
fazer sobre a voz de outra pessoa.

`voiceId` fica **em claro** no banco, ao contrário das credenciais de terceiros
(`lib/crypto.ts`): é um identificador opaco, inútil sem a chave da plataforma.

O áudio das **mensagens enviadas e recebidas** é outra coisa: esse fica guardado
na CDN (`storage.ts`) e a `Message` aponta para ele, para a pessoa reouvir no
painel o que passou pelo WhatsApp. Guardar é best-effort — falhar não desfaz uma
mensagem que já aconteceu; ela só fica sem player. No envio, o upload acontece
**depois** do WhatsApp aceitar a mensagem, para não deixar arquivo órfão.

Áudio recebido aparece no histórico mesmo se a opção de escuta da IA estiver
desligada ou a transcrição falhar. Nesse caso, o conteúdo é `[Áudio]` e não há
resposta automática. Áudio enviado pelo próprio WhatsApp entra como resposta
humana; o eco de um áudio enviado pelo painel ou pelo agente é deduplicado pelo
id da mensagem.

`Message.content` continua sendo o TEXTO mesmo quando há `audioUrl` — é ele que
vai para o contexto do LLM, o resumo e a busca. `audioUrl` é só a forma de
entrega.

## Chave e custo

`FISH_AUDIO_API_KEY` é **da plataforma**, uma só para todas as contas — mesmo
padrão dos LLMs. O cliente não cria conta na Fish Audio; o custo entra na conta
do plano. Sem a chave, a opção aparece indisponível na tela e todas as respostas
saem em texto (`isFishAudioConfigured()` guarda os dois lados).

**O crédito de API é separado do crédito da plataforma.** Uma conta com saldo no
site pode ter `credit: 0` na API e receber **402** em todo `/v1/tts` — foi o que
aconteceu no primeiro teste desta integração. Confira em
`GET /wallet/self/api-credit` ou em <https://fish.audio/app/developers>.

Por isso `synthesize()` tem uma **chain de modelos**: `s2.1-pro` →
`s2.1-pro-free`. No 402 ele repete no gratuito (mesmo modelo, sem garantia de
TTFA/DPA) e a conta continua falando; qualquer outro erro (401, 4xx de conteúdo)
não é reprocessado, porque se repetiria igual no modelo seguinte. Clonar voz
(`POST /model`) funciona mesmo com crédito zero.

## Gravação no navegador: a armadilha do Strict Mode

`VoiceMessageRecorder` pede o microfone **no mount**. Em dev, o Strict Mode do
React monta → desmonta → monta: a limpeza da primeira montagem parava as tracks
do stream que a segunda ainda estava esperando do `getUserMedia`, e o resultado
era sempre "não foi possível usar o microfone", com o popup de permissão sumindo
sozinho. O `aliveRef` resolve — só a montagem viva mexe no microfone.

Erros de `getUserMedia` são traduzidos por `err.name`, não num texto genérico:
`NotAllowedError` (bloqueado — mexer no cadeado), `NotFoundError` (não tem
microfone), `NotReadableError` (outro programa está usando). Cada um pede uma
ação diferente, e "não foi possível" manda a pessoa procurar no lugar errado.

`navigator.mediaDevices` só existe em **contexto seguro** (https ou localhost):
abrir o painel pelo IP da rede (`http://192.168...`) cai nessa checagem antes de
qualquer tentativa de permissão.

## Detalhes da API que custam caro se esquecidos

- **Formato `opus`.** É o codec do PTT do WhatsApp. Pedir mp3 faz a
  Evolution/Baileys transcodificar ou entregar como arquivo de áudio anexado —
  que toca, mas parece um documento na conversa, não uma mensagem de voz.
- **Envio por `/message/sendWhatsAppAudio`**, não `sendMedia`: só o primeiro
  produz a bolha de voz com onda e play.
- **`train_mode: "fast"`** é o único aceito para TTS e deixa o modelo utilizável
  na hora, sem fila de treino para a tela acompanhar.
- **Não mandamos `texts`** (a transcrição da amostra) no `cloneVoice`: sem ele a
  Fish roda ASR na própria amostra. Transcrição errada digitada pela pessoa
  piora a clonagem, e não temos como validar o que ela digitou contra o que
  falou.
- **`MAX_TTS_CHARS` (800).** Não é limite da API — é o ponto em que áudio deixa
  de ser melhor que texto. Acima disso a resposta vai escrita.

## Estender

Para falar em outro canal (widget, follow-up), chame `speakReply()` com o
`incomingWasAudio` daquele canal — a regra é uma só e mora aqui, não no webhook.
Para trocar de provedor de voz, a fronteira é `fish.ts`: `reply.ts` só conhece
`synthesize()`.
