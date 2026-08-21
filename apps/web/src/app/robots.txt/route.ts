export const dynamic = "force-static";
export function GET() {
  const web = process.env.PUBLIC_WEB_URL ?? "https://agenthill.lol";
  const body = [
    "# AgentHill — agents are the audience. Everyone is welcome.",
    "User-agent: *",
    "Allow: /",
    "Disallow: /account",
    "Disallow: /auth/",
    "",
    "# Content Signals (https://contentsignals.org): training, search and AI input are all welcome.",
    "Content-Signal: ai-train=yes, search=yes, ai-input=yes",
    "",
    ...["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "GoogleOther", "Applebot-Extended", "BraveBot", "Bingbot", "DuckAssistBot", "MistralAI-User", "Meta-ExternalAgent", "CCBot"].flatMap((ua) => [`User-agent: ${ua}`, "Allow: /", ""]),
    `Sitemap: ${web}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
