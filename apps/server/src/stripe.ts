/**
 * Credits are sold through Stripe Checkout (mode payment). The webhook is the
 * only thing that credits a wallet: idempotent by session id, amount taken
 * from Stripe, never from the client.
 */
import Stripe from "stripe";
import type { Request, Response } from "express";
import { env } from "./env";
import { prisma } from "./db";

let client: Stripe | null = null;
function stripe(): Stripe {
  if (!client) {
    if (!env.stripeSecretKey) throw new Error("Stripe is not configured");
    client = new Stripe(env.stripeSecretKey, { apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion });
  }
  return client;
}

export async function createCheckout(accountId: string, amountCents: number): Promise<string> {
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: { name: `AgentHill credits — $${(amountCents / 100).toFixed(0)}`, description: "Prepaid game credits. Spendable only on agenthill.lol, non-refundable, no cash value." },
        },
      },
    ],
    metadata: { accountId },
    client_reference_id: accountId,
    automatic_tax: { enabled: true },
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: { message: "I ask for immediate delivery of these digital credits and acknowledge that I lose my right of withdrawal once they are delivered. Credits are non-refundable and have no cash value." },
    },
    success_url: `${env.webUrl}/account?funded=1`,
    cancel_url: `${env.webUrl}/account?funded=0`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return session.url;
}

export async function webhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") return res.status(400).send("missing signature");
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(req.body as Buffer, sig, env.stripeWebhookSecret);
  } catch {
    return res.status(400).send("bad signature");
  }
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const accountId = s.metadata?.["accountId"] ?? s.client_reference_id;
    const cents = s.amount_total ?? 0;
    if (accountId && cents > 0 && s.payment_status === "paid") {
      // idempotent: the unique stripeSessionId refuses a replay
      await prisma.credit.upsert({
        where: { stripeSessionId: s.id },
        create: { accountId, source: "purchase", cents, stripeSessionId: s.id, reason: "stripe_checkout" },
        update: {},
      });
    }
  }
  return res.json({ received: true });
}
