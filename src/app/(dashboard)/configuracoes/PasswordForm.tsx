"use client";

import { useActionState, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordStrength } from "@/components/ui/password-strength";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { changePassword } from "./actions";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, null);
  const [show, setShow] = useState(false);
  // Só para alimentar a checklist de força — o valor enviado sai do FormData.
  const [newPassword, setNewPassword] = useState("");
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const type = show ? "text" : "password";

  /*
   * Sucesso limpa o formulário: senha antiga e nova não podem continuar
   * legíveis na tela depois de trocadas. Em vez de um efeito com `reset()`
   * (que dispararia `setState` dentro do efeito, além de não zerar o campo
   * controlado), a `key` remonta o formulário inteiro — os campos não
   * controlados voltam a vazio sozinhos e o controlado é zerado abaixo.
   */
  const [lastCleared, setLastCleared] = useState<typeof state>(null);
  const [clearCount, setClearCount] = useState(0);
  if (state?.ok && state !== lastCleared) {
    setLastCleared(state);
    setClearCount((c) => c + 1); // contador, não booleano: a 2ª troca também precisa remontar
    setNewPassword("");
  }

  return (
    <form key={clearCount} action={formAction} className="space-y-5">
      <Field label="Senha atual" htmlFor={currentId}>
        <Input
          {...fieldProps(currentId)}
          type={type}
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </Field>

      <div>
        <Field label="Nova senha" htmlFor={newId}>
          <Input
            {...fieldProps(newId)}
            type={type}
            name="newPassword"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            required
          />
        </Field>
        <PasswordStrength password={newPassword} />
      </div>

      <Field label="Confirmar nova senha" htmlFor={confirmId}>
        <Input
          {...fieldProps(confirmId)}
          type={type}
          name="confirmPassword"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </Field>

      <label className="inline-flex w-fit cursor-pointer items-center gap-2 font-mono text-micro uppercase tracking-wide text-white/55 transition-colors hover:text-white/80">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
          className="peer sr-only"
        />
        {show ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
        {show ? "Ocultar senhas" : "Mostrar senhas"}
      </label>

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="submit" loading={pending} loadingLabel="Alterando senha">
        Alterar senha
      </Button>
    </form>
  );
}
