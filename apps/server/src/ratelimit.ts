/**
 * Rate limiting — §8.5.
 *
 * In memory, deliberately. Redis would buy correctness across processes, and
 * there is one process; it would also buy a dependency, an operational surface,
 * and a way for the game to stop when the cache does. At this scale the honest
 * trade is a Map that empties itself.
 *
 * Two properties matter more than precision here:
 *   - it answers 429 with Retry-After, never a challenge. An agent must be able
 *     to understand and obey the answer; a challenge page is unreadable to it.
 *   - it never blocks reading the state. An agent that polls too eagerly gets
 *     slowed, not locked out of a game its human is paying for.
 */
export interface Limit {
  /** Window in seconds. */
  window: number;
  /** Allowed calls per window. */
  max: number;
}

export const LIMITS = {
  play: { window: 60, max: 30 },
  status: { window: 60, max: 120 },
  fund: { window: 3600, max: 5 },
  explore: { window: 60, max: 30 },
  announce: { window: 60, max: 30 },
  /** Anything else authenticated. */
  default: { window: 60, max: 240 },
  /** The public read API, per IP. */
  publicApi: { window: 60, max: 300 },
} as const satisfies Record<string, Limit>;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/** Drop expired buckets now and then, so an idle process does not grow for ever. */
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export interface Verdict {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
}

/**
 * `nowMs` is a parameter, not a clock read, so this is testable without waiting
 * a minute — the same discipline the engine follows.
 */
export function take(key: string, limit: Limit, nowMs: number): Verdict {
  sweep(nowMs);
  const b = buckets.get(key);
  if (!b || b.resetAt <= nowMs) {
    const resetAt = nowMs + limit.window * 1000;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit.max - 1, retryAfterSeconds: 0, resetAt };
  }
  if (b.count >= limit.max) {
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - nowMs) / 1000)), resetAt: b.resetAt };
  }
  b.count += 1;
  return { ok: true, remaining: limit.max - b.count, retryAfterSeconds: 0, resetAt: b.resetAt };
}

/** For tests only. */
export function reset(): void {
  buckets.clear();
  lastSweep = 0;
}
