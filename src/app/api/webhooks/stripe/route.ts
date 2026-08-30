import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/modules/billing/stripe";
import { isValidPlan, setTenantPlan } from "@/modules/billing/service";
import {
  markReferralChurned,
  recordCommissionForPayment,
} from "@/modules/affiliates/service";

// Webhook do Stripe. Precisa do corpo cru (req.text) para validar a assinatura.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook não configurado" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Assinatura ausente" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "assinatura inválida";
    return NextResponse.json({ error: `Webhook inválido: ${message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        await applyPlanFromMetadata(s.metadata);
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.status === "active" || sub.status === "trialing") {
          await applyPlanFromMetadata(sub.metadata);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = sub.metadata?.tenantId;
        if (tenantId) {
          await setTenantPlan(tenantId, "FREE"); // cancelou → volta ao grátis
          // O afiliado para de ganhar pelas mensalidades futuras; o que já foi
          // ganho continua no extrato dele.
          await markReferralChurned(tenantId);
        }
        break;
      }

      /**
       * Comissão do afiliado nasce AQUI, não no checkout.
       *
       * O produto é SaaS e a comissão é recorrente: o afiliado ganha em toda
       * mensalidade paga, não só na primeira. `invoice.paid` é o único evento
       * que dispara em toda renovação — e só depois de o dinheiro entrar de
       * fato, o que evita comissionar cobrança que falhou.
       */
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        await commissionFromInvoice(invoice, event.id);
        break;
      }

      /**
       * Reembolso/estorno de uma fatura: a comissão gerada por aquele
       * pagamento é cancelada. Sem isso, o afiliado ficaria com o percentual
       * de um dinheiro que voltou para o cliente.
       *
       * A escuta é em `credit_note.created`, e não em `charge.refunded`,
       * porque só a nota de crédito diz QUAL fatura foi estornada — o Charge
       * não expõe mais a fatura de origem na API atual, e é a fatura que
       * amarra a comissão (`stripeInvoiceId`).
       */
      case "credit_note.created": {
        const note = event.data.object as Stripe.CreditNote;
        const invoiceId = typeof note.invoice === "string" ? note.invoice : note.invoice?.id;
        if (invoiceId) await cancelCommissionsForInvoice(invoiceId);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] erro ao processar", event.type, err);
    return NextResponse.json({ error: "Falha ao processar evento" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function applyPlanFromMetadata(metadata: Stripe.Metadata | null | undefined) {
  const tenantId = metadata?.tenantId;
  const planKey = metadata?.planKey;
  if (!tenantId || !planKey || !isValidPlan(planKey)) return;
  await setTenantPlan(tenantId, planKey);
}

/**
 * Comissiona uma fatura paga.
 *
 * O `tenantId`/`planKey` vem de `parent.subscription_details.metadata` — o
 * retrato imutável dos metadados da assinatura no momento em que a fatura foi
 * fechada (é lá que `createCheckoutSession` grava, via `subscription_data`).
 *
 * A base da comissão é `amount_paid`, o que a pessoa realmente pagou — não o
 * preço de tabela. Assim desconto, cupom e proporcional entram na conta certos.
 */
async function commissionFromInvoice(invoice: Stripe.Invoice, eventId: string) {
  const details =
    invoice.parent?.type === "subscription_details" ? invoice.parent.subscription_details : null;
  const metadata = details?.metadata;
  const tenantId = metadata?.tenantId;
  const planKey = metadata?.planKey;

  // Fatura avulsa (sem assinatura) ou metadados ausentes: nada a comissionar.
  if (!tenantId || !planKey || !isValidPlan(planKey)) return;
  if (invoice.amount_paid <= 0) return; // fatura de R$ 0 (trial, crédito)

  await recordCommissionForPayment({
    tenantId,
    planKey,
    amountPaidCents: invoice.amount_paid,
    stripeEventId: eventId,
    stripeInvoiceId: invoice.id,
  });
}

/** Estorno: derruba as comissões geradas pela fatura reembolsada. */
async function cancelCommissionsForInvoice(invoiceId: string) {
  await prisma.affiliateCommission.updateMany({
    where: { stripeInvoiceId: invoiceId, status: { in: ["PENDING", "APPROVED"] } },
    data: { status: "CANCELED" },
  });
}
