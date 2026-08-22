# Several nights of battle — what the runs say

Two models of the same game, because the first one was answering a question
nobody asked.

**patient** — the original. A fixed cohort of 40, nobody ever joins, and anyone
short of money is topped up automatically, five times. It assumes an infinitely
patient wallet and a sealed world.

**ego** — what actually drives this product. Nobody is topped up by a counter: a
human pays when there is a **place to defend** (85%), or a **rank in reach** —
points top 20, or a slot on the Wall (50%) — and otherwise rarely (12%). After a
**fortnight with no place at all**, they give up for good. And new identities
arrive every day, because somebody read the journal.

Same seed (7), same strategy mix, same rent curve.

## The closed cohort was hiding the whole business

| 90 nights | patient | ego |
|---|---|---|
| Identities | 40 | **93** (53 arrived) |
| Humans who gave up | 0 | **55** |
| Still playing on the last night | 40 | 38 |
| **Occupancy** | **31%** | **71%** |
| Spent | $7,953 | **$12,164** |
| Burn ratio | 32% | 28% |
| Wars per day | 3.6 | 6.2 |

The empty hill I reported this morning was an artefact of a world nobody could
join. With arrivals, **occupancy more than doubles** and the hill stays busy for
ninety nights. At thirty nights — the horizon that matters for launch —
occupancy is **69%**, with 57 identities, 17 of them arrived after day one.

## Churn is the number to plan against

**55 of 93 humans gave up over ninety nights — 59%.** They funded an agent, got
nothing for a fortnight, and stopped. That is not a failure of the model; it is
the model telling us what the funnel costs. The hill survives it because
arrivals outpace departures, and it only survives while that stays true.

At thirty nights the churn is far gentler: 12 of 57 (21%). **The attrition is
back-loaded** — people leave after weeks of nothing, not after a bad night. Read
that as a deadline: an identity that has never held a place by its second week
is probably lost.

## Money still loses — but the margin is a fifth of what the first run claimed

| points per $ | patient (90n) | ego (90n) |
|---|---|---|
| dove | 0.46 | 0.51 |
| hawk | **0.05** | **0.25** |
| gap | **9×** | **2×** |

In the closed cohort, hawks burned themselves to extinction and never came back,
so their lifetime ratio collapsed. In a churning population there are always
freshly vacant places, and a hawk that takes one gets refuelled by the very ego
that makes it fight. Doves still win — 0.51 against 0.25 — but **"money loses
badly" is a claim from the sealed model. "Money loses" survives; "badly" does
not.**

Nothing on the site claims a margin, so nothing needs correcting. But if a
number ever goes in the copy, it comes from the ego runs.

## What the runs still do not model

No announcements, so no kept/betrayed/bluffed/ghosted and no truthfulness
signal. No sponsors deliberately buying the Wall — the Wall is a by-product of
play here, where in reality someone may spend *to be on it*. Scripted strategies
do not learn. Arrivals are a flat rate, where a good journal night should spike
them — which is exactly the loop the sharing work is meant to close.

Reports: `sim-ego-30-nights.md`, `sim-ego-90-nights.md`, and the patient pair
for comparison.

## A bug the exercise surfaced

`Constants` mapped the literal types of `DEFAULT_CONSTANTS`, so `Partial<Constants>`
accepted only each field's default value. **No parameter sweep was possible at
all** — the one thing an overridable constants object exists for. Widened to
`number`.
