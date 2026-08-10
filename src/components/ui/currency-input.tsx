"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldBase } from "./input";

/** "0,05" … "10.000.000,00" — formatação pt-BR, sem o símbolo (o label já diz R$). */
const BRL = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Máximo de dígitos inteiros digitados (10 = até R$ 10 milhões, igual à regra do servidor). */
const MAX_DIGITS = 10;

/**
 * Campo de preço com máscara em reais: o usuário digita só números e o valor é
 * formatado na hora como "1.234,56" (os dois últimos dígitos são os centavos —
 * digitar "5" vira "0,05"). O input guarda a versão FORMATADA via `name`, e o
 * servidor interpreta o formato pt-BR com `parseReais` (aceita "500", "499,90"
 * e "1.234,56").
 *
 * Client de propósito (mantém o estado dos dígitos) — por isso não aceita
 * `value`/`onChange` controlado por quem usa.
 */
export const CurrencyInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue">
>(function CurrencyInput({ className, ...props }, ref) {
  const [digits, setDigits] = React.useState("");

  const display = digits === "" ? "" : BRL.format(Number(digits) / 100);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDigits(e.target.value.replace(/\D/g, "").slice(0, MAX_DIGITS));
  }

  return (
    <input
      ref={ref}
      {...props}
      inputMode="decimal"
      autoComplete="off"
      value={display}
      onChange={handleChange}
      className={cn(fieldBase, "h-10", className)}
    />
  );
});
CurrencyInput.displayName = "CurrencyInput";
