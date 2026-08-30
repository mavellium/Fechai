"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PERGUNTAS_AFILIADOS } from "./perguntas";

export function FAQAfiliados() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section
      id="faq-afiliados"
      className="border-t border-ink/10 bg-paper px-4 py-20 md:py-28"
      aria-labelledby="faq-afiliados-titulo"
    >
      <div className="mx-auto max-w-3xl">
        <h2
          id="faq-afiliados-titulo"
          className="reveal font-display text-center text-3xl font-bold tracking-tight text-ink sm:text-4xl"
        >
          Perguntas frequentes
        </h2>
        <div className="mt-10 space-y-3">
          {PERGUNTAS_AFILIADOS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className="rounded-xl border border-neutral/20 bg-white">
                <h3>
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-af-resposta-${i}`}
                    id={`faq-af-pergunta-${i}`}
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
                      id={`faq-af-resposta-${i}`}
                      role="region"
                      aria-labelledby={`faq-af-pergunta-${i}`}
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
