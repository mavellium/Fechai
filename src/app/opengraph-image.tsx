import { ImageResponse } from "next/og";

/**
 * Imagem de compartilhamento (Open Graph / Twitter), gerada no build.
 *
 * Vale para SEO indiretamente: link com card visual tem CTR muito maior no
 * WhatsApp/LinkedIn, e tráfego + engajamento realimentam o ranqueamento.
 * Usa as cores da marca direto (ink/signal) — o runtime de OG não enxerga o
 * Tailwind nem as CSS custom properties do @theme.
 */

export const alt = "fechai — agente de IA que atende e vende pelo seu WhatsApp";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#14171F",
          padding: "72px",
        }}
      >
        {/* brilho de marca no canto */}
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -140,
            width: 560,
            height: 560,
            borderRadius: 9999,
            background: "#4B3CF0",
            opacity: 0.35,
            filter: "blur(140px)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#FF6B4A" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          {/* Satori exige display explícito em qualquer div com >1 filho. */}
          <div
            style={{
              display: "flex",
              fontSize: 34,
              fontWeight: 700,
              color: "white",
              letterSpacing: "-0.02em",
            }}
          >
            fechai<span style={{ color: "#FF6B4A" }}>.</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 82,
              fontWeight: 700,
              color: "white",
              lineHeight: 1.04,
              letterSpacing: "-0.035em",
              maxWidth: 940,
            }}
          >
            <span>Enquanto você dorme,</span>
            <span style={{ display: "flex" }}>
              ele&nbsp;<span style={{ color: "#FF6B4A" }}>vende</span>.
            </span>
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 30,
              color: "rgba(255,255,255,0.62)",
              maxWidth: 860,
              lineHeight: 1.4,
            }}
          >
            Agente de IA que atende, qualifica e agenda pelo WhatsApp do seu negócio — 24h por dia.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 22,
            color: "rgba(255,255,255,0.45)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          fechai · comece grátis, sem cartão
        </div>
      </div>
    ),
    size,
  );
}
