# Relatório de incidente — indisponibilidade no atendimento via WhatsApp

**Data do relatório:** 21/09/2026  
**Tenant afetado:** Instituto do Sorriso  
**Componente principal:** Evolution API / integração do WhatsApp  
**Severidade:** Alta — mensagens de clientes não chegaram ao agente de IA  
**Situação:** Mitigação imediata definida; proteção preventiva validada localmente e pendente de implantação controlada

## 1. Resumo executivo

O Instituto do Sorriso recebeu mensagens no WhatsApp, mas algumas delas não chegaram ao FechAI e, consequentemente, não receberam resposta da agente Paula.

A investigação mostrou que o problema ocorreu antes do processamento pela IA. Os contatos informados não possuíam conversa correspondente no painel do FechAI, enquanto os logs do container da Evolution haviam parado por volta de 01:35. O último erro relevante foi um `Prisma P2024`, indicando esgotamento ou espera excessiva no pool de conexões com o banco de dados.

O cenário mais provável é que o container tenha permanecido aparentemente ativo, porém sem conseguir processar corretamente novos eventos. Por esse motivo, o painel ainda podia apresentar o WhatsApp como conectado, mesmo sem haver entrega efetiva das mensagens ao webhook do FechAI.

A recuperação imediata consiste no reinício controlado somente do serviço Evolution. Como prevenção, foi preparada uma correção que monitora a saúde real da Evolution, reinicia automaticamente o serviço quando ele fica travado, amplia com cautela o pool de conexões e repara configurações de webhook perdidas.

## 2. Impacto observado

- Clientes enviaram mensagens pelo WhatsApp e não receberam resposta automática.
- As mensagens não apareceram na lista de conversas do FechAI.
- O impacto ficou concentrado no tenant Instituto do Sorriso.
- Não foram encontradas evidências de falha na regra, persona ou modelo da agente Paula durante este incidente.
- Não houve indicação de perda ou corrupção do banco de dados do FechAI.

Contatos informados na apuração:

- `+55 14 99121-1925`
- `+55 14 99904-1500`
- `+55 14 99613-0256`

As buscas no painel não localizaram conversas correspondentes a esses números. Isso confirma que as mensagens não chegaram ao fluxo normal do agente.

## 3. Evidências técnicas

1. O último log relevante da Evolution ocorreu por volta de 01:35, conforme informado durante o atendimento.
2. O log apresentou erro `Prisma P2024`.
3. A configuração registrada no erro utilizava:
   - limite de conexões: `5`;
   - tempo de espera do pool: `10 segundos`.
4. Após esse ponto, não havia novos registros compatíveis com as mensagens mostradas nas capturas de tela.
5. O FechAI continuava mostrando a integração como conectada, o que indica que o status salvo não era suficiente para detectar que a Evolution havia parado de processar eventos.

## 4. Causa provável

A causa provável foi a indisponibilidade funcional da Evolution provocada pelo esgotamento do pool de conexões do Prisma com o PostgreSQL.

O erro `P2024` ocorre quando o Prisma não consegue obter uma conexão disponível dentro do tempo configurado. Nesse estado, a Evolution pode continuar com o processo e o container ativos, mas falhar ao consultar o banco, processar mensagens ou entregar webhooks.

É importante classificar esta conclusão como **causa provável**, e não definitiva, porque não havia logs posteriores ao travamento nem métricas históricas detalhadas do pool no momento do incidente.

## 5. Recuperação imediata

Foi definido o reinício isolado do serviço Evolution:

```bash
docker compose restart evolution
```

Esse procedimento:

- reinicia somente a Evolution;
- não remove containers de banco de dados;
- não apaga volumes;
- não apaga sessões do WhatsApp;
- não utiliza `down`, `rm` ou qualquer comando destrutivo.

Após o reinício, a validação operacional recomendada é enviar uma mensagem de teste para o número conectado e confirmar que ela aparece em **Conversas** e recebe resposta da agente.

## 6. Correção preventiva preparada

