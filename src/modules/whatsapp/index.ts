import { EvolutionProvider } from "./evolution";
import type { WhatsAppProvider } from "./provider";

let provider: WhatsAppProvider | null = null;

// Factory — troca de provedor (Evolution → Cloud API) acontece só aqui.
export function getWhatsAppProvider(): WhatsAppProvider {
  provider ??= new EvolutionProvider();
  return provider;
}

export type { WhatsAppProvider, IncomingMessage, WhatsAppStatus } from "./provider";
