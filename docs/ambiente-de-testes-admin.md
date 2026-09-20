# Ambiente de testes do administrador

O laboratório usa um banco PostgreSQL separado. Ele nunca alterna a conexão de
uma aplicação de produção já aberta.

## Primeira preparação

1. Opcionalmente configure `TEST_DATABASE_URL` no `.env`. Sem ela, o sistema
   deriva uma base irmã de `DATABASE_URL` acrescentando `_test` ao nome. Em
   ambos os casos, o nome precisa conter `test`, `teste`, `sandbox` ou `lab`.
2. Suba o PostgreSQL com `npm run db:up`.
3. Execute `npm run test:db:prepare` para criar a base, aplicar o schema e
   inserir as contas de demonstração.
4. Inicie o laboratório com `npm run dev:test` e abra
   `http://localhost:3002`.

O ambiente normal continua em `http://localhost:3001` e usa `DATABASE_URL`.

`saas_test` é outro **banco lógico** dentro do PostgreSQL local já existente;
não é necessário criar outro container para obter isolamento dos dados. O app
de laboratório usa a outra URL e, por isso, não lê nem grava no banco `saas`.

## Commit, push e produção

Commit e push enviam apenas os arquivos versionados. Eles não enviam o conteúdo
do `saas_test` e o deploy automático não cria um segundo Postgres na VPS. No
push para `main`, o GitHub Actions atualiza somente os containers do app web e
do worker; o Postgres de produção e seu volume são preservados.

Para disponibilizar um laboratório online, crie deliberadamente uma implantação
separada, com outro domínio/porta e uma `DATABASE_URL` exclusiva. Defina também
`DATABASE_ENVIRONMENT=test`. Não aponte uma instância de laboratório para o
banco de produção e não exponha a base local pela internet.

## Travas

- O comando recusa `TEST_DATABASE_URL` igual a `DATABASE_URL`.
- O nome da base precisa indicar explicitamente que é teste/laboratório.
- O painel mostra uma faixa amarela enquanto usa o banco isolado.
- Para uma homologação online, publique outra instância da aplicação com
  `DATABASE_URL` exclusiva e `DATABASE_ENVIRONMENT=test`.

## Comandos

- `npm run test:db:prepare`: cria, atualiza e semeia o banco.
- `npm run test:db:push`: atualiza apenas o schema.
- `npm run test:db:seed`: recria somente os dados de demonstração idempotentes.
- `npm run test:db:studio`: abre o Prisma Studio conectado ao laboratório.
- `npm run dev:test`: inicia o aplicativo na porta 3002 com a base isolada.
