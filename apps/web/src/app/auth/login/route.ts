import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { authorizeUrl, pkce, SignInUnavailable } from "@/lib/oauth";

// Never prerender: this route registers the OAuth client (database + network).
export const dynamic = "force-dynamic";

export async function GET() {
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkce();
  let target: string;
  try {
    target = await authorizeUrl(state, challenge);
  } catch (e) {
    // A sign-in that cannot start must say so in words, not render a 500.
    const why = e instanceof SignInUnavailable ? e.reason : "sign-in is temporarily unavailable";
    console.error("[auth] cannot start sign-in:", why);
    return new NextResponse(
      `Sign-in is temporarily unavailable — ${why}. Nothing is wrong with your account; try again in a few minutes.`,
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "300" } },
    );
  }
  const res = NextResponse.redirect(target);
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
  res.cookies.set("ah_state", state, opts);
  res.cookies.set("ah_verifier", verifier, opts);
  return res;
}
