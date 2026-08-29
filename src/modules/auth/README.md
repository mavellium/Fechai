# Módulo: auth

## O que faz

Login com Google (NextAuth), "esqueci minha senha" por e-mail e freio de força bruta no login. Complementa `src/auth.ts` (config do NextAuth) e `src/lib/login-throttle.ts` (o freio em si, que mora em `lib/` por depender só do Redis, sem Prisma).

## Arquivos

- `attempts.ts` — `requestContext()` (IP real por trás do proxy + user-agent) e `recordLoginAttempt()`: grava toda tentativa de login (credenciais ou Google, sucesso ou falha, com motivo) na tabela `LoginAttempt`. Só auditoria — não decide bloqueio. Escrita best-effort: uma falha ao gravar nunca derruba um login.
- `password-reset.ts` — domínio do token de redefinição: `issueResetToken()` (cria o token, derruba os anteriores do usuário), `resolveUsableResetToken()` (existe + não usado + não expirado), `hashResetToken()`/`createResetToken()`. Só o SHA-256 do token vai para `PasswordResetToken.tokenHash` — o valor em claro nunca toca o banco. TTL: `PASSWORD_RESET_TTL_MINUTES` (30 min).
- `reset-email.ts` — `buildPasswordResetEmail({ name, resetUrl })`: HTML (tabela + estilo inline, para sobreviver a clientes de e-mail) e texto puro do e-mail de redefinição.
- `login-errors.ts` — `loginErrorMessage(code)`: traduz os códigos de erro que chegam em `/login?error=` (do NextAuth ou nossos, vindos do callback `signIn` do Google) para mensagens em português com próximo passo. `errorSuggestsSignup(code)` decide quando a tela de login mostra o link para `/cadastro`.

## Contratos expostos

```ts
requestContext(): Promise<{ ip: string; userAgent: string | null }>
recordLoginAttempt({ context, email, success, provider, reason? }): Promise<void>

issueResetToken({ userId, ip, userAgent }): Promise<string>          // devolve o token em claro
resolveUsableResetToken(token): Promise<{ id, userId, email } | null>
PASSWORD_RESET_TTL_MINUTES: number

buildPasswordResetEmail({ name, resetUrl }): { subject, html, text }

loginErrorMessage(code?): string | null
errorSuggestsSignup(code?): boolean
```

Consumido por: `src/auth.ts` (credentials + Google), `src/app/(auth)/(guest)/esqueci-senha/actions.ts`, `src/app/(auth)/redefinir-senha/actions.ts` e `[token]/page.tsx`, `src/app/(auth)/(guest)/login/page.tsx`.

## Freio de força bruta (não é deste módulo — vive em `src/lib/login-throttle.ts`)

Contagem por **e-mail + IP** (não IP puro — bloquear o IP inteiro derrubaria uma rede compartilhada inteira por causa de uma pessoa). Escada progressiva no Redis: a partir de 5 falhas passa a haver espera, crescendo até 30 min na 10ª. Login certo zera o contador. Rede extra contra *spray* (30 falhas/15min no mesmo IP, IP puro). Redis fora do ar → falha aberto (login segue funcionando sem o freio; nunca vira indisponibilidade de autenticação). `peekLoginBlock()` é só leitura — usado por `src/app/(auth)/(guest)/login/actions.ts` (`loginBlockStatus`) para avisar a tela sem incrementar nada.

## Login com Google — não cria conta

O provider Google em `src/auth.ts` **só autentica**, nunca provisiona tenant: `/cadastro` exige CPF/CNPJ, telefone, nascimento e segmento, que o Google não fornece. E-mail do Google sem conta correspondente → `signIn` devolve `"/login?error=google_no_account"`, a tela mostra a mensagem com link para `/cadastro`. Exige `profile.email_verified === true`. Ao logar com sucesso, grava `User.googleId`/`googleLinkedAt` (metadado, não usado para autorização) e o callback `jwt` relê o usuário do banco pelo e-mail — sem isso `session.user.id` seria o `sub` do Google e toda query multi-tenant filtraria por um tenant inexistente.

Configuração: `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (prioridade) ou `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (fallback — o mesmo cliente OAuth já usado pela integração de Google Agenda). Sem nenhum dos dois pares, o provider não é registrado e o botão some da tela (`isGoogleAuthConfigured` exportado de `src/auth.ts`).

## Rotas

- `/login` — Server Component (`(guest)/login/page.tsx`) lê `?error=`/`?reset=1` e resolve `isGoogleAuthConfigured`; `LoginForm.tsx` (client) faz o submit via `next-auth/react`, mostra o aviso do freio antes do bloqueio de fato (`loginBlockStatus`) e o botão do Google (`GoogleButton.tsx`, formulário próprio com Server Action `startGoogleSignIn`).
- `/esqueci-senha` — pede e-mail, sempre responde a mesma mensagem genérica (exista ou não a conta). Rate limit próprio (`lib/rate-limit.ts`, 5/15min por IP e 3/15min por e-mail) — diferente do freio de login, que é sobre autenticação, não sobre disparo de e-mail.
- `/redefinir-senha/[token]` — token no path, não em query string, para não vazar em `Referer`/logs de proxy. Token inválido/expirado/usado mostram a mesma tela ("este link não vale mais") — não dá pra saber qual dos três motivos, de propósito.

Ambas em `src/app/(auth)/`, mas em grupos de rota diferentes: `/login`, `/cadastro` e `/esqueci-senha` estão em `(guest)/` (guard `requireGuest()` — quem já tem sessão é redirecionado); `/redefinir-senha` fica FORA de `(guest)`, porque o link do e-mail costuma ser aberto com uma sessão antiga ainda ativa no navegador — com o guard, o clique cairia calado no dashboard sem redefinir nada.

## O que NÃO faz

- Não expira sessões existentes ao redefinir a senha (o JWT permanece válido até expirar sozinho — ver observação abaixo).
- Não oferece 2FA/TOTP.
- Não permite desvincular a conta Google pela UI (só existe o vínculo, sem fluxo de remoção).
- Não bloqueia por *device fingerprint* — só e-mail+IP e IP puro.

## Pendência conhecida

Trocar a senha não invalida tokens JWT de sessões já abertas em outros dispositivos. Fechar isso exigiria um campo `passwordChangedAt` em `User` e uma leitura no banco a cada renovação de sessão — mudaria o custo de toda requisição autenticada. Não implementado; decisão em aberto.
