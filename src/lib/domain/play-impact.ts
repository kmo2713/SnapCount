/**
 * What one play did to your fantasy week, in points.
 *
 * The drill-in used to annotate a play with the leagues each involved player
 * belonged to, marking "mine" with a plus and "against me" with a minus. That
 * reads as help and harm and is wrong for every play that hurt the player it
 * involved: Drake Maye throwing an interception showed as a minus in the
 * league where you *faced* him, when being on the other side of three
 * interceptions is one of the better things that can happen to you.
 *
 * The fix is not a sign flip. "Did this help me" only has an answer once you
 * know what the play was worth, so this module derives the play's stat line
 * and scores it through each league's own rules. The sign then falls out of
 * the arithmetic, and you get the magnitude for free — which is the number
 * worth showing.
 *
 * ## Why the stat line can be derived at all
 *
 * ESPN's core play feed gives each play a type ("Pass Reception", "Pass
 * Interception Return"), a yardage, and a list of participants with the role
 * each played ("passer", "receiver", "rusher"). Per-participant statistics
 * exist but only as `$ref` links — one HTTP request per participant per play,
 * roughly four hundred requests for one game, which is not an option.
 *
 * So the stat line is reconstructed from type + role + yardage. That sounds
 * approximate and is not: checked against the official box score for every
 * offensive player in a completed game, it reproduced passing, rushing and
 * receiving exactly — Maye 23/33 for 178 and 3 interceptions, all seven
 * rushers, all fifteen receivers.
 *
 * Two things that check taught us, neither of which was obvious:
 *
 *  - **Sacks do not reduce passing yards.** Summing only completions gave
 *    Maye 178, matching the official 178, while he was sacked three times for
 *    ten. So a sack is correctly worth nothing to the quarterback here.
 *  - **A touchdown's receiver is listed twice**, as `receiver` and again as
 *    `scorer`. Counting both gave Jaxon Smith-Njigba 167 receiving yards
 *    against an official 122 — his 45-yard touchdown twice. Every athlete is
 *    therefore reduced to a single role per play before scoring.
 *
 * Anything this model does not recognise returns null rather than zero, so the
 * view can omit the number instead of asserting a play was worth nothing.
 */
import type { ScoringSettings } from "./scoring";

/** A stat line for one athlete from one play, in Sleeper's vocabulary. */
export type PlayStatLine = Record<string, number>;

/** A play reduced to what this model needs, with no ESPN types in sight. */
export interface DerivablePlay {
  /** ESPN's `type.text`, e.g. "Pass Reception". */
  typeText: string;
  /** ESPN's `statYardage`. */
  yards: number | null;
  participants: Array<{ espnId: string; role: string }>;
}

/**
 * Which role wins when ESPN gives one athlete several on the same play.
 *
 * Order matters twice over. `receiver` above `scorer` is what stops a
 * touchdown counting twice, and the doing roles sit above the incidental ones
 * so a quarterback who is also credited as his own `scorer` is still scored as
 * the passer.
 */
const ROLE_PRIORITY = [
  "passer",
  "rusher",
  "receiver",
  "kicker",
  "patScorer",
  "returner",
  "scorer",
  "fumbler",
  "fumbledBy",
] as const;

/**
 * Play types that carry no fantasy consequence for anyone involved.
 *
 * Distinguished from an unrecognised type on purpose: these are *known* to be
 * worth nothing, so a play can honestly be reported as 0.0 rather than
 * omitted. A dropped pass really did cost you nothing.
 */
const NEUTRAL_TYPES = new Set([
  "Pass Incompletion",
  // Measured: passing yards are already net of nothing, so a sack costs the
  // quarterback no fantasy points. See the module comment.
  "Sack",
  "Penalty",
  "Timeout",
  "Official Timeout",
  "Kickoff",
  "Punt",
  "End Period",
  "End of Half",
  "End of Game",
  "Coin Toss",
  "Two-minute warning",
  "Blocked Field Goal",
  "Punt Blocked",
]);

/** Which Sleeper field-goal bucket a distance falls in. */
function fieldGoalKeys(yards: number | null): PlayStatLine {
  const line: PlayStatLine = { fgm: 1 };
  if (yards == null) return line;
  if (yards < 20) line.fgm_0_19 = 1;
  else if (yards < 30) line.fgm_20_29 = 1;
  else if (yards < 40) line.fgm_30_39 = 1;
  else if (yards < 50) line.fgm_40_49 = 1;
  else line.fgm_50p = 1;
  return line;
}

/**
 * The stat line one role earned on one play, or null if unrecognised.
 *
 * Exported for its tests: this is the whole model, and it is the kind of
 * mapping that is easy to get subtly wrong and impossible to notice, since a
 * wrong answer here looks exactly like a surprising play.
 */
