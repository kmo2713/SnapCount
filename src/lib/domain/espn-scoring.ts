/**
 * ESPN's scoring rules, translated into the vocabulary the rest of the app
 * uses.
 *
 * Sleeper hands over a league's scoring as named rates — `pass_yd: 0.04`,
 * `pass_int: -2` — and every scoring path in this codebase is built on those
 * keys. ESPN instead ships an array of `{ statId, points }`, so the two cannot
 * meet without a crosswalk.
 *
 * The ids below were confirmed against the four configured ESPN leagues rather
 * than taken from memory, and the confirmation is the values themselves: id 3
 * pays 0.04, id 4 pays 4 or 6, id 20 pays -1 or -2, id 53 pays 1, id 72 pays
 * -1 or -2. Those are the conventional rates for passing yards, passing
 * touchdowns, interceptions thrown, receptions and fumbles lost, and nothing
 * else would carry them.
 */
import type { ScoringSettings } from "./scoring";

/**
 * ESPN statId -> the key Sleeper would use.
 *
 * Deliberately only the offensive stats a play can be scored from. A league
 * that pays for defensive players would need ids in the 90s and 100s, and
 * inventing them without a league to check against is how you get a number
 * that is confidently wrong.
 */
const STAT_KEY_BY_ID: Record<number, string> = {
  3: "pass_yd",
  4: "pass_td",
  19: "pass_2pt",
  20: "pass_int",
  24: "rush_yd",
  25: "rush_td",
  26: "rush_2pt",
  42: "rec_yd",
  43: "rec_td",
  44: "rec_2pt",
  53: "rec",
  72: "fum_lost",
  74: "fgm_0_19",
  75: "fgm_20_29",
  76: "fgm_30_39",
  77: "fgm_40_49",
  78: "fgm_50p",
  80: "fgm",
  85: "xpmiss",
  86: "xpm",
};

export interface EspnScoringItem {
  statId?: number;
  points?: number;
  /** Rate per ESPN position id, when a league varies the rate by position. */
  pointsOverrides?: Record<string, number>;
}

/**
 * The effective rate for one scoring item.
 *
 * `points` is not enough on its own. Of the four configured leagues, two set
 * every passing rule to `points: 0` and carry the real rate only in
 * `pointsOverrides`, keyed by position id — MONEY TIME pays 0.04 per passing
 * yard as `{"1":0.04,"2":0.04,"3":0.04,"4":0.04,"15":0.04}` and nothing at the
 * top level. Reading `points` alone would have scored every passing yard,
 * passing touchdown and interception in that league at zero, and reported it
 * as fact.
 *
 * Overrides are only usable here when they agree with each other, since this
 * module has no player and therefore no position. In practice the offensive
 * ones always do — the positions listed are just every slot allowed to throw.
 * A rule that genuinely differs by position (the defensive point-allowed
 * tiers) returns null and is left out rather than averaged into something no
 * league actually uses.
 */
export function effectiveRate(item: EspnScoringItem): number | null {
  if (typeof item.points === "number" && item.points !== 0) return item.points;

  const overrides = Object.values(item.pointsOverrides ?? {}).filter(
    (v): v is number => typeof v === "number",
  );
  if (overrides.length === 0) {
    return typeof item.points === "number" ? item.points : null;
  }

  const first = overrides[0];
  return overrides.every((v) => v === first) ? first : null;
}

/**
 * A league's ESPN scoring as named rates, or null when it cannot be read.
 *
 * Null rather than an empty object, because "this league pays nothing for
 * anything" and "we could not read this league's rules" must not look the
 * same to a caller deciding whether to show a number.
 */
export function espnScoringSettings(raw: unknown): ScoringSettings | null {
  const items = (raw as { scoringItems?: EspnScoringItem[] } | null)?.scoringItems;
  if (!Array.isArray(items) || items.length === 0) return null;

  const out: ScoringSettings = {};
  for (const item of items) {
    if (typeof item.statId !== "number") continue;
    const key = STAT_KEY_BY_ID[item.statId];
    if (!key) continue;
    const rate = effectiveRate(item);
    if (rate === null) continue;
    out[key] = rate;
  }

  // A payload that yielded no recognised offensive rule is not scoring we can
  // use, whatever else was in it.
  return Object.keys(out).length === 0 ? null : out;
}
