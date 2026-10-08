# Bitrix24 (por tenant)

Contexto compacto: [índice](../../../.claude/context/bitrix/_index.md).

Conexão em **Integrações → CRM**, sem liberação específica do superadmin.
A integração envia **Fechai → Bitrix24**. Não importa contatos, horários ocupados,
comparecimento ou alterações de lá. A agenda do Fechai continua sendo a fonte da
verdade, com conflitos consultados também no Clinicorp quando conectado.

## Conexão

Cada tenant cria seu próprio **webhook de entrada** com escopo `crm`, pelo usuário
que poderá ler, adicionar e editar contatos, leads/negócios e atividades. O plano
do Bitrix24 precisa liberar REST. A URL base é cifrada inteira com AES-256-GCM
(`lib/crypto.ts`, `ENCRYPTION_KEY`); nunca é devolvida ao cliente depois de salva.
Não há credencial compartilhada da Mavellium. `responsibleId` vazio usa o usuário
da URL; o ID configurado é o responsável pelos registros e pelas reuniões.

Aceitamos os endereços originais dos portais **Bitrix24 Cloud** (inclusive .com.br).
Domínio personalizado deve usar a URL original do portal. Instalações próprias
não são suportadas nesta versão: URL livre permitiria acessar a rede privada do
servidor. HTTPS obrigatório, host e caminho validados e redirecionamentos recusados.
A verificação da conexão faz somente leituras; permissões efetivas de escrita e
campos obrigatórios são validados pelo Bitrix24 no envio e aparecem como aviso.

Pausar mantém credenciais e referências. Desconectar apaga a credencial e pausa;
reconectar ao mesmo portal mantém referências. Para trocar de portal é necessário
desconectar: `connectionKey` novo separa todos os IDs e envios do destino anterior.
Nenhum envio antigo é redirecionado. Cada chamada do worker confere configuração,
claim e conta ativa; alterar/pausar a conexão interrompe as próximas chamadas.

## CRM e calendário

- Contatos: nome informado e telefone com código do país. Procura a referência
  externa e depois duplicados por telefone. Um contato existente é reutilizado
  **sem editar seus campos**; múltiplos contatos exigem correção no Bitrix24.
- Leads: um registro por Lead do Fechai, vinculado ao contato. `crm.settings.mode.get`
  identifica CRM clássico (lead, entityTypeId 1) ou simples (negócio, 2). Contato é
  entityTypeId 3. Situação local vai no comentário; nunca muda estágio do funil,
  dinheiro, comparecimento ou responsável definidos pela recepção no CRM.
- Agenda: somente consultas futuras ao conectar, com contato real vinculado.
  `crm.activity.add`, TYPE_ID 1, cria reunião no CRM e o Bitrix24 a espelha no
  calendário do responsável. Datas já guardadas em UTC são transmitidas como
  instantes ISO, sem reconversão para um horário local diferente.
- Remarcação altera a mesma atividade. Cancelamento altera assunto/descrição e
  encerra a atividade (`COMPLETED=Y`), mantendo o registro CRM, notas e ID; nunca
  chama exclusão. O reflexo visual no calendário exige conferência no portal real.
  Cancelamento já espelhado ainda é processado com a opção de enviar novos
  agendamentos desligada; pausar/desconectar a conexão inteira interrompe tudo.
- Consulta cancelada antes do primeiro envio não cria reunião cancelada.
- Testes e consultas sem contato não são exportados. Consultas sem contato são
  contabilizadas como sem envio. Texto de conversa e áudio não são exportados.
- Webhook precisa enxergar os registros relevantes do portal: sem permissão de
  leitura global, a pesquisa por telefone pode não enxergar um contato existente.

## Fila, concorrência e falhas

`BitrixSyncJob` guarda payload, versão, referências externas, tentativas e claim
condicional. A fila `bitrix-crm-sync` roda no worker existente a cada 30 segundos,
com concorrência global 1. Incremental por `updatedAt` + ID, com sobreposição de
um minuto ao concluir um lote. Nova coluna `Lead.updatedAt` e índices suportam a
captura; ativar opções reinicia a captura sem apagar os vínculos externos.

