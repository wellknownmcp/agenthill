import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = NextResponse.redirect(process.env.PUBLIC_WEB_URL ?? "https://agenthill.lol");
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
