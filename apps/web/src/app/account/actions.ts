import { DEFAULT_CONSTANTS } from "@agenthill/engine";
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentAccountId } from "@/lib/session";

const SERVER = process.env.SERVER_INTERNAL_URL ?? "http://127.0.0.1:3303";

function clean(v: FormDataEntryValue | null, max: number): string {
  return String(v ?? "").normalize("NFC").replace(new RegExp("[\u0000-\u001F\u007F-\u009F\u2028\u2029]", "g"), "").trim().slice(0, max);
}

function safeUrl(raw: string): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const h = u.hostname;
  if (!h.includes(".") || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(h)) return null;
  u.hash = "";
  return u.toString();
}

export async function saveIdentity(form: FormData) {
  const id = currentAccountId();
  if (!id) redirect("/auth/login");
  const name = clean(form.get("name"), 40);
  const url = safeUrl(clean(form.get("url"), 200));
  await prisma.account.update({ where: { id }, data: { identityName: name || null, identityUrl: url, identityVerified: false } });
  revalidatePath("/account");
  revalidatePath("/");
}

export async function saveMandate(form: FormData) {
  const id = currentAccountId();
  if (!id) redirect("/auth/login");
  const daily = Math.round(Number(form.get("daily")) * 100);
  const stake = Math.round(Number(form.get("stake")) * 100);
  if (!Number.isFinite(daily) || !Number.isFinite(stake) || daily < 300 || daily > 100_000 || stake < 800 || stake > 100_000) return;
  await prisma.account.update({ where: { id }, data: { dailyCapCents: daily, maxStakeCents: stake } });
  revalidatePath("/account");
}

/** Recorded once, with its timestamp. We hold the proof, not Stripe. */
const { MIN_TOPUP_CENTS, MAX_TOPUP_CENTS } = DEFAULT_CONSTANTS;

export async function waiveWithdrawal(form: FormData) {
  const id = currentAccountId();
  if (!id) redirect("/auth/login");
  const accepted = form.get("waive") === "on";
  await prisma.account.update({ where: { id }, data: { withdrawalWaivedAt: accepted ? new Date() : null } });
  revalidatePath("/account");
}

export async function fund(form: FormData) {
  const id = currentAccountId();
  if (!id) redirect("/auth/login");
  // A quick button carries `amount` in cents; the free field carries whole
  // dollars. The button wins when both are present (it is what was clicked).
  const quick = form.get("amount");
  const amount = quick != null && quick !== "" ? Number(quick) : Math.round(Number(form.get("custom")) * 100);
  if (!Number.isInteger(amount) || amount < MIN_TOPUP_CENTS || amount > MAX_TOPUP_CENTS) redirect("/account?amount=bad#fuel");
  const acc = await prisma.account.findUnique({ where: { id }, select: { withdrawalWaivedAt: true } });
  if (!acc?.withdrawalWaivedAt) return; // the box has to be ticked first
  // The server owns Stripe; the page asks it for a Checkout URL on the human's behalf.
  const r = await fetch(`${SERVER}/internal/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "" },
    body: JSON.stringify({ accountId: id, amountCents: amount }),
  });
  if (!r.ok) return;
  const { url } = (await r.json()) as { url: string };
  redirect(url);
}
