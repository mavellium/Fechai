# Módulo: tenants

## O que faz

Provisiona novos tenants (contas) do SaaS. Um tenant = um negócio isolado por `tenantId`. No MVP, 1 usuário dono (`OWNER`) por tenant.

## Arquivos

- `provision.ts` — `createTenantWithOwner()`: cria Tenant + User dono + `AgentConfig` vazio + `WhatsappInstance` (disconnected) + `TenantAction`s padrão (todas `off`), numa transação. Exporta `DEFAULT_ACTION_KEYS`.
- `onboarding.ts` — `getOnboardingSteps()`: checklist de progresso exibido em `/inicio`, derivado do estado real no banco. **Não** é o wizard.
- `onboarding-wizard.ts` — domínio do wizard guiado de `/onboarding` (catálogo de passos, opções de tom/objetivo, catálogo de processos, validação por passo e tradução das respostas para persona + automações).

## Contratos expostos

```ts
createTenantWithOwner({ tenantName, email, passwordHash, planKey?, role? })
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
