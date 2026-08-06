import type { Metadata } from "next";
import { LandingMotion } from "./_components/LandingMotion";
import { Hero } from "./_components/Hero";
import { Problema } from "./_components/Problema";
import { OQueE } from "./_components/OQueE";
import { ComoFunciona } from "./_components/ComoFunciona";
import { AcoesExemplos } from "./_components/AcoesExemplos";
import { Planos } from "./_components/Planos";
import { ProvaSocial } from "./_components/ProvaSocial";
import { FAQ } from "./_components/FAQ";
import { CTAFinal } from "./_components/CTAFinal";
import { PERGUNTAS, PASSOS } from "./_components/content";
import { FaqJsonLd, HowToJsonLd } from "@/components/seo/JsonLd";

export const metadata: Metadata = {
  // `absolute` ignora o template "%s · fechai" do root layout — sem ele o
  // title da home sairia "…WhatsApp · fechai", repetindo a marca duas vezes.
  title: {
    absolute: "fechai — agente de IA que atende e vende pelo seu WhatsApp",
  },
  description:
    "O fechai coloca um agente de IA para atender, qualificar e agendar pelo WhatsApp do seu negócio 24h por dia. Você define a persona e o que ele sabe — sem programar. Plano grátis, sem cartão.",
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return (
    <>
      <FaqJsonLd items={PERGUNTAS} />
      <HowToJsonLd steps={PASSOS} />
      <LandingMotion>
        <Hero />
        <Problema />
        <OQueE />
        <ComoFunciona />
        <AcoesExemplos />
        <Planos />
        <ProvaSocial />
        <FAQ />
        <CTAFinal />
      </LandingMotion>
    </>
  );
}