Foi preparada uma proteção em várias camadas:

### 6.1 Healthcheck real da Evolution

O Docker passa a consultar periodicamente uma rota autenticada da Evolution. A checagem depende da API, do Prisma e do banco responderem, em vez de verificar apenas se o processo continua aberto.

### 6.2 Reinício automático com Autoheal

Quando o healthcheck falhar repetidamente, o serviço Autoheal reinicia somente o container da Evolution. Assim, uma nova ocorrência não depende de intervenção manual durante a madrugada ou fora do horário de atendimento.

### 6.3 Ajuste do pool de conexões

A conexão da Evolution foi preparada para utilizar, por padrão:

- `connection_limit=10`;
- `pool_timeout=30`.

O objetivo é reduzir falhas por picos momentâneos sem aumentar o pool de forma descontrolada.

### 6.4 Verificação e reparo do webhook

O worker do FechAI passa a verificar periodicamente se o webhook da instância continua:

- habilitado;
- apontando para a URL correta;
- com o segredo correto;
- inscrito nos eventos necessários.

Se houver divergência, a configuração é reparada automaticamente. Se estiver correta, nenhuma alteração é feita.

### 6.5 Separação do monitoramento

A checagem da integração passa a executar em uma fila independente, com frequência de um minuto. Dessa forma, uma rotina demorada de follow-up ou lembretes não atrasa a verificação do WhatsApp.

### 6.6 Limites de tempo nas chamadas

As chamadas de saúde e configuração receberam timeout. Isso impede que uma requisição travada prenda indefinidamente o worker responsável pelo monitoramento.

## 7. Validações realizadas

A correção preventiva foi validada localmente com:

- validação dos dois arquivos Docker Compose;
- verificação completa de tipos TypeScript;
- lint do projeto;
- suíte automatizada completa;
- testes específicos de saúde da Evolution e reparo do webhook.

As validações locais foram concluídas sem falhas relevantes.

## 8. Estado de implantação

O primeiro envio da correção iniciou um deploy automático, mas esse deploy foi cancelado a pedido do responsável pela operação. O commit local também foi desfeito, preservando os arquivos modificados para revisão e envio manual.

Portanto, este relatório **não afirma que a proteção preventiva já esteja ativa em produção**. A implantação precisa ser feita de forma controlada pelo responsável e confirmada com uma verificação posterior.

## 9. Critérios para considerar o incidente encerrado

O incidente pode ser encerrado quando todos os itens abaixo forem confirmados:

1. A correção preventiva foi revisada e implantada em produção.
2. Os serviços `evolution`, `evolution-postgres` e `autoheal` aparecem saudáveis.
3. Uma mensagem real de teste chega ao FechAI e aparece em **Conversas**.
4. A agente responde normalmente pelo WhatsApp.
5. O webhook permanece configurado após um reinício controlado da Evolution.
6. Não há novos erros `P2024` ou períodos prolongados sem logs durante o acompanhamento.

## 10. Recomendações adicionais

- Acompanhar os logs da Evolution por pelo menos 24 horas após a implantação.
- Criar alerta externo quando a Evolution ficar `unhealthy` ou for reiniciada automaticamente.
- Registrar quantidade e horário dos reinícios para identificar recorrência.
- Se o `P2024` voltar a ocorrer, medir conexões ativas no PostgreSQL antes de aumentar novamente o pool.
- Não usar apenas o status “conectado” salvo no painel como prova de funcionamento; sempre validar o caminho completo com uma mensagem de teste.

## 11. Conclusão

O silêncio da IA foi consequência de uma interrupção anterior ao agente: as mensagens não chegaram ao FechAI. A principal evidência aponta para a Evolution travada após falha no pool de conexões do Prisma.

O reinício isolado da Evolution é a recuperação imediata e segura. Para evitar dependência de correção manual, foi preparada uma solução com healthcheck funcional, reinício automático, pool ajustado, monitoramento independente e autorreparo do webhook. A solução está validada localmente, mas ainda depende de implantação controlada e validação em produção.
