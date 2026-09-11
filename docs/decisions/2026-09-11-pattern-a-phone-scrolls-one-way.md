---
category: pattern
date: 2026-09-11
project: SnapCount
feature: Mobile layout
severity: medium
tags: responsive, overflow, tables, measurement, tooling, audit
applies_to: frontend
---

# A phone scrolls one way, and only measurement proves it

## Context

The rule: on a phone the app scrolls up and down, never left and right.
Vertical space is free — you can always scroll further — but horizontal space
is fixed, so anything wider than the screen is content behind a gesture nobody
makes.

Checking this by eye does not work. Screenshots had been used for every mobile
question before this and had caught real defects, but they cannot see the
difference between "this table ends at the screen edge" and "this table
continues for another 380px". Both look identical.

## Decision / Finding

Measuring found **six offenders across thirteen views**, of which one had been
looked at repeatedly without being noticed:

| Offender | Visible | Actual | Where |
| --- | --- | --- | --- |
| Scoreboard strip | 370px | 1,328px | every tab |
| Nav rail as a strip | 390px | 1,606px | every tab |
| Standings table | 362px | 652–720px | ×9 per page |
| Injury Watch table | 362px | 750px | one tab |
| Bye-week grid | 362px | 640px | one tab |
| Lineup table (dialog) | 349px | 730px | matchup drill-in |

The fix is never "let it scroll" and rarely "hide a column". Each needed a
layout that answers the same question in a different shape:

- **Nine scoreboard tiles** → one button, and the tiles stacked in a dialog
  where each gets full width instead of 143px.
- **Thirteen nav destinations** → the view you are on, and the labelled list a
  tap away. The previous attempt at this had been icon-only, which was worse:
  thirteen unlabelled glyphs.
- **Six-column standings** → manager folds under the team name, points-against
  goes, and `table-layout: fixed` caps the name column. Without the fixed
  layout a long team name sets the column's min-content width and no amount of
  truncation helps, because the column is free to grow.
- **A ten-week bye grid** → a list per team showing only the weeks that have
  somebody, with names instead of counts. Better than the grid at any width.
- **A mirrored lineup table** → the two lineups stacked per slot. The mirror is
  the point on a laptop and cannot survive 349px, so the phone gets the same
  comparison rotated.

## The measurement is the deliverable

`npm run audit:overflow` loads the real app in a real browser at 320, 390 and
430px, walks every tab plus `/gameday`, and reports two things per view: whether
the pane can be dragged sideways, and whether anything renders past its right
edge. 42 view/width combinations.

Two details make it trustworthy:

1. **It reports elements past the edge, not just scrollable panes.** That is
   what sees through `overflow-x: hidden`. A clamp that stops the finger does
   not stop the audit.
2. **It was verified by breaking the app.** Re-enabling one hidden column made
   four views fail with the exact table and the exact overshoot named. An audit
   never seen to fail is not evidence of anything — the same lesson as the
   rate-limit check that counted connection failures as successes.

## A false positive worth keeping

At 320px one pane reports 8px of overflow with nothing rendering past its edge.
That is the styled scrollbar: `clientWidth` excludes a classic scrollbar and
`scrollWidth` includes the space beneath it. Phones use overlay scrollbars and
never see it. The audit tolerates up to a scrollbar's width of pane overflow
while still failing on anything that actually renders off-screen, so the
distinction is encoded rather than explained away.

## Rules going forward

1. **`overflow-x: auto` is not a mobile layout.** It is the absence of one. If
   content does not fit, the layout changes shape.
2. **Setting `overflow-y: auto` sets the other axis too.** Per spec, `visible`
   computes to `auto` when the other axis is not visible, so every vertical
   scroller is a horizontal one by default.
3. **`align-items: flex-start` means something different once a row becomes a
   column.** It governed height on the desktop `.sc-split` and width on the
   phone, so each child sized to its own max-content and overflowed.
4. **A `select` is as wide as its longest option.** League names made a 391px
   control on a 382px screen. `max-width: 100%` lets the UA ellipsise.

## Related

- [2026-09-04 — Verifying a guard end-to-end proved nothing and hid a dead server](2026-09-04-ai-mistake-end-to-end-check-that-could-not-tell-allowed-from-dead.md)
  — why the deliberate-regression step above is not optional.
