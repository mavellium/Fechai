"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const PERGUNTAS = [
  {
    q: "Preciso saber programar?",
    a: "Não. Todo o processo é guiado no painel: persona, base de conhecimento, ações e conexão do WhatsApp.",
  },
  {
    q: "Como o agente aprende sobre o meu negócio?",
    a: "Você sobe um documento (PDF ou texto). O agente responde com base nele usando busca semântica (RAG).",
  },
  {
    q: "Funciona com meu número atual do WhatsApp?",
    a: "Você conecta um número escaneando um QR code, como no WhatsApp Web. Recomendamos um número dedicado ao atendimento.",
  },
  {
    q: "E se o agente não souber responder?",
    a: "Você pode ativar a ação 'transferir para humano', que marca a conversa como 'precisa atenção' para você assumir.",
  },
  {
    q: "Tem plano grátis?",
    a: "Sim, com limite de conversas por mês. Dá para testar o produto inteiro antes de assinar.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="bg-paper px-4 py-20">
      <div className="mx-auto max-w-3xl">
        <h2 className="reveal font-display text-center text-3xl font-bold tracking-tight text-ink">
          Perguntas frequentes
        </h2>
        <div className="mt-10 space-y-3">
          {PERGUNTAS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className="rounded-xl border border-neutral/20 bg-white">
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                >
                  <span className="font-medium text-ink">{item.q}</span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-neutral transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-4 text-sm text-neutral">{item.a}</p>
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
