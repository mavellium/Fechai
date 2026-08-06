import { PLANS } from "@/modules/billing/plans";
import {
  ORGANIZATION,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  SOCIAL_PROFILES,
  absoluteUrl,
} from "@/lib/seo";

/**
 * Dados estruturados (schema.org / JSON-LD).
 *
 * Dois papéis distintos:
 *  - SEO: habilita rich results e ensina ao Google que "fechai" é uma ENTIDADE
 *    (Organization + SoftwareApplication), não uma palavra solta. É isso que
 *    separa ranquear pela marca de competir com resultados aleatórios.
 *  - GEO: LLMs leem JSON-LD com prioridade porque já vem desambiguado — é a
 *    forma mais barata de um motor de resposta acertar preço, plano e o que o
 *    produto faz sem alucinar.
 *
 * O grafo é único (`@graph`) e os nós se referenciam por @id, em vez de três
 * blocos soltos repetindo os mesmos dados.
 */

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#software`;

type FaqItem = { q: string; a: string };

/** Renderiza um bloco JSON-LD. `dangerouslySetInnerHTML` é a forma suportada
 *  de injetar `application/ld+json` — o conteúdo é nosso, não vem do usuário. */
function LdScript({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // A serialização escapa `<` para evitar quebra da tag em qualquer string.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

/** Organization + WebSite + SoftwareApplication. Vai no layout de marketing. */
export function OrganizationJsonLd() {
  const graph = [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: ORGANIZATION.name,
      legalName: ORGANIZATION.legalName,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      email: ORGANIZATION.email,
      foundingDate: ORGANIZATION.foundingDate,
      logo: {
        "@type": "ImageObject",
        // A rota gerada por src/app/icon.tsx é "/icon" (sem extensão).
        url: absoluteUrl("/icon"),
        width: 512,
        height: 512,
      },
      image: absoluteUrl("/opengraph-image"),
      sameAs: SOCIAL_PROFILES,
      areaServed: { "@type": "Country", name: "Brasil" },
      knowsLanguage: ORGANIZATION.language,
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: ORGANIZATION.email,
        availableLanguage: ["Portuguese"],
        areaServed: "BR",
      },
    },
    {
      "@type": "WebSite",
      "@id": SITE_ID,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      publisher: { "@id": ORG_ID },
      inLanguage: ORGANIZATION.language,
    },
    {
      "@type": "SoftwareApplication",
      "@id": APP_ID,
      name: SITE_NAME,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Atendimento e vendas por WhatsApp com IA",
      operatingSystem: "Web",
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      inLanguage: ORGANIZATION.language,
      publisher: { "@id": ORG_ID },
      featureList: [
        "Agente de IA que responde no WhatsApp 24 horas por dia",
        "Base de conhecimento própria por PDF ou texto (RAG)",
        "Qualificação automática de leads",
        "Agendamento integrado ao Google Calendar",
        "Follow-up automático de conversas paradas",
        "Transferência para atendimento humano",
        "Widget de chat para site",
        "Painel com todas as conversas e relatórios",
      ],
      // Ofertas reais, derivadas da fonte única de planos.
      offers: PLANS.map((plan) => ({
        "@type": "Offer",
        name: `Plano ${plan.name}`,
        price: (plan.priceCents / 100).toFixed(2),
        priceCurrency: "BRL",
        category: plan.priceCents === 0 ? "free" : "subscription",
        url: absoluteUrl("/#planos"),
        availability: "https://schema.org/InStock",
        ...(plan.priceCents > 0 && {
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: (plan.priceCents / 100).toFixed(2),
            priceCurrency: "BRL",
            billingDuration: 1,
            billingIncrement: 1,
            unitCode: "MON",
          },
        }),
      })),
    },
  ];

  return <LdScript data={{ "@context": "https://schema.org", "@graph": graph }} />;
}

/** FAQPage — alimenta o rich result de perguntas e é muito citado por LLMs. */
export function FaqJsonLd({ items }: { items: readonly FaqItem[] }) {
  return (
    <LdScript
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        inLanguage: ORGANIZATION.language,
        isPartOf: { "@id": SITE_ID },
        mainEntity: items.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      }}
    />
  );
}

/** HowTo — os 4 passos de "Como funciona". Ganha espaço em AI Overviews. */
export function HowToJsonLd({
  steps,
}: {
  steps: readonly { n: string; title: string; desc: string }[];
}) {
  return (
    <LdScript
      data={{
        "@context": "https://schema.org",
        "@type": "HowTo",
        "@id": `${SITE_URL}/#howto`,
        name: "Como colocar um agente de IA para atender no WhatsApp com o fechai",
        description:
          "Quatro passos para configurar o agente de IA do fechai e começar a atender, qualificar e agendar pelo WhatsApp automaticamente.",
        inLanguage: ORGANIZATION.language,
        totalTime: "PT15M",
        estimatedCost: { "@type": "MonetaryAmount", currency: "BRL", value: "0" },
        step: steps.map((step, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          name: step.title,
          text: step.desc,
          url: absoluteUrl(`/#como-funciona`),
        })),
      }}
    />
  );
}

/** Breadcrumb. Melhora como a URL aparece no resultado de busca. */
export function BreadcrumbJsonLd({
  items,
}: {
  items: readonly { name: string; path: string }[];
}) {
  return (
    <LdScript
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: item.name,
          item: absoluteUrl(item.path),
        })),
      }}
    />
  );
}
