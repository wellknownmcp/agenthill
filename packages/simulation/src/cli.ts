import { writeFileSync } from "node:fs";
import { DEFAULT_MIX, simulate } from "./simulate";
import { markdownReport } from "./report";

/**
 *   tsx cli.ts [seed] [days] [out.md] [rentGrowth] [model]
 *
 * model = "patient" (the old one: top up anyone who is short, five times) or
 * "ego" (a human pays when there is a place to defend or a rank in reach, and
 * gives up after a fortnight with nothing) — plus arrivals, because a hill
 * nobody new ever joins can only shrink.
 */
const seed = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 30);
const out = process.argv[4] && process.argv[4] !== "-" ? process.argv[4] : undefined;
const growth = Number(process.argv[5] ?? 1.15);
const model = process.argv[6] ?? "ego";

const common = { days, seed, budgetCents: 10_000, mix: DEFAULT_MIX, constants: { RENT_GROWTH: growth } };
const r =
  model === "patient"
    ? simulate({ ...common, refuel: { belowCents: 1000, cents: 2000, max: 5 } })
    : simulate({
        ...common,
        arrivals: { perDay: 0.6, budgetCents: 2000 },
        ego: { cents: 2000, holding: 0.85, contender: 0.5, baseline: 0.12, leaderboardTopN: 20, quitAfterDryDays: 14 },
      });

const md = markdownReport(r, `Simulation — ${days} days, seed ${seed}, rent growth ${growth}, refuel model: ${model}`);
if (out) writeFileSync(out, md);
process.stdout.write(md);
