import Stripe from "stripe";

// Cliente Stripe (modo teste no MVP). Instanciado sob demanda para não quebrar
// o build/boot quando a chave ainda não está configurada.
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY não configurada");
  cached ??= new Stripe(key);
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
