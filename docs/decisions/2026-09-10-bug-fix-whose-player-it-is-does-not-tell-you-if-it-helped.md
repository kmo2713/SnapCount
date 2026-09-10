---
category: bug-fix
date: 2026-09-10
project: SnapCount
feature: Live Gameday
severity: high
tags: espn, play-by-play, fantasy-scoring, sign-error, derived-stats, measurement
applies_to: backend
---

# Whose player it is does not tell you whether the play helped

## Context

The drill-in's play feed annotated each play with the leagues the involved
players belonged to, a plus for your own starter and a minus for one your
opponent starts:

```tsx
{role.side === "mine" ? "+" : "-"} {role.leagueName}
```

Reported by the user: Drake Maye threw three interceptions, and the chip showed
a **minus** for the league where they were *facing* Maye. Being on the other
side of three interceptions is one of the better things that can happen to you.

## Decision / Finding

The plus and minus meant "this player is mine" and "this player is against
me", and they were rendered where a reader reasonably sees help and harm. Those
are the same answer only for plays that *helped* the player involved. Every
interception, fumble and missed kick was reported backwards, in both
directions at once — a minus where you gained and a plus where you lost.

A sign flip is not the fix, because there is no rule that maps "is this my
player" to "did this help me" without knowing what the play was worth. So the
play is now scored: derive its stat line, run it through each league's own
rules, and let the sign fall out of the arithmetic.

```
net = Σ(points for your starters) − Σ(points for the starters facing you)
```

Maye's interception, in a league paying −2 for one: he is your opponent's, so
`net = −(−2) = +2`. The same play in the league where you start him: `−2`. Both
verified against the live feed.

The magnitude comes free, which is the part worth having: the chip now reads
`+2.0 Impact Fantasy Football 2026` rather than a bare league name.

## How the stat line is derivable at all

ESPN's core play feed carries a type ("Pass Reception", "Pass Interception
Return"), a yardage, and participants tagged with the role each played
("passer", "receiver", "rusher"). Per-participant statistics exist **only as
`$ref` links** — one HTTP request per participant per play, roughly four
hundred for one game. Not an option.

So the line is reconstructed from type + role + yardage. That sounds
approximate. It was checked against the official box score for every offensive
player in a completed game, and it is exact: passing, rushing and receiving
reproduced to the yard, including 23/33 for 178 with 3 interceptions.

Two things that check taught us, neither guessable:

1. **Sacks do not reduce passing yards.** Summing completions alone gave 178,
   matching the official 178, while the quarterback was sacked three times for
   ten yards. A sack is therefore worth nothing to him, and treating those ten
   yards as a loss would have been wrong in every league.
2. **A touchdown's receiver is listed twice**, as `receiver` and again as
   `scorer`. Counting both gave Jaxon Smith-Njigba 167 receiving yards against
   an official 122 — his 45-yard score twice. Every athlete is now reduced to
   one role per play before scoring.

## The scoring rules were nearly read wrong too

ESPN ships scoring as `{ statId, points }`. Reading `points` looks obviously
right and is wrong for half the configured leagues: two of the four set every
passing rule to `points: 0` and carry the real rate only in `pointsOverrides`,
keyed by position id.

```json
{ "statId": 3, "points": 0,
  "pointsOverrides": { "1": 0.04, "2": 0.04, "3": 0.04, "4": 0.04, "15": 0.04 } }
```

Reading the base alone would have scored every passing yard, passing touchdown
and interception in MONEY TIME at **zero** — and displayed it as a number, next
to leagues where the same play showed a real one. The override is used when
every position agrees, and the rule is skipped when they genuinely differ,
since this code has no player and therefore no position.

The statId crosswalk was confirmed by the *values*, not from memory: id 3 pays
0.04, id 4 pays 4 or 6, id 20 pays −1 or −2, id 53 pays 1, id 72 pays −1 or −2.
Nothing but passing yards, passing touchdowns, interceptions, receptions and
fumbles carries those rates.

## Rules going forward

1. **A plus sign is a claim about outcome, not about ownership.** If the UI
   shows direction, the data layer has to compute direction. Rendering an
   attribute as if it were a result is how this survived: the chips were
   *correct* about whose player it was.
2. **Distinguish "worth nothing" from "cannot say".** `statsForRole` returns
   `{}` for a play known to be worth nothing and `null` for a type it does not
   recognise; only the second hides the number. An incompletion really did cost
   you nothing, and saying so is different from guessing.
3. **Reconstructed data gets checked against the authoritative total.** The
   box score existed the whole time and settled in one measurement what would
   otherwise have been three plausible arguments about sack yardage.

## Related

- [2026-09-10 — A third-party field that only exists when you are not watching](2026-09-10-bug-fix-a-third-party-field-that-only-exists-when-you-are-not-watching.md)
  — same provider, same lesson about verifying against something authoritative
  rather than reasoning about the payload.
