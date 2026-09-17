"use client";

import { useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  REMINDER_COUNT_WARNING,
  REMINDER_UNITS,
  REMINDER_VARIABLES,
  formatReminderLead,
  renderReminder,
  splitReminderLead,
  type ReminderRule,
  type ReminderUnit,
} from "@/modules/scheduling/config";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectMenu } from "@/components/ui/select-menu";
import { Textarea } from "@/components/ui/textarea";

/**
 * Lista de lembretes pré-consulta, com antecedência e texto por linha.
 *
 * Vive num componente próprio porque aparece em dois lugares com o mesmo
 * comportamento: o padrão do agente (Ações › Agendar horário) e os lembretes
 * de uma consulta específica (diálogo da /agenda). Duplicar daria duas telas
 * que divergem na primeira correção.
 *
 * O estado é do pai (`value`/`onChange`): nos dois lugares a lista é enviada
 * junto de outros campos, num formulário que já tem o seu próprio botão.
 */

/** Linha de edição: o número digitado + a unidade, antes de virar minutos. */
export type ReminderDraft = {
  amount: number;
  unit: ReminderUnit;
  template: string;
};

/** Converte a config salva (minutos) para as linhas editáveis da tela. */
export function toDrafts(reminders: ReminderRule[]): ReminderDraft[] {
  return reminders.map((r) => ({
    ...splitReminderLead(r.minutesBefore),
    template: r.template,
  }));
}

/** O caminho de volta: o que a tela envia ao servidor. */
export function fromDrafts(drafts: ReminderDraft[]): ReminderRule[] {
  return drafts.map((d) => ({
    minutesBefore: draftMinutes(d),
    template: d.template,
  }));
}

export function draftMinutes(d: ReminderDraft): number {
  const unit = REMINDER_UNITS.find((u) => u.value === d.unit) ?? REMINDER_UNITS[0];
  return Math.round((Number.isFinite(d.amount) ? d.amount : 0) * unit.minutes);
}

const UNIT_OPTIONS = REMINDER_UNITS.map((u) => ({ value: u.value, label: u.label }));

