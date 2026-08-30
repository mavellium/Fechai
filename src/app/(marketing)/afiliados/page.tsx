import type { Metadata } from "next";
import { LandingMotion } from "../_components/LandingMotion";
import { HeroAfiliados } from "./_components/HeroAfiliados";
import { ComoFuncionaAfiliados } from "./_components/ComoFuncionaAfiliados";
import { Niveis } from "./_components/Niveis";
import { Calculadora } from "./_components/Calculadora";
import { ParaQuem } from "./_components/ParaQuem";
import { FAQAfiliados } from "./_components/FAQAfiliados";
import { PERGUNTAS_AFILIADOS } from "./_components/perguntas";
import { CTAAfiliados } from "./_components/CTAAfiliados";
import { FaqJsonLd, BreadcrumbJsonLd } from "@/components/seo/JsonLd";

export const metadata: Metadata = {
  title: "Programa de afiliados",
  description:
    "Ganhe de 5% a 20% de comissão recorrente indicando o fechai — o percentual sobe conforme suas vendas. Você recebe todo mês enquanto o cliente indicado mantiver a assinatura. Sem custo para entrar e sem meta mínima.",
  alternates: { canonical: "/afiliados" },
  openGraph: {
    title: "Programa de afiliados do fechai",
    description:
      "Comissão recorrente de 5% a 20% por cada assinatura indicada — todo mês, enquanto o cliente continuar pagando.",
    url: "/afiliados",
  },
};

export default function AfiliadosPage() {
  return (
    <>
      <FaqJsonLd items={PERGUNTAS_AFILIADOS} />
      <BreadcrumbJsonLd
        items={[
          { name: "Início", path: "/" },
          { name: "Programa de afiliados", path: "/afiliados" },
        ]}
      />
      <LandingMotion>
        <HeroAfiliados />
        <ComoFuncionaAfiliados />
        <Niveis />
        <Calculadora />
        <ParaQuem />
        <FAQAfiliados />
        <CTAAfiliados />
      </LandingMotion>
    </>
  );
}
