"use client";

import { motion, useScroll, useSpring, useReducedMotion } from "motion/react";

/** Barra de progresso de leitura no topo da landing (scroll nativo, Motion só observa). */
export function ScrollProgress() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 180, damping: 28, restDelta: 0.001 });

  if (reduced) return null;
  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-signal"
      style={{ scaleX }}
    />
  );
}
