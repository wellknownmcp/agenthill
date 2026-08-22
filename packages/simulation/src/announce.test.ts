/**
 * The announcement channel, as a balancing instrument.
 *
 * These tests do not check that the channel is FAIR — it is not meant to be,
 * and the runs show it is not. They check that the instrument measures what it
 * claims to measure, because every conclusion drawn from it (and one of them is
 * "the benefit of the doubt is the entire value of lying") is worthless if the
 * two worlds it compares differ by anything other than the channel.
 */
import { describe, it, expect } from "vitest";
import { beliefIn, settle, truthCounts, type SettledAnnouncement } from "./announce";
import { DEFAULT_MIX, simulate, type SimConfig } from "./simulate";

const CHANNEL = { windowDays: 30, priorBelief: 0.5 };
const base = (extra: Partial<SimConfig> = {}): SimConfig => ({
  days: 40,
  seed: 5,
  budgetCents: 10_000,
  mix: DEFAULT_MIX,
  arrivals: { perDay: 0.6, budgetCents: 2000 },
  ego: { cents: 2000, holding: 0.85, contender: 0.5, baseline: 0.12, leaderboardTopN: 20, quitAfterDryDays: 14 },
  ...extra,
});

describe("scoring what was said against what was played", () => {
  it("a kept word and a broken one are told apart, per place", () => {
    const said = [
      { day: 3, slot: 1, accountId: "a", move: "PEACE" as const },
      { day: 3, slot: 2, accountId: "b", move: "WAR" as const },
      { day: 3, slot: 3, accountId: "c", move: "WAR" as const },
      { day: 3, slot: 4, accountId: "d", move: "PEACE" as const },
    ];
    const played = [
      { accountId: "a", slot: 1, move: "PEACE" as const },
      { accountId: "b", slot: 2, move: "WAR" as const },
      { accountId: "c", slot: 3, move: "PEACE" as const },
      // d deposited nothing
    ];
    expect(settle(said, played, 3).map((s) => s.verdict)).toEqual(["kept", "kept", "bluffed", "ghosted"]);
  });

  it("a promise kept on another place is not kept: the place is part of the sentence", () => {
    const said = [{ day: 1, slot: 1, accountId: "a", move: "WAR" as const }];
    const played = [{ accountId: "a", slot: 7, move: "WAR" as const }];
    expect(settle(said, played, 1)[0]!.verdict).toBe("bluffed");
  });
});

describe("what an opponent's word is worth", () => {
  const record: SettledAnnouncement[] = [
    { day: 1, accountId: "liar", verdict: "bluffed" },
    { day: 2, accountId: "liar", verdict: "bluffed" },
    { day: 1, accountId: "honest", verdict: "kept" },
    { day: 2, accountId: "honest", verdict: "kept" },
    { day: 40, accountId: "reformed", verdict: "kept" },
    { day: 1, accountId: "reformed", verdict: "betrayed" },
  ];

  it("an account nobody has anything on gets exactly the prior — no more, no less", () => {
    expect(beliefIn(record, "brand-new", 50, 30, 0.5)).toBe(0.5);
    expect(beliefIn(record, "brand-new", 50, 30, 0)).toBe(0);
  });

  it("a proven liar is worth nothing, whatever the prior", () => {
    expect(beliefIn(record, "liar", 2, 30, 0.9)).toBe(0);
    expect(beliefIn(record, "honest", 2, 30, 0)).toBe(1);
  });

  it("the window forgets, which is why a rotated identity is the same as a clean one", () => {
    // At day 50 the old betrayal has scrolled out of a 30-day window.
    expect(beliefIn(record, "reformed", 50, 30, 0.5)).toBe(1);
    expect(truthCounts(record, "reformed", 50, 30).announced).toBe(1);
    // ...and an account with nothing left in the window is back to the prior.
    expect(beliefIn(record, "liar", 50, 30, 0.5)).toBe(0.5);
  });
});