export function ReminderList({
  value,
  onChange,
  location,
  idPrefix,
}: {
  value: ReminderDraft[];
  onChange: (next: ReminderDraft[]) => void;
  /** Local configurado, para a prévia mostrar o `{{local}}` de verdade. */
  location: string;
  /** Prefixo dos ids, já que a lista aparece em mais de um formulário. */
  idPrefix: string;
}) {
  // Dois disparos no mesmo momento chegam como duas mensagens coladas. O
  // servidor recusa; aqui a linha é marcada enquanto a pessoa ainda digita,
  // que é quando dá para consertar sem perder o resto do formulário.
  const [showSpamWarning, setShowSpamWarning] = useState(false);
  // Uma vez por edição: o aviso em bloco permanece na tela, o popup não se
  // repete a cada lembrete novo.
  const warnedRef = useRef(false);

  const duplicates = useMemo(() => {
    const count = new Map<number, number>();
    for (const d of value) {
      const m = draftMinutes(d);
      count.set(m, (count.get(m) ?? 0) + 1);
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([m]) => m));
  }, [value]);

  function update(index: number, patch: Partial<ReminderDraft>) {
    onChange(value.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function changeUnit(index: number, next: ReminderUnit) {
    const current = value[index];
    if (!current || current.unit === next) return;
    // Converte o número já digitado para a nova unidade em vez de zerar:
    // trocar "dias" por "horas" com 1 no campo deve virar 24.
    const from = REMINDER_UNITS.find((u) => u.value === current.unit)!;
    const to = REMINDER_UNITS.find((u) => u.value === next)!;
    const minutes = (Number.isFinite(current.amount) ? current.amount : 0) * from.minutes;
    update(index, { unit: next, amount: Math.max(1, Math.round(minutes / to.minutes)) });
  }

  function add() {
    // O novo nasce mais perto da consulta que o último — a ordem em que a
    // clínica costuma pensar ("e mais um, já em cima da hora").
    const last = value[value.length - 1];
    const next: ReminderDraft = last
      ? { amount: 2, unit: "hours", template: last.template }
      : { amount: 1, unit: "days", template: "" };

    // O aviso em bloco já está na tela desde o décimo; ao ULTRAPASSAR, o
    // popup interrompe uma vez. Interromper é proporcional aqui porque o
    // estrago não cai sobre quem clica: é o número da clínica que é
    // bloqueado, e isso só se descobre semanas depois. Uma vez por sessão de
    // edição (`warnedRef`), senão viraria ruído a cada clique — e ruído é o
    // que treina a pessoa a fechar sem ler.
    if (value.length + 1 > REMINDER_COUNT_WARNING && !warnedRef.current) {
      warnedRef.current = true;
      setShowSpamWarning(true);
    }
    onChange([...value, next]);
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-white/50">
          Nenhum lembrete. O contato não receberá aviso antes da consulta.
        </p>
      )}

      {value.map((draft, index) => {
        const minutes = draftMinutes(draft);
        const duplicated = duplicates.has(minutes);
        const id = `${idPrefix}-lembrete-${index}`;
        return (
          <div
            key={index}
            className={`space-y-3 rounded-control border p-3 ${
              duplicated ? "border-danger/60" : "border-white/10"
            }`}
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-24">
                <label htmlFor={id} className="text-sm font-medium text-white/85">
                  Avisar
                </label>
                <Input
                  id={id}
                  type="number"
                  min={1}
                  step={1}
                  className="mt-1.5"
                  value={Number.isFinite(draft.amount) ? draft.amount : ""}
                  onChange={(e) => update(index, { amount: e.target.valueAsNumber })}
                  required
                />
              </div>
              <SelectMenu
                label={`Unidade do lembrete ${index + 1}`}
                value={draft.unit}
                onChange={(v) => changeUnit(index, v as ReminderUnit)}
                options={UNIT_OPTIONS}
                className="w-40"
              />
              <Button
                type="button"
                variant="ghost"
                aria-label={`Remover lembrete ${formatReminderLead(minutes)} antes`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Trash2 size={15} aria-hidden />
              </Button>
            </div>

            {duplicated && (
              <p className="text-sm text-danger">
                Você já tem outro lembrete {formatReminderLead(minutes)} antes. Escolha outro
                momento.
              </p>
            )}

            <div>
              <label htmlFor={`${id}-texto`} className="text-sm font-medium text-white/85">
                Mensagem
              </label>
              <Textarea
                id={`${id}-texto`}
                className="mt-1.5"
                rows={2}
                maxLength={500}
                placeholder="Ex: Oi {{nome}}! Sua consulta é {{data}} às {{hora}}."
                value={draft.template}
                onChange={(e) => update(index, { template: e.target.value })}
                required
              />
              {/* A prévia é o que faz um token escrito errado aparecer como
                  buraco na frase aqui, e não na mensagem do paciente. */}
              <p className="mt-1.5 text-sm text-white/45">
                {draft.template.trim()
                  ? renderReminder(draft.template, {
                      nome: "Maria",
                      data: "quinta-feira, 18 de setembro",
                      hora: "15:00",
                      local: location,
                    })
                  : "Escreva a mensagem deste lembrete."}
              </p>
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {REMINDER_VARIABLES.map((v) => (
          <span key={v.token} className="text-sm text-white/45">
            <code className="text-white/70">{v.token}</code> {v.label}
          </span>
        ))}
      </div>

      {/* Sem teto de quantidade: quantos lembretes o paciente aguenta é
          decisão de quem conhece a própria base. Mas quem leva o bloqueio no
          WhatsApp é o número da clínica, e isso precisa estar escrito antes
          de acontecer — não depois. */}
      {value.length >= REMINDER_COUNT_WARNING && (
        <Alert tone="warn">
          {value.length} lembretes para a mesma consulta. Muitas mensagens seguidas costumam ser
          marcadas como spam, e quem pode acabar bloqueado é o número da clínica.
        </Alert>
      )}

      <Button type="button" variant="outline" onClick={add}>
        Adicionar lembrete
      </Button>

      <Modal
        open={showSpamWarning}
        onClose={() => setShowSpamWarning(false)}
        title="Muitos lembretes para a mesma consulta"
        description="Nada foi bloqueado — o lembrete foi adicionado. Só vale saber o risco."
      >
        <div className="space-y-4">
          <p className="text-sm text-white/75">
            Acima de {REMINDER_COUNT_WARNING} avisos, o contato recebe uma sequência de mensagens
            sobre o mesmo compromisso. Quem recebe demais costuma marcar como spam ou bloquear — e
            o bloqueio cai sobre <strong className="text-white">o número da clínica</strong>, não
            sobre o fechai. Um número bloqueado deixa de alcançar também os outros pacientes.
          </p>
          <p className="text-sm text-white/60">
            Se a intenção é insistir com quem costuma faltar, costuma funcionar melhor poucos
            lembretes bem colocados (uma semana, um dia e duas horas antes) do que muitos seguidos.
          </p>
          <div className="flex justify-end">
            <Button type="button" onClick={() => setShowSpamWarning(false)}>
              Entendi
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
