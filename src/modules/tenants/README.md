# Módulo: tenants

## O que faz

Provisiona novos tenants (contas) do SaaS. Um tenant = um negócio isolado por `tenantId`. No MVP, 1 usuário dono (`OWNER`) por tenant.

## Arquivos

- `provision.ts` — `createTenantWithOwner()`: cria Tenant + User dono + `AgentConfig` vazio + `WhatsappInstance` (disconnected) + `TenantAction`s padrão (todas `off`), numa transação. Exporta `DEFAULT_ACTION_KEYS`. Conta criada num plano com `trialDays` (hoje só o `FREE`) nasce com `trialEndsAt` = agora + `trialDays` — a duração vem do plano, não de uma constante local. Ver `modules/billing/README.md` para o que acontece quando o período acaba. O `lead?` opcional carrega a qualificação vinda do `/cadastro` (ver abaixo).
- `onboarding.ts` — `getOnboardingSteps()`: checklist de progresso exibido em `/inicio`, derivado do estado real no banco. **Não** é o wizard.
- `onboarding-wizard.ts` — domínio do wizard guiado de `/onboarding` (catálogo de passos, opções de tom/objetivo, catálogo de processos, validação por passo e tradução das respostas para persona + automações).

## Contratos expostos

```ts
createTenantWithOwner({ tenantName, email, passwordHash, planKey?, role?, lead? })
  : Promise<{ tenant, user }>
DEFAULT_ACTION_KEYS: readonly string[]

// onboarding-wizard.ts — importável por client component E server action
// (só tipos de outros módulos; nada de prisma/server-only aqui).
ONBOARDING_STEPS, TONE_OPTIONS, OBJECTIVE_OPTIONS, PROCESS_CATALOG
parseDraft(raw: unknown): OnboardingDraft        // tolera Json nulo/corrompido
validateStep(step, draft): StepErrors            // {} = pode avançar
canComplete(draft): boolean                      // passos 2 e 3 válidos
resolveActionKeys(draft, limit): ActionKey[]      // respeita o teto do plano
countActionsOverLimit(draft, limit): number      // p/ avisar na UI
draftToPersona(draft, businessName): PersonaAnswers
```

Consumidores: `src/app/api/register/route.ts` (fluxo grátis), webhook do Stripe (fluxo pago) e `src/app/onboarding/` (wizard).

## Qualificação do lead no `/cadastro`

O formulário público exige, além de e-mail/senha/nome do negócio: **CPF ou CNPJ**, **telefone**, **data de nascimento**, **gênero**, **cidade/UF**, **segmento do negócio** e **como conheceu o fechai**. Telefone secundário é o único opcional. A regra é atender à pergunta "quem são os donos de negócio que assinam o fechai" — por isso os dados **pessoais** (documento, telefones, nascimento, gênero) ficam no `User` e os do **negócio** (cidade, UF, segmento, origem) ficam no `Tenant`.

Validação, máscaras e as listas de opções moram em `src/lib/br-lead.ts` — uma fonte só, porque o formulário (client) e `/api/register` (server) precisam concordar; duas cópias deixariam passar no cliente o que o servidor rejeita. Inclui os dígitos verificadores de CPF e CNPJ (módulo 11) e a idade mínima de 18 anos, checada na rota.

CPF/CNPJ e telefones são gravados **só com dígitos** (`onlyDigits`); a máscara é aplicada na digitação e na exibição, nunca no armazenamento.

> Todos os campos são `String?`/`DateTime?` no schema: contas criadas antes desta mudança e as criadas pelo admin em `/admin/contas` (que não passam pelo formulário público) ficam com `null`. Não houve backfill.

## Política de senha forte

Definida em `src/lib/password.ts` (regras + força + gerador) e exposta como schema Zod em `src/lib/password-schema.ts` (`strongPassword()`). Seis regras, todas obrigatórias:

1. Pelo menos **8** caracteres (`MIN_PASSWORD_LENGTH`)
2. Uma letra maiúscula · 3. Uma minúscula · 4. Um número · 5. Um caractere especial
6. Sem sequências (`123`, `abc`, `cba`), sem repetições (`aaa`), sem trechos de teclado (`qwe`, `asd`) e sem palavras da lista de senhas comuns

Vale nas **três** entradas que criam senha: `/api/register`, a troca em `/configuracoes` (`changePassword`) e a criação de conta pelo admin (`createAccount`). A senha provisória gerada pelo admin sai de `generateStrongPassword()`, então já nasce dentro da política — antes ela era só letras e dígitos, ou seja, uma senha que o próprio produto recusaria depois.

> **`src/auth.ts` (login) fica de fora de propósito.** Endurecer a validação no login trancaria para fora quem criou a conta antes da regra, sem nenhum ganho: quem sabe a senha certa já sabe a senha certa. Política nova se aplica a senha nova.

Na interface, `components/ui/password-strength.tsx` mostra barra de força + checklist ao vivo das seis regras (ícone + texto, nunca só cor). O formulário valida com a mesma função do servidor — `isStrongPassword` —, então não existe caso em que o cliente aprova e o servidor recusa.

## Onboarding guiado (`/onboarding`)

Wizard de 4 passos para o usuário comum (`OWNER`); o `SUPERADMIN` nunca o vê porque a página usa `requireOwner()`.

Estado no `Tenant`: `onboardingCompleted` (flag final), `onboardingStep` (retomada) e `onboardingDraft` (Json com as respostas parciais).

Fluxo: `/cadastro` → `/planos` → `/onboarding` → `/inicio`. O guard vive no layout de `(dashboard)`, que redireciona para `/onboarding` enquanto a flag for falsa — por isso `/onboarding` mora **fora** desse grupo de rotas (senão haveria loop). A checagem de conta suspensa vem antes do guard, para a conta suspensa ver o aviso e não o wizard.

Ao concluir, `completeOnboarding()` grava numa transação: `AgentConfig` (systemPrompt composto + `personaDraft`), os `TenantAction` escolhidos (ligando os do plano e desligando o resto) e a flag. Como as respostas viram um `PersonaAnswers`, tudo que foi definido no wizard continua editável em `/agentes` — não existe estado paralelo.

> Contas criadas antes desta feature foram marcadas como concluídas (backfill), e o `seed.ts` já cria os tenants de exemplo com `onboardingCompleted: true`.

## O que NÃO faz

- Não cria sessão/login (isso é do Auth.js em `src/auth.ts`).
- Não cobra (billing é o módulo `billing/`).
- Não provisiona a instância na Evolution API — só o registro local (`whatsapp/`, Milestone 5).
