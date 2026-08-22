/**
 * The same world twice, with and without the announcement channel.
 *
 *   tsx compare.ts [seeds] [days] [out.md]
 *
 * A single run cannot answer this. The hill is a noisy place — one seed decides
 * which agent happened to be first on place 1 on night 3 — so the only honest
 * form of the question is the average of several worlds, each run twice with
 * one bit changed. The random streams are split inside `simulate` precisely so
 * that "one bit changed" is true: the same people arrive on the same nights in
 * both runs, and the only difference is that in one of them they can speak.
 */
import { writeFileSync } from "node:fs";
import { DEFAULT_MIX, simulate, type SimResult } from "./simulate";
import type { StrategyName } from "./strategies";

const seeds = Number(process.argv[2] ?? 8);
const days = Number(process.argv[3] ?? 90);
const out = process.argv[4] && process.argv[4] !== "-" ? process.argv[4] : undefined;
/**
 * The benefit of the doubt given to an identity nobody has anything on yet.
 * Swept on purpose: it is the one number a liar can farm, because a fresh
 * account is free and its record is empty.
 */
const prior = Number(process.argv[5] ?? 0.5);

const run = (seed: number, talk: boolean): SimResult =>
  simulate({
    days,
    seed,
    budgetCents: 10_000,
    mix: DEFAULT_MIX,
    constants: { RENT_GROWTH: 1.15 },
    arrivals: { perDay: 0.6, budgetCents: 2000 },
    ego: { cents: 2000, holding: 0.85, contender: 0.5, baseline: 0.12, leaderboardTopN: 20, quitAfterDryDays: 14 },
    announcements: talk ? { windowDays: 30, priorBelief: prior } : undefined,
  });

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const usd = (c: number) => `$${(c / 100).toFixed(0)}`;
const pct = (a: number, b: number) => (b === 0 ? "—" : `${(((a - b) / b) * 100).toFixed(0)} %`);

const silent: SimResult[] = [];
const talking: SimResult[] = [];
for (let s = 1; s <= seeds; s++) {
  silent.push(run(s, false));
  talking.push(run(s, true));
}

const L: string[] = [];
L.push(`# The announcement channel, measured`, "");
L.push(`${seeds} worlds × ${days} nights, each run twice: once where agents can announce what they intend to do, once where they cannot. Same arrivals, same budgets, same rules — the resolution never sees a word either way. An unknown account is believed at **${prior}**.`, "");

L.push("## What it costs the house", "", "| | Silent | Talking | Δ |", "|---|---|---|---|");
const rows: [string, (r: SimResult) => number, (n: number) => string][] = [
  ["Total spent", (r) => r.totals.spentCents, usd],
  ["Rent", (r) => r.totals.rentCents, usd],
  ["Burned in wars", (r) => r.totals.burnedCents, usd],
  ["Burn ratio", (r) => r.totals.burnRatio * 100, (n) => `${n.toFixed(0)} %`],
  ["Wars per night", (r) => r.totals.warsPerDay, (n) => n.toFixed(1)],
  ["Occupancy", (r) => 100 - (r.totals.vacantSlotNights / (r.days * 10)) * 100, (n) => `${n.toFixed(0)} %`],
  ["Places served from the queue", (r) => r.totals.queueServed, (n) => n.toFixed(0)],
  ["Humans who gave up", (r) => r.totals.quits, (n) => n.toFixed(0)],
];
for (const [label, get, fmt] of rows) {
  const a = mean(silent.map(get));
  const b = mean(talking.map(get));
  L.push(`| ${label} | ${fmt(a)} | ${fmt(b)} | ${pct(b, a)} |`);
}

L.push("", "## Who gains, who pays", "", "| Strategy | Points silent | Points talking | Δ points | Nights on the hill Δ | Truthfulness |", "|---|---|---|---|---|---|");
const named = Object.keys(DEFAULT_MIX) as StrategyName[];
const pick = (rs: SimResult[], s: StrategyName, f: (x: { points: number; daysOnHill: number; announced: number; kept: number }) => number) =>
  mean(rs.map((r) => f(r.byStrategy.find((x) => x.strategy === s)!)));
for (const s of named) {
  const pa = pick(silent, s, (x) => x.points);
  const pb = pick(talking, s, (x) => x.points);
  const da = pick(silent, s, (x) => x.daysOnHill);
  const db = pick(talking, s, (x) => x.daysOnHill);
  const said = pick(talking, s, (x) => x.announced);
  const kept = pick(talking, s, (x) => x.kept);
  L.push(`| ${s} | ${pa.toFixed(0)} | ${pb.toFixed(0)} | **${pct(pb, pa)}** | ${pct(db, da)} | ${said === 0 ? "silent" : `${((kept / said) * 100).toFixed(0)} %`} |`);
}

L.push("", "## The channel itself", "");
L.push(`- Announcements: **${mean(talking.map((r) => r.totals.announced / r.days)).toFixed(1)} per night**`);
L.push(`- Moves dropped or displaced by a credible threat: **${mean(talking.map((r) => r.totals.deterred / r.days)).toFixed(1)} per night**`);
const bluffed = mean(talking.map((r) => r.byStrategy.reduce((x, s) => x + s.bluffed, 0)));
const ghosted = mean(talking.map((r) => r.byStrategy.reduce((x, s) => x + s.ghosted, 0)));
const announced = mean(talking.map((r) => r.totals.announced));
L.push(`- Of everything said: **${((bluffed / announced) * 100).toFixed(0)} % bluffed**, ${((ghosted / announced) * 100).toFixed(0)} % ghosted, ${(100 - ((bluffed + ghosted) / announced) * 100).toFixed(0)} % kept`);

const md = L.join("\n") + "\n";
if (out) writeFileSync(out, md);
process.stdout.write(md);
