"use client";

import { useActionState, useId } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MIN_PAYOUT_CENTS } from "@/modules/affiliates/config";
import { formatBRL } from "@/lib/format";
import { savePayoutInfo, type ActionState } from "./actions";

/**
 * Dados de recebimento. Pedidos antes de existir saldo de propósito: quando a
 * primeira comissão liberar, não deve haver nada travando o pagamento.
 */
export function PayoutForm({ pixKey, holderName }: { pixKey: string; holderName: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePayoutInfo, null);
  const keyId = useId();
  const nameId = useId();

  return (
    <Card>
      <CardTitle hint={`O saque é liberado a partir de ${formatBRL(MIN_PAYOUT_CENTS)} acumulados.`}>
        Onde você recebe
      </CardTitle>

      <form action={action} className="space-y-4">
        <Field label="Chave Pix" htmlFor={keyId} hint="CPF/CNPJ, e-mail, telefone ou chave aleatória.">
          <Input
            {...fieldProps(keyId, { hint: true })}
            name="payoutPixKey"
            defaultValue={pixKey}
            placeholder="seu@email.com"
            autoComplete="off"
            required
          />
        </Field>

        <Field label="Nome do titular" htmlFor={nameId}>
          <Input
            {...fieldProps(nameId)}
            name="payoutName"
            defaultValue={holderName}
            placeholder="Nome como está na conta"
            autoComplete="name"
            required
          />
        </Field>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="outline" size="sm" loading={pending}>
            Salvar
          </Button>
          {state?.ok && (
            <p role="status" className="text-sm text-success">
              {state.ok}
            </p>
          )}
        </div>

        {state?.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
      </form>
    </Card>
  );
}