export function statsForRole(
  typeText: string,
  role: string,
  yards: number | null,
): PlayStatLine | null {
  const yd = yards ?? 0;

  if (NEUTRAL_TYPES.has(typeText)) return {};

  switch (typeText) {
    case "Pass Reception":
      if (role === "passer") return { pass_yd: yd };
      if (role === "receiver") return { rec: 1, rec_yd: yd };
      return {};

    case "Passing Touchdown":
      if (role === "passer") return { pass_yd: yd, pass_td: 1 };
      if (role === "receiver") return { rec: 1, rec_yd: yd, rec_td: 1 };
      return {};

    case "Rush":
      if (role === "rusher") return { rush_yd: yd };
      return {};

    case "Rushing Touchdown":
      if (role === "rusher") return { rush_yd: yd, rush_td: 1 };
      return {};

    case "Pass Interception Return":
    case "Interception Return Touchdown":
      // The thrower is charged the interception. The defender who caught it
      // scores only in a league that pays for defensive players, which these
      // do not, so he is left at zero rather than guessed at.
      if (role === "passer") return { pass_int: 1 };
      return {};

    case "Field Goal Good":
      if (role === "kicker") return fieldGoalKeys(yd);
      return {};

    case "Field Goal Missed":
      if (role === "kicker") return { fgmiss: 1 };
      return {};

    case "Extra Point Good":
      if (role === "kicker" || role === "patScorer") return { xpm: 1 };
      return {};

    case "Extra Point Missed":
      if (role === "kicker" || role === "patScorer") return { xpmiss: 1 };
      return {};

    default:
      /*
       * Fumbles arrive under several type names — "Fumble Recovery (Own)",
       * "Fumble Recovery (Opponent)" — and only the lost ones cost points.
       * Matched on substring because the parenthetical varies.
       */
      if (typeText.startsWith("Fumble Recovery")) {
        if (typeText.includes("Opponent") && (role === "fumbler" || role === "fumbledBy")) {
          return { fum_lost: 1 };
        }
        return {};
      }
      return null;
  }
}

/**
 * Every athlete's stat line for one play, deduplicated by athlete.
 *
 * Null when the play type is not recognised at all — the caller shows no
 * number rather than a wrong one.
 */
export function statsForPlay(play: DerivablePlay): Map<string, PlayStatLine> | null {
  const chosen = new Map<string, string>();

  for (const participant of play.participants) {
    const existing = chosen.get(participant.espnId);
    if (existing === undefined) {
      chosen.set(participant.espnId, participant.role);
      continue;
    }
    // Keep whichever role ranks higher; an unranked role never displaces one
    // that is ranked.
    const rank = (r: string) => {
      const i = (ROLE_PRIORITY as readonly string[]).indexOf(r);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    if (rank(participant.role) < rank(existing)) {
      chosen.set(participant.espnId, participant.role);
    }
  }

  const out = new Map<string, PlayStatLine>();
  for (const [espnId, role] of chosen) {
    const line = statsForRole(play.typeText, role, play.yards);
    if (line === null) return null;
    out.set(espnId, line);
  }
  return out;
}

/** A stat line scored through one league's rules. */
export function scoreStatLine(
  line: PlayStatLine,
  scoring: ScoringSettings | null | undefined,
): number | null {
  if (!scoring) return null;

  let total = 0;
  for (const [key, value] of Object.entries(line)) {
    const rate = scoring[key];
    if (typeof rate !== "number") continue;
    total += rate * value;
  }
  return total;
}

/**
 * What a play was worth to you in one league, from your side of it.
 *
 * Your starters count positively and the starters facing you count negatively,
 * because a point they score costs you the same as a point you fail to. Both
 * sides in one sum, so a play that involves your quarterback throwing to your
 * opponent's receiver nets out honestly instead of being reported twice with
 * opposite signs.
 */
export function netForLeague(
  statsByAthlete: ReadonlyMap<string, PlayStatLine>,
  sideByAthlete: ReadonlyMap<string, "mine" | "against">,
  scoring: ScoringSettings | null | undefined,
): number | null {
  if (!scoring) return null;

  let net = 0;
  for (const [espnId, line] of statsByAthlete) {
    const side = sideByAthlete.get(espnId);
    if (!side) continue;
    const points = scoreStatLine(line, scoring);
    if (points === null) return null;
    net += side === "mine" ? points : -points;
  }
  /* Kills -0, which renders as "-0.0" and reads as a loss of nothing. */
  return net === 0 ? 0 : net;
}
