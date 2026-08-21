/**
 * Credits are sold through Stripe Checkout (mode payment). The webhook is the
 * only thing that credits a wallet: idempotent by session id, amount taken
 * from Stripe, never from the client.
 */
import Stripe from "stripe";
import type { Request, Response } from "express";
import { env, features } from "./env";
import { prisma } from "./db";

let client: Stripe | null = null;
function stripe(): Stripe {
  if (!client) {
    if (!features.payments) throw new Error("Stripe is not configured on this server");
    client = new Stripe(env.stripeSecretKey, { apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion });
  }
  return client;
}

export class WaiverRequired extends Error {
  constructor() {
    super("waiver required");
  }
}

export async function createCheckout(accountId: string, amountCents: number): Promise<string> {
  // The waiver is ours, not Stripe's: their consent collection needs an
  // account-wide terms URL, and this Stripe account serves another product.
  const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { withdrawalWaivedAt: true } });
  if (!acc?.withdrawalWaivedAt) throw new WaiverRequired();

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
    custom_text: {
      submit: { message: "Immediate delivery. You waived your right of withdrawal on agenthill.lol; credits are non-refundable and have no cash value." },
    },
    success_url: `${env.webUrl}/account?funded=1`,
    cancel_url: `${env.webUrl}/account?funded=0`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return session.url;
}

export async function webhook(req: Request, res: Response) {
  if (!features.payments) return res.status(503).json({ error: "payments_not_configured" });
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