Cada tenant recebe até três envios de contato e dois de agenda por volta;
agendamento pode antecipar seu contato dependente. SHA-256 de tenant, destino,
tipo e ID forma `originId`/`ORIGIN_ID`; `originatorId`/`ORIGINATOR_ID` é `FECHAI`.
Mudança durante uma chamada não pode reconhecer payload antigo como atual.
IDs confirmados são salvos imediatamente mesmo quando a fonte muda durante o POST.

Antes de criar, grava-se `uncertain`. Após timeout, resposta inválida ou queda do
processo, a próxima tentativa **só procura pela referência**. Não se repete criação
não confirmada: o Bitrix24 não documenta exclusividade do ORIGIN_ID. Se o registro
não for encontrado, continua em conferência e a clínica precisa verificar o portal;
"Conferir envios" não remove essa proteção. Em "Resolver envios sem confirmação",
a clínica pode procurar novamente; se encontrar, os IDs são recuperados. Apenas
após a confirmação explícita de que o registro não existe no portal, uma leitura
adicional vazia permite nova tentativa, ainda com cinco minutos de espera e uma
nova pesquisa antes do POST. A operação usa claim e valida tenant/conexão ativos. Erro explícito de recusa permite nova
tentativa, com recuo exponencial. 429/limite impõe pausa por portal, sem bloquear a
fila por minutos. Chamada externa tem timeout de 15s e frequência máxima aproximada
de 1,8/s por portal em cada processo (web ou worker). Falha da integração nunca passa pelo turno do agente nem
reverte o agendamento local. Mensagens de erro são fixas, sem corpo remoto/segredo.

## Implantação e validação

**Schema novo: `prisma db push` + `prisma generate` tanto no web quanto no worker.**
O deploy existente aplica o schema e usa uma imagem compartilhada com client gerado.
Não ligar uma conexão em produção antes de aplicar as duas tabelas e os índices.

Testes: `tests/bitrix-{client,integration,mirror,worker,actions}.test.ts` cobrem
contratos REST, criptografia, guards, separação de tenants/destinos, modos do CRM,
contato existente, duplicados, claim, reinício, timeout, alterações concorrentes,
reunião, remarcação e cancelamento. `scripts/smoke-bitrix.ts` também exercita o worker completo com PostgreSQL real e
respostas REST simuladas, sem tráfego externo: exige banco dedicado
`fechai_bitrix_test` em `127.0.0.1:5438` e apaga somente os tenants criados na própria
execução. No teste de 08/10/2026, o PostgreSQL temporário sem pgvector usou uma cópia
do schema com os dois campos de vetores substituídos por bytea; todas as tabelas,
colunas, índices e relações usados pelo Bitrix mantiveram o schema original.
O schema de produção permaneceu intacto e foi validado normalmente.

Portal real depende de webhook cadastrado pelo cliente. A validação da conexão não comprova entrega de nenhum registro.

## Documentação oficial consultada

- Webhooks: https://apidocs.bitrix24.com/local-integrations/local-webhooks.html
- Adicionar itens: https://apidocs.bitrix24.com/api-reference/crm/universal/crm-item-add.html
- Listar itens: https://apidocs.bitrix24.com/api-reference/crm/universal/crm-item-list.html
- Modo do CRM: https://apidocs.bitrix24.com/api-reference/crm/crm-settings-mode-get.html
- Duplicados: https://apidocs.bitrix24.com/api-reference/crm/duplicates/crm-duplicate-find-by-comm.html
- Reunião e calendário: https://apidocs.bitrix24.com/tutorials/crm/how-to-add-crm-objects/how-to-add-activity-to-contact.html
- Atualizar atividade: https://apidocs.bitrix24.com/api-reference/crm/timeline/activities/activity-base/crm-activity-update.html
- Limites: https://apidocs.bitrix24.com/limits.html
