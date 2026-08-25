/**
 * Scoring a projected stat line against a league's own rules.
 *
 * Sleeper's projections ship a raw stat line (pass_yd, rec, rush_td, …) keyed
 * identically to a league's `scoring_settings`. That shared vocabulary is the
 * whole trick: rather than trusting the generic `pts_ppr` number, we multiply
 * each projected stat by what that league actually pays for it.
 *
 * It matters more than it sounds. Josh Allen's week-1 projection scores 23.26
 * under Sleeper's generic PPR but 20.36 under the "Shlong" league's settings —
 * a three-point swing on a single starter, which is the difference between a
 * projected win and a projected loss in a close matchup.
 */

/** Projection payload keys that are results, not inputs — never re-score them. */
const DERIVED_KEYS = new Set([
  "pts_ppr",
  "pts_half_ppr",
  "pts_std",
  "adp_dd_ppr",
  "pos_adp_dd_ppr",
  "gp",
]);

export type StatLine = Record<string, number>;
export type ScoringSettings = Record<string, number>;

export interface ProjectionSource {
  stats: StatLine;
  ptsPpr: number | null;
  ptsHalfPpr: number | null;
  ptsStd: number | null;
}

/**
 * Sleeper's precomputed number for a league whose scoring we cannot resolve.
 * Picks the variant matching the league's reception value.
 */
export function fallbackPoints(
  projection: ProjectionSource,
  scoring: ScoringSettings | null,
): number | null {
  const rec = scoring?.rec;
  if (rec === 1) return projection.ptsPpr ?? projection.ptsHalfPpr ?? projection.ptsStd;
  if (rec === 0.5) {
    return projection.ptsHalfPpr ?? projection.ptsPpr ?? projection.ptsStd;
  }
  if (rec === 0) return projection.ptsStd ?? projection.ptsHalfPpr ?? projection.ptsPpr;
  return projection.ptsPpr ?? projection.ptsHalfPpr ?? projection.ptsStd;
}

/**
 * Projected fantasy points for one player in one league.
 *
 * Returns null when there is no projection at all, so the UI can say "no
 * projection" instead of showing a misleading 0.0 — which is a real state here:
 * Sleeper only projects fantasy-relevant players, so deep-bench and taxi
 * players legitimately have none.
 */
export function projectedPoints(
  projection: ProjectionSource | null | undefined,
  scoring: ScoringSettings | null | undefined,
): number | null {
  if (!projection) return null;

  const stats = projection.stats;
  if (!stats || Object.keys(stats).length === 0) {
    return fallbackPoints(projection, scoring ?? null);
  }

  if (!scoring || Object.keys(scoring).length === 0) {
    return fallbackPoints(projection, null);
  }

  let total = 0;
  let matched = 0;

  for (const [key, value] of Object.entries(stats)) {
    if (DERIVED_KEYS.has(key)) continue;
    const weight = scoring[key];
    if (weight == null || !Number.isFinite(value)) continue;
    total += value * weight;
    matched++;
  }

  // No overlap at all means the scoring settings are unusable for this player
  // (an IDP-only line, say) — fall back rather than reporting a confident 0.
  if (matched === 0) return fallbackPoints(projection, scoring);

  return Math.round(total * 100) / 100;
}

/** Sums projections, ignoring players who have none. */
export function sumProjected(values: Array<number | null>): number {
  return (
    Math.round(
      values.reduce<number>((sum, v) => sum + (v ?? 0), 0) * 100,
    ) / 100
  );
}
