import { EvolutionProvider } from "./evolution";
import { MetaCloudProvider, type MetaCloudCredentials } from "./meta";
import type { WhatsAppProvider } from "./provider";

export const WHATSAPP_PROVIDER_NAMES = ["evolution", "meta"] as const;
export type WhatsAppProviderName = (typeof WHATSAPP_PROVIDER_NAMES)[number];

let evolutionProvider: WhatsAppProvider | null = null;

export function parseWhatsAppProviderName(value: unknown): WhatsAppProviderName {
  return value === "meta" ? "meta" : "evolution";
}

// Factory. Sem argumento continua Evolution para preservar chamadas legadas e
// scripts operacionais; caminhos por tenant devem usar o provider salvo nele.
export function getWhatsAppProvider(
  name: WhatsAppProviderName = "evolution",
  credentials?: MetaCloudCredentials,
): WhatsAppProvider {
  if (name === "meta") {
    return new MetaCloudProvider(
      credentials ?? { phoneNumberId: "", accessToken: "", businessAccountId: null },
    );
  }
  evolutionProvider ??= new EvolutionProvider();
  return evolutionProvider;
}

export type { MetaCloudCredentials } from "./meta";
export type { WhatsAppProvider, IncomingMessage, WhatsAppStatus } from "./provider";
