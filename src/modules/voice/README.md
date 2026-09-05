# Voz do agente (resposta em áudio)

O agente responde **falando na voz do dono da conta**. A voz é clonada uma vez
pela [Fish Audio](https://docs.fish.audio) a partir de uma amostra gravada no
painel, e depois cada resposta em áudio é sintetizada com esse modelo.

## Mapa dos arquivos

| Arquivo | O que faz |
| --- | --- |
| `fish.ts` | Cliente HTTP da Fish Audio: `cloneVoice()` (POST `/model`), `synthesize()` (POST `/v1/tts`), `deleteVoice()`. |
| `reply.ts` | A **regra** do envio automático: `speakReply()` decide se esta resposta vira áudio e produz os bytes. |
| `storage.ts` | `storeVoiceMessage()` — guarda o áudio enviado na CDN para dar play no histórico. |
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

O áudio das **mensagens enviadas** é outra coisa: esse fica guardado na CDN
(`storage.ts`) e a `Message` aponta para ele, para a pessoa reouvir no painel o
que chegou no WhatsApp do cliente. Guardar é best-effort — falhar não desfaz um
envio que já aconteceu; a mensagem só fica sem player. O upload acontece
**depois** do envio, de propósito: se o WhatsApp recusar, não sobra arquivo
órfão de uma mensagem que nunca existiu.

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
