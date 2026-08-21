/**
 * The human's session on the page: an HMAC-signed cookie carrying the account
 * id (the AS `sub`). Seven days. No PII in the cookie.
 */
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const NAME = "agenthill_session";
const secret = () => {
  const s = process.env.SESSION_SECRET ?? "";
  if (!s && process.env.NODE_ENV === "production") throw new Error("Missing SESSION_SECRET");
  return s || "dev-secret";
};

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function sessionCookie(accountId: string): { name: string; value: string; options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: string; maxAge: number } } {
  const exp = Date.now() + 7 * 86_400_000;
  const payload = Buffer.from(JSON.stringify({ a: accountId, e: exp })).toString("base64url");
  return { name: NAME, value: `${payload}.${sign(payload)}`, options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 7 * 86_400 } };
}

export function currentAccountId(): string | null {
  const raw = cookies().get(NAME)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { a: string; e: number };
    if (typeof a !== "string" || typeof e !== "number" || e < Date.now()) return null;
    return a;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = NAME;
