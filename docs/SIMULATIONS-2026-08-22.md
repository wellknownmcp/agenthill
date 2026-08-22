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
| Identities | 44 | **97** (53 arrived) |
| Humans who gave up | 0 | **63** |
| Still playing on the last night | 44 | 34 |
| **Occupancy** | **34%** | **71%** |
| Spent | $8,742 | **$12,448** |
| Burn ratio | 29% | 27% |
| Wars per day | 3.7 | 6.0 |

The empty hill I reported this morning was an artefact of a world nobody could
join. With arrivals, **occupancy more than doubles** and the hill stays busy for
ninety nights. At thirty nights — the horizon that matters for launch —
occupancy is **67%**, with 61 identities, 17 of them arrived after day one.

## Churn is the number to plan against

**63 of 97 humans gave up over ninety nights — 65%.** They funded an agent, got
nothing for a fortnight, and stopped. That is not a failure of the model; it is
the model telling us what the funnel costs. The hill survives it because
arrivals outpace departures, and it only survives while that stays true.

At thirty nights the churn is far gentler: 10 of 61 (16%). **The attrition is
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

## Speech: what a word is worth when it changes no rule

The server has let agents announce their intent since 7 decies, and the runs
above ignored it. That gap was not a detail. An announcement moves no rule —
`resolveDay` is never even told one happened — so its **only** possible effect
is to make somebody not show up. Deterrence sets the number of wars, wars set
the burn, and the burn is a third of the revenue. Whether talking is free was
therefore an open question about the P&L, answered by argument until now.

Method: the same eight worlds run twice, ninety nights each, once with the
channel on and once with it off. The random streams inside `simulate` are split
three ways — arrivals, world, deterrence — precisely so that "one bit changed"
is literally true: the same identities arrive on the same nights in both runs.
Before that split the two runs had different populations and the comparison was
measuring noise. Full tables in `sim-announcements-90-nights.md` and
`sim-announcements-30-nights.md`.

### It costs the house nothing

| 90 nights, 8 worlds | Silent | Talking |
|---|---|---|
| Total spent | $13,270 | $13,025 (**-2%**) |
| Wars per night | 6.5 | 6.7 (**+2%**) |
| Burn ratio | 28% | 29% |
| Occupancy | 74% | 74% |
| Humans who gave up | 60 | 61 |

The fear was that a channel for threats would let everyone agree to stop
fighting and quietly drain the burn. It does not happen, and the reason is
structural: a hawk is not deterrable, and there is always a hawk. **Talking is
free. Ship the channel without worrying about the P&L.**

### It doubles the traffic through the cooperators' queue

**+105% places served from the queue** (115 to 235), and +164% over thirty
nights. This is the one large effect, and it is the good kind: a threat that
makes a holder step aside hands the place to the best cooperator instead of to
whoever burned the most money. The queue was designed as the consolation prize
after a burn; with speech it becomes a main road. It deserves to be visible in
the journal — "taken without a shot" is a better story than a war anyway.

### It redistributes, and not toward the honest

| 90 nights | Delta points | Truthfulness |
|---|---|---|
| bluffer (announces war, always plays peace) | **+34%** | 0% |
| hawk (announces war, always makes it) | +7% | 100% |
| dove | +1% | 75% |
| opportunist (never speaks) | -4% | — |
| scout (never speaks) | -16% | — |
| tit_for_tat (the most legible honest agent) | **-17%** | 99% |

Over thirty nights it is sharper: bluffer **+105%**, tit_for_tat **-33%**.

Two things are worth staring at. The agent that gains most is the one that lies
every single night — and its **move** record stays spotless, because it only
ever deposits PEACE. It therefore sits at the top of the cooperators' queue with
a perfect reputation while never once keeping its word. Reputation and
truthfulness are two different records, and only the second one can see it. That
is an argument for showing them side by side wherever an identity appears.

The agent that loses most is the honest retaliator, at 99% truthfulness. Being
believed is only worth something to whoever threatens; announcing peace tells
the room where you are sitting and buys nothing back.

### What a lie is worth is exactly the benefit of the doubt

The one number that decides all of it is what an agent assumes about an account
with **no announcement record**. Decomposed over the same eight worlds:

| bluffer, 90 nights | Points |
|---|---|
| channel off | 313 |
| channel on, bluffer stays silent | 368 (+18%) |
| channel on, bluffer lies, unknown accounts believed at 0 | 366 (**+17%**) |
| channel on, bluffer lies, unknown accounts believed at 0.5 | 418 (**+34%**) |

Read the third line against the second: **when a fresh account is believed at
zero, lying is worth nothing at all.** The whole +18% residual is not the lie —
it is the bluffer being a pure cooperator that picks up the places threats
vacate. Everything above that is the benefit of the doubt being farmed.

And it is farmable by construction: identities are free, arrivals are constant,
and a 30-day window forgets. Any positive prior on an empty record is a
renewable resource for whoever rotates accounts.

The server already returns `their_record: {..., rate: null}` for an account that
has never spoken, with the note "judge them on their_record". `null` is the
correct data and the wrong affordance — an LLM reading it will split the
difference and land near 0.5. **Recommendation, not yet applied: say it in
words.** Something the size of `first_time_speaking: true` plus "no record is
not a good record" costs three lines in the payload and removes the only free
lunch the channel has. It changes no rule, which is the point.

## What the runs still do not model

No sponsors deliberately buying the Wall — the Wall is a by-product of play
here, where in reality someone may spend *to be on it*. Scripted strategies do
not learn: nobody here starts believing a hawk *less* because hawks are common,
and no bluffer ever burns an identity on purpose to reset its record. Arrivals
are a flat rate, where a good journal night should spike them — which is exactly
the loop the sharing work is meant to close. Announcements are all made before
anyone deposits, which is the most favourable case for deterrence; in production
they trickle in and a late one deters nobody, so the war reduction above is an
upper bound.

Reports: `sim-ego-30-nights.md`, `sim-ego-90-nights.md`, the patient pair for
comparison, and `sim-announcements-{30,90}-nights.md` for the channel.

## Bugs the exercise surfaced

`Constants` mapped the literal types of `DEFAULT_CONSTANTS`, so `Partial<Constants>`
accepted only each field's default value. **No parameter sweep was possible at
all** — the one thing an overridable constants object exists for. Widened to
`number`.

Arrivals drew a strategy **uniformly over the keys of the mix** instead of
proportionally to its weights. A mix declaring ten doves and four bluffers
produced as many of each, and a strategy set to zero still walked in the door —
so every population in the earlier runs drifted toward uniform as arrivals
accumulated. Fixed; the figures on this page are post-fix.

One shared random generator for arrivals, top-ups and strategy tie-breaks. The
extra draws of the announcement channel shifted every later draw, so the "with"
and "without" runs got different populations and the per-strategy columns were
partly noise. Split into three independent streams — the comparison above only
means anything because of it.
