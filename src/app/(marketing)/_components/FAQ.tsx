"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PERGUNTAS } from "./content";

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="bg-paper px-4 py-20" aria-labelledby="faq-titulo">
      <div className="mx-auto max-w-3xl">
        <h2
          id="faq-titulo"
          className="reveal font-display text-center text-3xl font-bold tracking-tight text-ink"
        >
          Perguntas frequentes sobre o fechai
        </h2>
        <div className="mt-10 space-y-3">
          {PERGUNTAS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className="rounded-xl border border-neutral/20 bg-white">
                <h3>
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-resposta-${i}`}
                    id={`faq-pergunta-${i}`}
                    className="flex w-full items-center justify-between gap-4 rounded-xl px-5 py-4 text-left font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-iris"
                  >
                    {item.q}
                    <ChevronDown
                      size={18}
                      aria-hidden
                      className={`shrink-0 text-neutral transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                      id={`faq-resposta-${i}`}
                      role="region"
                      aria-labelledby={`faq-pergunta-${i}`}
                    >
                      <p className="px-5 pb-4 leading-relaxed text-neutral">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
