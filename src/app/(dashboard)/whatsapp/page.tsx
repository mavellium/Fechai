import { redirect } from "next/navigation";

// A tela de WhatsApp virou a tela de Integrações (`/integracoes`) — o WhatsApp
// é um dos canais lá. Redireciona quem ainda usa o link antigo.
export default function WhatsappRedirectPage() {
  redirect("/integracoes");
}
