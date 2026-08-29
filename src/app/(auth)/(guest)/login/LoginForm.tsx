"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TypingToCheck } from "@/components/ui/TypingToCheck";
import { EmailField, PasswordField } from "../../_components/fields";
import { GoogleButton } from "./GoogleButton";
import { loginBlockStatus } from "./actions";

type Phase = "idle" | "loading" | "done";

const CREDENTIALS_ERROR = "E-mail ou senha não conferem. Confira os dados e tente de novo.";

export function LoginForm({
  googleEnabled,
  initialError,
  suggestSignup,
  notice,
}: {
  googleEnabled: boolean;
  initialError: string | null;
  suggestSignup: boolean;
  notice: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [formError, setFormError] = useState<string | null>(initialError);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  // Aviso do freio de tentativas: vive separado do erro porque acompanha o
  // erro em vez de substituí-lo ("a senha não confere" E "falta pouco para
  // bloquear" são as duas coisas que a pessoa precisa saber).
  const [throttleWarning, setThrottleWarning] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (emailError) return;

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));

    setFormError(null);
    setThrottleWarning(null);
    setPhase("loading");

    const result = await signIn("credentials", {
      email,
      password: String(form.get("password")),
      redirect: false,
    });

    if (result?.error) {
      // O NextAuth devolve um erro genérico de propósito (não conta ao cliente
      // se o e-mail existe). O motivo real — bloqueio por tentativas — só sai
      // desta consulta, senão a pessoa ficaria tentando a senha certa sem
      // entender por que não entra.
      const status = await loginBlockStatus(email);
      setBlocked(status.blocked);
      setFormError(status.blocked ? null : CREDENTIALS_ERROR);
      setThrottleWarning(status.message);
      setPhase("idle");
      return;
    }

    setPhase("done");
    // Superadmin vai direto para o painel dele; usuário comum, para o dashboard.
    const session = await fetch("/api/auth/session").then((r) => r.json()).catch(() => null);
    const dest = session?.user?.role === "SUPERADMIN" ? "/admin/contas" : "/inicio";
    setTimeout(() => {
      router.push(dest);
      router.refresh();
    }, 450);
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Entrar</h1>
      <p className="mt-1 text-sm text-neutral">Seu agente continua trabalhando — veja o painel.</p>

      {notice && (
        <Alert tone="success" className="mt-6">
          {notice}
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        <EmailField error={emailError} onValidate={setEmailError} autoFocus />

        <div>
          <PasswordField autoComplete="current-password" />
          <div className="mt-2 text-right">
            <Link
              href="/esqueci-senha"
              className="rounded-control text-sm font-medium text-iris hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              Esqueci minha senha
            </Link>
          </div>
        </div>

        {formError && (
          <Alert tone="danger">
            {formError}
            {suggestSignup && (
              <>
                {" "}
                <Link href="/cadastro" className="font-medium underline">
                  Criar conta
                </Link>
              </>
            )}
          </Alert>
        )}

        {throttleWarning && (
          <Alert tone={blocked ? "danger" : "warn"}>
            {throttleWarning}
            {blocked && (
              <>
                {" "}
                <Link href="/esqueci-senha" className="font-medium underline">
                  Redefinir senha
                </Link>
              </>
            )}
          </Alert>
        )}

        <Button
          type="submit"
          variant="cta"
          className="w-full"
          disabled={phase !== "idle" || blocked}
        >
          {phase === "idle" ? (
            "Entrar"
          ) : (
            <TypingToCheck state={phase === "done" ? "done" : "typing"} size={18} doneColor="white" />
          )}
        </Button>
      </form>

      {googleEnabled && (
        <>
          <div className="my-6 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-ink/10" />
            <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-neutral">ou</span>
            <span className="h-px flex-1 bg-ink/10" />
          </div>

          <GoogleButton disabled={phase !== "idle"} />

          <p className="mt-3 text-center text-xs leading-relaxed text-neutral">
            O Google entra em contas que já existem. Ainda não tem uma? Faça o cadastro.
          </p>
        </>
      )}

      <p className="mt-6 text-center text-sm text-neutral">
        Não tem conta?{" "}
        <Link href="/cadastro" className="font-medium text-iris hover:underline">
          Criar agora
        </Link>
      </p>
    </div>
  );
}
