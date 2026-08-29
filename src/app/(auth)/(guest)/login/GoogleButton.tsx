"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { startGoogleSignIn } from "./actions";

/**
 * Marca do Google, nas cores oficiais. É exigência das diretrizes de branding
 * do "Sign in with Google": o logo não pode ser recolorido nem substituído por
 * um ícone genérico, então este SVG fica inline em vez de vir do Lucide.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A8.99 8.99 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.94H.96a8.99 8.99 0 0 0 0 8.12l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A8.99 8.99 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

function Submit({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      className="w-full"
      disabled={disabled}
      loading={pending}
      loadingLabel="Abrindo o Google"
    >
      <GoogleMark />
      Entrar com Google
    </Button>
  );
}

/**
 * Fica num `<form>` próprio, fora do formulário de e-mail e senha: aninhar
 * formulários é inválido em HTML, e um `formAction` no mesmo form faria o
 * navegador exigir os campos obrigatórios de senha antes de ir para o Google.
 */
export function GoogleButton({ disabled }: { disabled?: boolean }) {
  return (
    <form action={startGoogleSignIn}>
      <Submit disabled={disabled} />
    </form>
  );
}
