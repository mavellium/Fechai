"use client";

import { useId, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { saveSpeechBlocklist, type Result } from "./actions";

/** Mesmos limites de `modules/voice/speech-text.ts`, para a tela recusar antes do servidor. */
const MIN_TERMO = 2;
const MAX_TERMO = 60;
const MAX_TERMOS = 40;

function parse(raw: string): string[] {
  return raw
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Lista de termos que o agente não pronuncia (`Agent.speechBlocklist`).
 *
 * Vive dentro do card "A voz do agente", junto da escolha da voz, porque é
 * disso que ela trata: como a voz soa. Não é irmã das Regras da persona — as
 * Regras mudam o que o agente DIZ (viram instrução no prompt); aqui a frase já
 * está escrita e só não vai para o alto-falante.
 *
 * Salva a cada adição/remoção, como os toggles logo abaixo, em vez de ter um
 * "Salvar" próprio: a lista é uma linha de texto por termo, e um botão a mais
 * neste passo criaria a dúvida de qual botão salva o quê. Se o servidor recusar,
 * o chip volta — nada de lista na tela que não existe no banco.
 */
export function SpeechBlocklistForm({ agentId, initial }: { agentId: string; initial: string }) {
  const [terms, setTerms] = useState<string[]>(() => parse(initial));
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();

  function commit(next: string[], anterior: string[]) {
    setTerms(next);
    setState(null);
    const formData = new FormData();
    formData.set("agentId", agentId);
    formData.set("terms", next.join("\n"));
    startTransition(async () => {
      const res = await saveSpeechBlocklist(null, formData);
      // Falhou: desfaz na tela. Deixar o chip lá faria a lista mentir — e é uma
      // mentira silenciosa, porque quem lê a tela não tem como desconfiar.
      if (!res.ok) setTerms(anterior);
      setState(res);
    });
  }

  function add() {
    const termo = draft.trim();
    if (!termo) return;
    if (termo.length < MIN_TERMO) {
      setState({ ok: false, error: "Termo curto demais — com uma letra só ele comeria a frase." });
      return;
    }
    if (termo.length > MAX_TERMO) {
      setState({ ok: false, error: "Termo longo demais. Use uma palavra ou expressão curta." });
      return;
    }
    if (terms.some((t) => t.toLowerCase() === termo.toLowerCase())) {
      setDraft("");
      return;
    }
    if (terms.length >= MAX_TERMOS) {
      setState({ ok: false, error: `São no máximo ${MAX_TERMOS} termos.` });
      return;
    }
    setDraft("");
    commit([...terms, termo], terms);
  }

  return (
    <div className="mt-5 border-t border-white/10 pt-5">
      <h4 className="flex items-center gap-1.5 font-display text-sm font-semibold text-white">
        O que ele não fala
        <InfoHint label="o que ele não fala">
          Risada escrita (“kkkk”, “hahaha”, “rsrs”), emoji e formatação já saem do áudio sozinhos.
          Esta lista é para o que é do seu negócio: um bordão, um apelido, uma muleta que o agente
          repete. O texto escrito continua igual — muda só o que ele pronuncia. Vale para
          interjeição e ruído: tirar uma palavra que carrega sentido (“não”, “sem”) deixa a fala
          torta.
        </InfoHint>
      </h4>

      <div className="mt-3">
        <Field label="Palavra ou expressão" htmlFor={inputId} hint="Ex.: né, tipo, meu rei.">
          <div className="flex gap-2">
            <Input
              {...fieldProps(inputId, { hint: true })}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="né"
              maxLength={MAX_TERMO}
              disabled={pending}
            />
            <Button type="button" variant="outline" onClick={add} disabled={pending}>
              <Plus size={15} aria-hidden />
              Adicionar
            </Button>
          </div>
        </Field>
      </div>

      {terms.length === 0 ? (
        // Estado vazio sem ilustração: aqui vazio é o normal (a limpeza padrão
        // já resolve o caso comum), e um bloco grande sugeriria pendência.
        <p className="mt-3 text-sm text-white/45">Nenhum termo — ele fala a resposta inteira.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {terms.map((termo, i) => (
            <li
              key={`${termo}-${i}`}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 py-1 pl-3 pr-1 text-sm text-white/85"
            >
              <span className="min-w-0 break-words">{termo}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Voltar a falar: ${termo}`}
                disabled={pending}
                onClick={() =>
                  commit(
                    terms.filter((_, idx) => idx !== i),
                    terms,
                  )
                }
                className="h-6 w-6 shrink-0 text-white/55 hover:text-danger"
              >
                <X size={14} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <FormFeedback error={state?.error} info={state?.ok ? state.info : undefined} />
      </div>
    </div>
  );
}
