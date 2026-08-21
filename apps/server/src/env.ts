/**
 * Environment. In production every secret is required: the server refuses to
 * start rather than run with a fallback (contract §8.8).
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

export const env = {
  prod,
  port: Number(process.env.PORT ?? 3303),
  databaseUrl: need("DATABASE_URL"),
  webUrl: need("PUBLIC_WEB_URL", "https://agenthill.lol"),
  mcpUrl: need("PUBLIC_MCP_URL", "https://mcp.agenthill.lol"),
  oauthIssuer: need("OAUTH_ISSUER", "https://api.animam.ai"),
  oauthJwksUrl: need("OAUTH_JWKS_URL", "https://api.animam.ai/.well-known/jwks.json"),
  oauthAudience: need("OAUTH_AUDIENCE", "https://mcp.agenthill.lol"),
  stripeSecretKey: need("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: need("STRIPE_WEBHOOK_SECRET"),
  cronSecret: need("CRON_SECRET"),
  sentryDsn: process.env.SENTRY_DSN ?? "",
  /** Day 1 of the hill (UTC date, YYYY-MM-DD). */
  launchDate: need("LAUNCH_DATE", "2026-08-23"),
};
