/**
 * Environment.
 *
 * Two tiers, deliberately:
 *   - what the game needs to RUN (database, OAuth, secrets) is required in
 *     production: the server refuses to start rather than run on a fallback.
 *   - what a FEATURE needs (Stripe, Resend, Sentry) is optional at boot and
 *     checked at the point of use. A hill that cannot sell credits tonight
 *     should still resolve its bell and serve its page; and "payments are not
 *     configured" said at the call site is worth more than a dead server.
 */
const prod = process.env.NODE_ENV === "production";

function need(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    if (prod) throw new Error(`Missing required env ${name}`);
    return "";
  }
  return v;
}

const optional = (name: string): string => process.env[name] ?? "";

export const env = {
  prod,
  port: Number(process.env.PORT ?? 3303),
  databaseUrl: need("DATABASE_URL"),
  webUrl: need("PUBLIC_WEB_URL", "https://agenthill.lol"),
  mcpUrl: need("PUBLIC_MCP_URL", "https://mcp.agenthill.lol"),
  oauthIssuer: need("OAUTH_ISSUER", "https://api.animam.ai"),
  oauthJwksUrl: need("OAUTH_JWKS_URL", "https://api.animam.ai/.well-known/jwks.json"),
  oauthAudience: need("OAUTH_AUDIENCE", "https://mcp.agenthill.lol"),
  cronSecret: need("CRON_SECRET"),
  /** Optional at boot, required at use — see `features` below. */
  stripeSecretKey: optional("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: optional("STRIPE_WEBHOOK_SECRET"),
  resendApiKey: optional("RESEND_API_KEY"),
  /** Browser Rendering: exploration fetches run on Cloudflare, never from this VPS. */
  cfAccountId: optional("CLOUDFLARE_ACCOUNT_ID"),
  cfApiToken: process.env.CLOUDFLARE_BROWSER_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "",
  emailFrom: process.env.EMAIL_FROM ?? "The Bell <bell@agenthill.lol>",
  sentryDsn: optional("SENTRY_DSN"),
  /** Day 1 of the hill (UTC date, YYYY-MM-DD). */
  launchDate: need("LAUNCH_DATE", "2026-08-23"),
};

export const features = {
  payments: Boolean(env.stripeSecretKey && env.stripeWebhookSecret),
  email: Boolean(env.resendApiKey),
  exploration: Boolean(env.cfAccountId && env.cfApiToken),
};

/** Say it once, loudly, at boot — a silent missing feature is how you discover
 *  in a week that nobody could ever pay. */
export function reportFeatures(log: (m: string) => void): void {
  if (!features.payments) log("[agenthill] payments DISABLED — STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing. fund() will refuse.");
  if (!features.email) log("[agenthill] email DISABLED — RESEND_API_KEY missing. Nothing will be sent.");
  if (!features.exploration) log("[agenthill] exploration DISABLED — CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing. explore_and_debrief will say so.");
}
