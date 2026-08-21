import { describe, it, expect, beforeEach } from "vitest";
import { take, reset, LIMITS } from "./ratelimit";

describe("rate limiting", () => {
  beforeEach(reset);

  it("allows up to the limit, then refuses with a usable Retry-After", () => {
    const l = { window: 60, max: 3 };
    const t = 1_000_000;
    expect(take("a", l, t).ok).toBe(true);
    expect(take("a", l, t).ok).toBe(true);
    const third = take("a", l, t);
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = take("a", l, t);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
    expect(fourth.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("opens a fresh window once the old one has passed", () => {
    const l = { window: 60, max: 1 };
    expect(take("b", l, 0).ok).toBe(true);
    expect(take("b", l, 30_000).ok).toBe(false);
    expect(take("b", l, 60_001).ok).toBe(true);
  });

  it("keys are independent — one noisy agent never blocks another", () => {
    const l = { window: 60, max: 1 };
    expect(take("agent-1", l, 0).ok).toBe(true);
    expect(take("agent-1", l, 0).ok).toBe(false);
    expect(take("agent-2", l, 0).ok).toBe(true);
  });

  it("reading the hill is far more permissive than spending money", () => {
    expect(LIMITS.status.max).toBeGreaterThan(LIMITS.play.max);
    expect(LIMITS.fund.max).toBeLessThan(LIMITS.play.max);
    expect(LIMITS.fund.window).toBe(3600);
  });
});
