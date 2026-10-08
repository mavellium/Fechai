# Bitrix24 — leitura

- `getBitrixStatus(tenantId)`: null ou status seguro/opções/contagens, até 3 erros e 10 envios incertos do destino atual; sem texto de conversa. Webhook não atravessa RSC.
- `testBitrix(tenantId)`: decifra/verifica leituras REST/grava crmMode se revision igual; não cria registro nem comprova entrega.
- `workerClient(tenantId, connectionKey, kind, canceled=false)`: null ou row/call; conta ativa/conexão ligada/credencial; reconfere revision por chamada. Interno; nunca retornar ao cliente.
- `verifyBitrix(webhook, appointments)`: modo/disponibilidade por leitura; escrita/campos obrigatórios só se comprovam no envio.

Origem/telefone: crm.item.list/duplicate.findbycomm/activity.list; duplicados bloqueiam criação. Sem consulta de vagas.
