"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { TypingToCheck } from "@/components/ui/TypingToCheck";
import { EmailField, PasswordField } from "../_components/fields";

type Phase = "idle" | "loading" | "done";

export default function LoginPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (emailError) return;
    setFormError(null);
    setPhase("loading");
    const form = new FormData(e.currentTarget);
    const result = await signIn("credentials", {
      email: String(form.get("email")),
      password: String(form.get("password")),
      redirect: false,
    });
    if (result?.error) {
      setFormError("E-mail ou senha não conferem. Confira os dados e tente de novo.");
      setPhase("idle");
      return;
    }
    setPhase("done");
    // Superadmin vai direto para o painel dele; usuário comum, para o dashboard.
    const session = await fetch("/api/auth/session").then((r) => r.json()).catch(() => null);
    if (!session?.user?.id) {
      setFormError("Não foi possível iniciar sua sessão. Tente entrar novamente.");
      setPhase("idle");
      return;
    }
    posthog.identify(session.user.id, {
      ...(session.user.email ? { email: session.user.email } : {}),
      role: session.user.role,
    });
    posthog.capture("user_logged_in", { role: session.user.role });
    const dest = session.user.role === "SUPERADMIN" ? "/admin/contas" : "/inicio";
    setTimeout(() => {
      router.push(dest);
      router.refresh();
    }, 450);
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Entrar</h1>
      <p className="mt-1 text-sm text-neutral">Seu agente continua trabalhando — veja o painel.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        <EmailField error={emailError} onValidate={setEmailError} autoFocus />
        <PasswordField autoComplete="current-password" />

        {formError && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}

        <Button type="submit" variant="cta" className="w-full" disabled={phase !== "idle"}>
          {phase === "idle" ? (
            "Entrar"
          ) : (
            <TypingToCheck state={phase === "done" ? "done" : "typing"} size={18} doneColor="white" />
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral">
        Não tem conta?{" "}
        <Link href="/cadastro" className="font-medium text-iris hover:underline">
          Criar agora
        </Link>
      </p>
    </div>
  );
}
