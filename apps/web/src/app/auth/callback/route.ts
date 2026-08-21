import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/oauth";
import { sessionCookie } from "@/lib/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const web = process.env.PUBLIC_WEB_URL ?? "https://agenthill.lol";
  if (err) return NextResponse.redirect(`${web}/?auth=${encodeURIComponent(err)}`);
  const expected = req.cookies.get("ah_state")?.value;
  const verifier = req.cookies.get("ah_verifier")?.value;
  if (!code || !state || !expected || !verifier || state !== expected) return NextResponse.redirect(`${web}/?auth=state`);
  try {
    const who = await exchangeCode(code, verifier);
    await prisma.account.upsert({
      where: { id: who.accountId },
      create: { id: who.accountId, slug: who.slug ?? null, email: who.email ?? null },
      update: { ...(who.slug ? { slug: who.slug } : {}), ...(who.email ? { email: who.email } : {}) },
    });
    const c = sessionCookie(who.accountId);
    const res = NextResponse.redirect(`${web}/account`);
    res.cookies.set(c.name, c.value, c.options);
    res.cookies.delete("ah_state");
    res.cookies.delete("ah_verifier");
    return res;
  } catch (e) {
    console.error("[auth] callback failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(`${web}/?auth=failed`);
  }
}
