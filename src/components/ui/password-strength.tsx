"use client";

import { Check, X } from "lucide-react";
import { checkPassword, passwordStrength } from "@/lib/password";
import { cn } from "@/lib/utils";

/**
 * Barra de força + checklist ao vivo das regras de senha.
 *
 * A checklist é o ponto: dizer "senha fraca" sem dizer o que falta obriga a
 * pessoa a adivinhar a política tentativa por tentativa. Cada item traz ícone
 * e texto — nunca só a cor (design-ui, seção 4).
 *
 * Só aparece depois que a pessoa começa a digitar: mostrar seis itens vermelhos
 * num campo vazio parece uma tela de erro antes de qualquer erro.
 */
export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;

  const rules = checkPassword(password);
  const { score, label } = passwordStrength(password);

  const tone =
    score >= 4
      ? { bar: "bg-success", text: "text-success" }
      : score === 3
        ? { bar: "bg-success", text: "text-success" }
        : score === 2
          ? { bar: "bg-warn", text: "text-warn" }
          : { bar: "bg-danger", text: "text-danger" };

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-3">
        {/* 4 segmentos em vez de uma barra contínua: a força é uma escala
            grossa, e fingir precisão de porcentagem seria mentira. */}
        <div className="flex flex-1 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= score ? tone.bar : "bg-neutral/15",
              )}
            />
          ))}
        </div>
        <span className={cn("font-mono text-[11px] uppercase tracking-[0.15em]", tone.text)}>
          {label}
        </span>
      </div>

      <ul className="mt-2 space-y-1" aria-live="polite">
        {rules.map((r) => (
          <li
            key={r.id}
            className={cn(
              "flex items-start gap-1.5 text-xs leading-relaxed",
              r.ok ? "text-success" : "text-neutral",
            )}
          >
            {r.ok ? (
              <Check size={13} strokeWidth={3} className="mt-0.5 shrink-0" aria-hidden />
            ) : (
              <X size={13} strokeWidth={3} className="mt-0.5 shrink-0" aria-hidden />
            )}
            <span>
              {r.label}
              <span className="sr-only">{r.ok ? " — atendido" : " — falta"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
