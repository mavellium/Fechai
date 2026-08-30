import posthog from "posthog-js"

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST

if (!projectToken || !host) {
  if (process.env.NODE_ENV === "development") {
    const missingVariable = projectToken
      ? "NEXT_PUBLIC_POSTHOG_HOST"
      : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN"

    // `console.warn`, e não `throw`: este arquivo roda no cliente antes da
    // hidratação, então uma exceção aqui derrubava o React da página inteira —
    // formulários paravam de funcionar em dev (o /login submetia como GET, com
    // a senha na query string). Faltar analytics não pode quebrar o produto.
    // O aviso continua para ninguém achar que está medindo sem estar.
    console.warn(
      `[posthog] ${missingVariable} não configurada: os eventos não estão sendo enviados. ` +
        `Defina ${missingVariable} no .env (o token público começa com "phc_") e reinicie o dev server.`,
    )
  }
} else {
  posthog.init(projectToken, {
    api_host: host,
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  })
}
