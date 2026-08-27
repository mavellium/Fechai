"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import posthog from "posthog-js";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TypingToCheck } from "@/components/ui/TypingToCheck";
import { EmailField, PasswordField, LabeledField } from "../_components/fields";

type Phase = "idle" | "loading" | "done";

export default function CadastroPage() {
  const router = useRouter();
  const nameId = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (emailError || passwordError) return;
    setFormError(null);
    setPhase("loading");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const name = String(form.get("name") ?? "");

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Não conseguimos criar sua conta. Tente de novo.");
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) throw new Error("Conta criada, mas o login falhou — entre pela tela de login.");
      const session = await fetch("/api/auth/session").then((r) => r.json()).catch(() => null);
      if (!session?.user?.id) throw new Error("Não foi possível iniciar sua sessão. Tente entrar novamente.");
      posthog.identify(session.user.id, {
        ...(session.user.email ? { email: session.user.email } : {}),
        role: session.user.role,
      });
      posthog.capture("account_registered", { role: session.user.role });
      setPhase("done"); // digitando → check antes de navegar
      setTimeout(() => {
        router.push("/planos");
        router.refresh();
      }, 450);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro inesperado. Tente de novo.");
      setPhase("idle");
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Crie sua conta</h1>
      <p className="mt-1 text-sm text-neutral">Leva menos de 30 segundos.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        <LabeledField label="Nome do negócio" htmlFor={nameId} hint="Opcional — dá nome ao seu painel.">
          <Input id={nameId} name="name" placeholder="Ex: Estúdio Aurora" autoComplete="organization" autoFocus />
        </LabeledField>
        <EmailField error={emailError} onValidate={setEmailError} />
        <PasswordField
          minLength={6}
          error={passwordError}
          onValidate={setPasswordError}
          autoComplete="new-password"
        />

        {formError && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}

        <Button type="submit" variant="cta" className="w-full" disabled={phase !== "idle"}>
          {phase === "idle" ? (
            "Criar minha conta"
          ) : (
            <TypingToCheck state={phase === "done" ? "done" : "typing"} size={18} doneColor="white" />
          )}
        </Button>
        <p className="text-center text-sm text-neutral">Sem cartão de crédito no plano grátis.</p>
      </form>

      <p className="mt-6 text-center text-sm text-neutral">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-iris hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
