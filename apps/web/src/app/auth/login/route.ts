import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { authorizeUrl, pkce } from "@/lib/oauth";

// Never prerender: this route registers the OAuth client (database + network).
export const dynamic = "force-dynamic";

export async function GET() {
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkce();
  const res = NextResponse.redirect(await authorizeUrl(state, challenge));
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
  res.cookies.set("ah_state", state, opts);
  res.cookies.set("ah_verifier", verifier, opts);
  return res;
}
