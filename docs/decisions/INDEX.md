# Decision & Learning Index

What was learned the hard way, so the next feature does not learn it again. Every entry
here cost real time to discover — most were found by measuring something or by breaking
it, not by reasoning about it.

Searchable by the YAML frontmatter in each file: `category`, `tags`, `applies_to`,
`severity`.

## Architecture Decisions

- [2026-09-04 — Live data never goes through Next's fetch data cache](2026-09-04-architecture-decision-live-data-never-through-the-fetch-data-cache.md)
  — it is stale-while-revalidate, `force-dynamic` silently overrides per-fetch
  `revalidate`, and the key includes the `cookie` header. Caught before any code existed.

## AI Mistakes

- [2026-09-04 — Verifying a guard end-to-end proved nothing and hid a dead server](2026-09-04-ai-mistake-end-to-end-check-that-could-not-tell-allowed-from-dead.md)
  — 125 curl requests counted connection failures as successes while the server was down.
  Test pure logic directly; also, never assume a shell-written edit landed as typed.

## Framework Choices

*(none yet)*

## Bug Fixes

- [2026-09-04 — `globalThis` outlives the code that shaped it, and `??=` preserves the old shape](2026-09-04-bug-fix-globalthis-outlives-the-code-that-shaped-it.md)
  — changing a cached shape broke every request. Not a hot-reload artifact: a warm
  serverless instance across a deploy fails identically.

## Patterns

- [2026-09-04 — A cache bounds duplicate work, not an enumerating caller](2026-09-04-pattern-cost-ceilings-need-counting-not-caching.md)
  — measured: 54 round-robin requests rebuilt 54 times even with a slot per key, because
  the TTL that makes a live cache correct makes it useless as a ceiling. Count, don't cache.

## Process

*(none yet)*

## Security

*(none yet — but see the Patterns entry above; the finding that produced it was a
financial-abuse blocker on a public endpoint)*

## Performance

*(none yet)*

## Licensing

*(none yet)*

## Infrastructure

*(none yet)*
