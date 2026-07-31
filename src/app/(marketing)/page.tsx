import { LandingMotion } from "./_components/LandingMotion";
import { Hero } from "./_components/Hero";
import { Problema } from "./_components/Problema";
import { ComoFunciona } from "./_components/ComoFunciona";
import { AcoesExemplos } from "./_components/AcoesExemplos";
import { Planos } from "./_components/Planos";
import { ProvaSocial } from "./_components/ProvaSocial";
import { FAQ } from "./_components/FAQ";
import { CTAFinal } from "./_components/CTAFinal";

export default function LandingPage() {
  return (
    <LandingMotion>
      <Hero />
      <Problema />
      <ComoFunciona />
      <AcoesExemplos />
      <Planos />
      <ProvaSocial />
      <FAQ />
      <CTAFinal />
    </LandingMotion>
  );
}
