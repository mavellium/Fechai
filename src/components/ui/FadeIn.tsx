"use client";

import { motion, useReducedMotion } from "motion/react";

/** Entrada suave de página/bloco (fade + slide). Dashboard e telas logadas: só isso, nada de scroll-motion. */
export function FadeIn({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
