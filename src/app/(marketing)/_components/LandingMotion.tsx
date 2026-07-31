"use client";

import { useEffect, useRef } from "react";

/**
 * Reveals de scroll da landing — IntersectionObserver + CSS puro.
 * (Lenis/GSAP foram removidos: o smooth scroll do Lenis travava a rolagem
 * quando a altura da página mudava, ex. accordion do FAQ.)
 * Rolagem 100% nativa. Com prefers-reduced-motion, nada é ativado.
 */
export function LandingMotion({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    el.dataset.animate = "on"; // ativa o estado inicial oculto só quando o JS roda

    const observer = new IntersectionObserver(
      (entries) => {
        // Stagger: elementos que entram juntos revelam em cascata (70ms entre eles).
        const entering = entries.filter((e) => e.isIntersecting);
        entering.forEach((entry, i) => {
          const el = entry.target as HTMLElement;
          el.style.transitionDelay = `${i * 70}ms`;
          el.classList.add("is-revealed");
          observer.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -12% 0px" },
    );

    el.querySelectorAll(".reveal").forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);

  return <div ref={root}>{children}</div>;
}
