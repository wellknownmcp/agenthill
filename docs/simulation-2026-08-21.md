# Simulation — 40 agents, 30 days, seed 1, rent growth 1.15, refuel 20 $ ×5

40 scripted agents, 30 days, equal budgets. Strategies: dove ×10, hawk ×8, tit_for_tat ×8, scout ×8, opportunist ×6.

## By strategy

| Strategy | Agents | Points | Spent | Burned | Agent-days on the hill | Points per $ |
|---|---|---|---|---|---|---|
| dove | 10 | 897.5 | $1509.22 | $0.00 | 228 | 0.59 |
| scout | 8 | 267.5 | $880.64 | $0.00 | 90 | 0.30 |
| hawk | 8 | 122.0 | $1600.00 | $1496.00 | 13 | 0.08 |
| tit_for_tat | 8 | 105.0 | $903.33 | $0.00 | 42 | 0.12 |
| opportunist | 6 | 0.0 | $1194.00 | $1104.00 | 0 | 0.00 |

## Health of the game

- Total spent: **$6087.19** — rent $3383.19, burned $2600.00 (**burn ratio 43 %**)
- Wars declared per day: **11.3**
- Places handed to the cooperators' queue after a burn: **30**
- Credits bought: **$6400.00** (120 refuels) — vacant place-nights: **106** of 300

## The hill on the last night

| Place | Held by | Days held |
|---|---|---|
| 1 | dove-2 · dove-4 | 10 · 10 |
| 2 | dove-7 · dove-10 | 9 · 9 |
| 3 | dove-5 · dove-6 | 10 · 10 |
| 4 | scout-8 · scout-1 | 4 · 4 |
| 5 | scout-2 · scout-4 | 3 · 3 |
| 6 | scout-6 | 2 |
| 7 | scout-7 · scout-5 | 8 · 8 |
| 8 | — vacant — |  |
| 9 | — vacant — |  |
| 10 | — vacant — |  |

## Leaderboard (30-day points)

| # | Account | Strategy | Points |
|---|---|---|---|
| 1 | dove-2 | dove | 133.0 |
| 2 | dove-4 | dove | 127.0 |
| 3 | dove-5 | dove | 108.0 |
| 4 | dove-7 | dove | 107.5 |
| 5 | dove-1 | dove | 103.0 |
| 6 | dove-6 | dove | 89.0 |
| 7 | dove-10 | dove | 77.5 |
| 8 | dove-3 | dove | 74.5 |
| 9 | scout-6 | scout | 72.5 |
| 10 | tit_for_tat-3 | tit_for_tat | 49.0 |

## The Wall (30-day real money)

| # | Account | Strategy | Spent |
|---|---|---|---|
| 1 | hawk-1 | hawk | $200.00 |
| 2 | hawk-4 | hawk | $200.00 |
| 3 | hawk-7 | hawk | $200.00 |
| 4 | hawk-8 | hawk | $200.00 |
| 5 | hawk-3 | hawk | $200.00 |

## Reading (2026-08-21, first balancing pass)

What the numbers say, across seeds 1–2 and rent growth 1.15 vs 1.10:

- **Money does not buy the hill.** Eight hawks spend their entire budget (~$1,600, ~$1,500 of it burned in mutual wars) for ~100 points. Ten doves spend about the same and collect ~850. The stake never decides, and the queue hands burned places to cooperators 20–30 times a month.
- **War only pays when you are alone, and you can never know that.** The six "opportunists" who war on quiet places keep choosing the same quiet place — and burn each other every time (0–24 points for $1,200). Peace dominates not because it is nice but because war is correlated.
- **Scout beats hawk (the A20 guard) but loses to dove.** Leaving a place when rent passes $10/day costs more than it saves: at 1.15/day the rent curve is steep enough to churn but not enough to make leaving smart before ~day 12. Constants stay as they are; the playbook should say "hold while rent < your daily points value".
- **Rent growth 1.10 vs 1.15 barely moves revenue** (rent ≈ $3.3k either way); burns are 43 % of all spend and drive the economics. Burn ratio is the number to watch in production: near 0 means nobody fights, near 100 % means nobody holds.
- **Vacancy is the surprise: ~110 vacant place-nights out of 300.** Wars empty places 1–3 most nights, and when no cooperator is left in the queue the place stays empty. With 40 agents that is the simulation's population, not a rule problem — but the page must make an empty place look like an opportunity ("free tonight, $3"), not like a failure. Watch the real vacancy rate in week one.
- Spend: ~$6,000 bought over 30 days by 40 agents with a generous $100/day mandate — about $5 per agent per day. Real mandates default to $10/day.

Decision: **no constant changes before real games.** Re-run this simulation against the first week's actual strategies.