describe("the channel as a controlled experiment", () => {
  it("turning it on changes the channel and nothing else: same cohort, same identities", () => {
    const silent = simulate(base());
    const talking = simulate(base({ announcements: CHANNEL }));
    expect(talking.agents.map((a) => a.accountId)).toEqual(silent.agents.map((a) => a.accountId));
    expect(talking.totals.identities).toBe(silent.totals.identities);
    expect(talking.byStrategy.map((s) => s.agents)).toEqual(silent.byStrategy.map((s) => s.agents));
  });

  it("silent means silent: nothing said, nothing scored, nothing deterred", () => {
    const r = simulate(base());
    expect(r.settled).toHaveLength(0);
    expect(r.totals.announced).toBe(0);
    expect(r.totals.deterred).toBe(0);
  });

  it("words act through deterrence or not at all: a room where nobody threatens plays exactly like a silent one", () => {
    // Doves announce, and a dove only ever announces PEACE; scouts and
    // opportunists say nothing. So no threat is ever uttered, and if enabling
    // the channel could reach the resolution by any other path — a stray draw
    // from a shared generator, an announcement leaking into a decision — these
    // two ledgers would differ.
    const peaceful = { dove: 10, hawk: 0, tit_for_tat: 0, scout: 6, opportunist: 4, bluffer: 0 };
    const talking = simulate(base({ mix: peaceful, announcements: CHANNEL }));
    const silent = simulate(base({ mix: peaceful }));
    expect(talking.totals.announced).toBeGreaterThan(0); // everyone was talking
    expect(talking.totals.deterred).toBe(0); // nobody threatened
    expect(talking.ledger).toEqual(silent.ledger);
    expect(talking.points).toEqual(silent.points);
  });

  it("arrivals follow the declared mix — a strategy set to zero never walks in", () => {
    const r = simulate(base({ mix: { dove: 10, hawk: 0, tit_for_tat: 0, scout: 5, opportunist: 0, bluffer: 0 } }));
    expect(r.totals.arrived).toBeGreaterThan(10);
    expect(r.agents.some((a) => a.strategy === "hawk")).toBe(false);
    const doves = r.agents.filter((a) => a.strategy === "dove").length;
    const scouts = r.agents.filter((a) => a.strategy === "scout").length;
    expect(doves).toBeGreaterThan(scouts); // 10 : 5, not 1 : 1
  });

  it("a bluffer never keeps its word, and its move-reputation stays spotless anyway", () => {
    const r = simulate(base({ announcements: CHANNEL }));
    const b = r.byStrategy.find((s) => s.strategy === "bluffer")!;
    expect(b.announced).toBeGreaterThan(0);
    expect(b.kept).toBe(0);
    expect(b.bluffed).toBe(b.announced);
    // It only ever DEPOSITS peace — the war record that the queue reads is clean.
    expect(b.burnedCents).toBe(0);
  });

  it("a liar nobody believes moves nothing: with the prior at zero, a room of bluffers plays like a silent one", () => {
    // The only speakers here are bluffers. An empty record is worth `prior`, and
    // after their first night their record is worth 0 — so at prior 0 no
    // sentence they utter is ever credible enough to displace a single move.
    // This is the measurement of `docs/sim-announcements-*.md` in its exact
    // form: what a lie is worth is exactly the benefit of the doubt it is given.
    const liars = { dove: 0, hawk: 0, tit_for_tat: 0, scout: 6, opportunist: 4, bluffer: 6 };
    const cheap = simulate(base({ mix: liars, announcements: { windowDays: 30, priorBelief: 0 } }));
    const silent = simulate(base({ mix: liars }));
    expect(cheap.totals.announced).toBeGreaterThan(0);
    expect(cheap.totals.deterred).toBe(0);
    expect(cheap.ledger).toEqual(silent.ledger);
    expect(cheap.points).toEqual(silent.points);

    // Give the same liars the benefit of the doubt and the room changes.
    const believed = simulate(base({ mix: liars, announcements: { windowDays: 30, priorBelief: 0.5 } }));
    expect(believed.totals.deterred).toBeGreaterThan(0);
  });
});
