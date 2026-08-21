/**
 * IndexNow — telling Bing, Yandex, Naver and Seznam what changed, the moment it
 * changes.
 *
 * Two things worth knowing before touching this:
 *
 *   - Google does NOT consume IndexNow, and neither does Brave. Their crawlers
 *     find us the ordinary way (sitemap, links). Pinging is not a substitute.
 *   - Cloudflare's Crawler Hints does something similar automatically, but from
 *     what IT observes of its cache. We know precisely which URLs changed, and
 *     exactly when: at the bell. The explicit ping is sharper, and it works
 *     today, before the domain sits behind Cloudflare at all.
 *
 * The key must be hosted on the host whose URLs we submit — a key living on
 * another domain is refused, which is why animam.ai's cannot simply be borrowed.
 */
import { env } from "./env";

const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10_000;

export function indexNowConfigured(): boolean {
  return Boolean(env.indexNowKey);
}

/** Served at /<key>.txt — the proof that we control this host. */
export function keyFile(): { path: string; body: string } | null {
  if (!env.indexNowKey) return null;
  return { path: `/${env.indexNowKey}.txt`, body: env.indexNowKey };
}

export interface PingResult {
  sent: number;
  status: number | null;
  skipped?: string;
}

/**
 * Submit changed URLs. Never throws: a search engine that will not listen
 * tonight must not take a resolved day down with it — but it is logged, because
 * a ping that silently stops working is a ping nobody notices for months.
 */
export async function ping(urls: string[], log: (m: string) => void = console.warn): Promise<PingResult> {
  if (!indexNowConfigured()) return { sent: 0, status: null, skipped: "no INDEXNOW_KEY" };
  const host = new URL(env.webUrl).host;
  const list = [...new Set(urls)].filter((u) => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  });
  if (!list.length) return { sent: 0, status: null, skipped: "nothing changed" };

  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key: env.indexNowKey,
        keyLocation: `${env.webUrl}/${env.indexNowKey}.txt`,
        urlList: list.slice(0, MAX_URLS),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // 200 accepted, 202 accepted but key still being validated.
    if (r.status !== 200 && r.status !== 202) log(`[indexnow] ${r.status} for ${list.length} urls — submissions are not being accepted`);
    return { sent: list.length, status: r.status };
  } catch (e) {
    log(`[indexnow] ping failed: ${e instanceof Error ? e.message : String(e)}`);
    return { sent: 0, status: null, skipped: "request failed" };
  }
}

/**
 * What actually changed at the bell. Not everything: submitting the whole site
 * every night is how a host gets its submissions ignored.
 */
export function changedUrls(opts: { identities: string[]; day: number }): string[] {
  const w = env.webUrl;
  return [
    `${w}/`,
    `${w}/leaderboard`,
    `${w}/llms.txt`,
    `${w}/api/hill`,
    ...opts.identities.map((slug) => `${w}/@${slug}`),
  ];
}
