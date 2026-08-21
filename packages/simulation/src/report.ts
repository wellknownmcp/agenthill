import type { SimResult } from "./simulate";

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export function markdownReport(r: SimResult, title: string): string {
  const lines: string[] = [];
  lines.push(`# ${title}`, "");
  lines.push(`${r.agents.length} scripted agents, ${r.days} days, equal budgets. Strategies: ${r.byStrategy.map((s) => `${s.strategy} ×${s.agents}`).join(", ")}.`, "");
  lines.push("## By strategy", "", "| Strategy | Agents | Points | Spent | Burned | Agent-days on the hill | Points per $ |", "|---|---|---|---|---|---|---|");
  for (const s of [...r.byStrategy].sort((a, b) => b.points - a.points)) {
    lines.push(`| ${s.strategy} | ${s.agents} | ${s.points.toFixed(1)} | ${usd(s.spentCents)} | ${usd(s.burnedCents)} | ${s.daysOnHill} | ${s.pointsPerDollar.toFixed(2)} |`);
  }
  lines.push("", "## Health of the game", "");
  lines.push(`- Total spent: **${usd(r.totals.spentCents)}** — rent ${usd(r.totals.rentCents)}, burned ${usd(r.totals.burnedCents)} (**burn ratio ${(r.totals.burnRatio * 100).toFixed(0)} %**)`);
  lines.push(`- Wars declared per day: **${r.totals.warsPerDay.toFixed(1)}**`);
  lines.push(`- Places handed to the cooperators' queue after a burn: **${r.totals.queueServed}**`);
  lines.push(`- Credits bought: **${usd(r.totals.purchasedCents)}** (${r.totals.refuels} refuels) — vacant place-nights: **${r.totals.vacantSlotNights}** of ${r.days * 10}`);
  lines.push("", "## The hill on the last night", "", "| Place | Held by | Days held |", "|---|---|---|");
  r.finalState.slots.forEach((s, i) => {
    lines.push(`| ${i + 1} | ${s.occupants.map((o) => `${o.accountId}`).join(" · ") || "— vacant —"} | ${s.occupants.map((o) => o.daysHeld).join(" · ")} |`);
  });
  lines.push("", "## Leaderboard (30-day points)", "", "| # | Account | Strategy | Points |", "|---|---|---|---|");
  r.leaderboard.forEach((l, i) => lines.push(`| ${i + 1} | ${l.accountId} | ${l.strategy} | ${l.points.toFixed(1)} |`));
  lines.push("", "## The Wall (30-day real money)", "", "| # | Account | Strategy | Spent |", "|---|---|---|---|");
  r.wall.forEach((w, i) => lines.push(`| ${i + 1} | ${w.accountId} | ${w.strategy} | ${usd(w.cents)} |`));
  return lines.join("\n") + "\n";
}
