"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Check, CalendarClock, UserCheck } from "lucide-react";

/**
 * O hero é a demonstração: uma conversa real se resolvendo sozinha.
 * Máquina de estados sequencial (nada de cenas absolutas sobrepostas):
 * cada evento entra empilhado no fluxo, como num chat de verdade.
 * Reduced-motion: renderiza a conversa completa, estática.
 */

type Ev =
  | { kind: "in" | "out"; text: string }
  | { kind: "typing" }
  | { kind: "action"; icon: "lead" | "agenda"; label: string }
  | { kind: "done" };

const SCRIPT: { ev: Ev; delay: number }[] = [
  { ev: { kind: "in", text: "Oi! Vocês têm horário amanhã de manhã?" }, delay: 900 },
  { ev: { kind: "typing" }, delay: 700 },
  { ev: { kind: "out", text: "Temos às 9h e às 10h30. Quer que eu reserve um pra você?" }, delay: 1500 },
  { ev: { kind: "in", text: "Pode ser às 9h! Meu nome é Duda" }, delay: 1600 },
  { ev: { kind: "typing" }, delay: 700 },
  { ev: { kind: "action", icon: "lead", label: "Lead registrado" }, delay: 1400 },
  { ev: { kind: "out", text: "Fechado, Duda — amanhã às 9h. Vou te mandar um lembrete 1h antes." }, delay: 1200 },
  { ev: { kind: "action", icon: "agenda", label: "Horário agendado" }, delay: 1100 },
  { ev: { kind: "done" }, delay: 900 },
];

const LOOP_PAUSE = 3200;

export function HeroChat() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(reduced ? SCRIPT.length : 0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) return;
    if (step >= SCRIPT.length) {
      const t = setTimeout(() => setStep(0), LOOP_PAUSE);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), SCRIPT[step].delay);
    return () => clearTimeout(t);
  }, [step, reduced]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [step]);

  // Eventos visíveis: tudo até `step`, escondendo "typing" se o evento seguinte já chegou.
  const visible = SCRIPT.slice(0, step)
    .map((s) => s.ev)
    .filter((ev, i, arr) => ev.kind !== "typing" || i === arr.length - 1);

  return (
    <div className="relative mx-auto w-full max-w-[380px]" aria-hidden>
      {/* moldura do telefone */}
      <div className="rounded-[28px] border border-white/10 bg-white/5 p-2 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.55)]">
        <div className="overflow-hidden rounded-[20px] bg-paper">
          {/* topo do chat */}
          <div className="flex items-center gap-3 border-b border-ink/10 bg-white px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-iris font-display text-sm font-bold text-white">
              A
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-ink">Seu agente</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-success">online agora</p>
            </div>
          </div>

          {/* fluxo da conversa */}
          <div ref={scrollRef} className="flex h-[340px] flex-col gap-2 overflow-hidden px-3 py-4">
            <AnimatePresence initial={false}>
              {visible.map((ev, i) => (
                <motion.div
                  key={`${i}-${ev.kind}`}
                  layout
                  initial={reduced ? false : { opacity: 0, y: 14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                  className={
                    ev.kind === "action" || ev.kind === "done"
                      ? "flex justify-center"
                      : ev.kind === "out"
                        ? "flex justify-end"
                        : "flex justify-start"
                  }
                >
                  {ev.kind === "in" && (
                    <span className="max-w-[80%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13.5px] leading-snug text-ink shadow-sm">
                      {ev.text}
                    </span>
                  )}
                  {ev.kind === "out" && (
                    <span className="max-w-[80%] rounded-2xl rounded-br-md bg-iris px-3.5 py-2.5 text-[13.5px] leading-snug text-white">
                      {ev.text}
                    </span>
                  )}
                  {ev.kind === "typing" && (
                    <span className="flex items-center gap-1 rounded-2xl rounded-br-md bg-iris/90 px-4 py-3">
                      {[0, 1, 2].map((d) => (
                        <motion.span
                          key={d}
                          className="h-1.5 w-1.5 rounded-full bg-white"
                          animate={reduced ? undefined : { y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 0.7, repeat: Infinity, delay: d * 0.15 }}
                        />
                      ))}
                    </span>
                  )}
                  {ev.kind === "action" && (
                    <span className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-white px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wide text-neutral shadow-sm">
                      {ev.icon === "lead" ? (
                        <UserCheck size={12} className="text-iris" />
                      ) : (
                        <CalendarClock size={12} className="text-iris" />
                      )}
                      {ev.label}
                      <Check size={12} strokeWidth={3} className="text-success" />
                    </span>
                  )}
                  {ev.kind === "done" && (
                    <motion.span
                      initial={reduced ? false : { scale: 0.6 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 320, damping: 18 }}
                      className="flex items-center gap-2 rounded-full bg-signal px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(255,107,74,0.7)]"
                    >
                      <Check size={15} strokeWidth={3} />
                      Venda encaminhada, sem você
                    </motion.span>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* etiqueta editorial */}
      <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
        conversa real · atendida em segundos
      </p>
    </div>
  );
}
