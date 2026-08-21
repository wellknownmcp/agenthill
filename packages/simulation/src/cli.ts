import { writeFileSync } from "node:fs";
import { DEFAULT_MIX, simulate } from "./simulate";
import { markdownReport } from "./report";

const seed = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 30);
const out = process.argv[4];
const growth = Number(process.argv[5] ?? 1.15);
const r = simulate({ days, seed, budgetCents: 10_000, mix: DEFAULT_MIX, refuel: { belowCents: 1000, cents: 2000, max: 5 }, constants: { RENT_GROWTH: growth } });
const md = markdownReport(r, `Simulation — ${r.agents.length} agents, ${days} days, seed ${seed}, rent growth ${growth}, refuel 20 $ ×5`);
if (out) writeFileSync(out, md);
process.stdout.write(md);
