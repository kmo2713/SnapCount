/**
 * The ESPN -> canonical player crosswalk.
 *
 * The schema notes assume Sleeper's `espn_id` solves cross-platform identity.
 * Measured against the live dump it does not: Sleeper stopped populating that
 * field for players entering the league around 2021, so it covers only about a
 * third of the top 200 and none of the 32 team defenses. Bijan Robinson,
 * Ja'Marr Chase and Puka Nacua all have a null `espn_id`; Christian McCaffrey
 * and Josh Allen have one. Anything built on the id alone would silently drop
 * exactly the players who matter most.
 *
 * So identity is resolved in tiers, most trustworthy first, and every tier
 * requires a *unique* candidate — an ambiguous match is reported as unmatched
 * rather than guessed at, because a wrong crosswalk row is far worse than a
 * missing one. It shows up as somebody else's player on your roster.
 */
import { normalizeEspnAbbr } from "@/lib/platforms/nfl/schedule";
import type { EspnPlayer, EspnProTeam } from "./types";

/**
 * ESPN's `defaultPositionId`. Derived by cross-tabulating the ~5.3k players
 * where Sleeper's `espn_id` is present and correct, not from documentation —
 * ESPN publishes none. Ids 9-13 blur across the defensive front (both 9 and 10
 * return a mix of DE and DT), which is why they collapse to one IDP group
 * below rather than pretending to be exact.
 */
export const POSITION_BY_ID: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  7: "P",
  9: "DL",
  10: "DL",
  11: "LB",
  12: "DB",
  13: "DB",
  14: "HC",
  15: "TQB",
  16: "DEF",
};

/**
 * ESPN entities Sleeper has no equivalent for: head coaches ("Rams Coach") and
 * team QBs ("Falcons TQB"). No amount of name matching will find these a
 * canonical player, because none exists — they have to be created.
 *
 * This is not hypothetical. The MONEY TIME league starts a head coach in slot
 * 19 every week, so treating them as ordinary misses would leave a starting
 * lineup slot permanently blank.
 */
const ESPN_ONLY_POSITIONS = new Set([14, 15]);

/**
 * ESPN's `lineupSlotId`, which is a *different* enumeration from
 * `defaultPositionId` above — D/ST is position 16 and slot 16, but a kicker is
 * position 5 and slot 17. Verified by cross-tabulating who actually occupies
 * each slot across both leagues: slot 23 held only RBs and WRs, and slot 19
 * held nothing but head coaches.
 *
 * Snap Count's domain model wants slot *labels*, and `startingSlots()` already
 * understands Sleeper's spelling, so these map onto that vocabulary rather
 * than inventing a second one.
 */
export const LINEUP_SLOT: Record<number, string> = {
  0: "QB",
  2: "RB",
  3: "RB_WR",
  4: "WR",
  5: "WR_TE",
  6: "TE",
  7: "OP",
  16: "DEF",
  17: "K",
  18: "P",
  19: "HC",
  20: "BN",
  21: "IR",
  23: "FLEX",
};

/** Slots that are not part of the starting lineup. */
export const BENCH_SLOTS = new Set([20, 21]);

/** Coarse buckets that both platforms agree on. */
type PositionGroup = "QB" | "RB" | "WR" | "TE" | "K" | "DEF" | "IDP" | "OTHER";

const SLEEPER_GROUP: Record<string, PositionGroup> = {
  QB: "QB",
  RB: "RB",
  FB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DEF",
  DST: "DEF",
  DL: "IDP",
  DE: "IDP",
  DT: "IDP",
  NT: "IDP",
  LB: "IDP",
  OLB: "IDP",
  ILB: "IDP",
  MLB: "IDP",
  CB: "IDP",
  S: "IDP",
  SS: "IDP",
  FS: "IDP",
  DB: "IDP",
};

const ESPN_GROUP: Record<number, PositionGroup> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  9: "IDP",
  10: "IDP",
  11: "IDP",
  12: "IDP",
  13: "IDP",
  16: "DEF",
};

/**
 * Positions neither platform treats as fantasy-relevant (offensive line,
 * punters, long snappers) fall through to OTHER, which is compatible with
 * anything — there is no value in blocking a confident name match over a
 * position label nobody scores.
 */
function compatible(espnPositionId: number, sleeperPosition: string | null): boolean {
  const a = ESPN_GROUP[espnPositionId] ?? "OTHER";
  const b = SLEEPER_GROUP[(sleeperPosition ?? "").toUpperCase()] ?? "OTHER";
  return a === b || a === "OTHER" || b === "OTHER";
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Matches how Sleeper builds `search_name`: lowercase, alphanumerics only. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** "Ted Ginn Jr." -> "tedginn", so it meets Sleeper's "Ted Ginn". */
export function nameWithoutSuffix(name: string): string {
  const parts = tokens(name);
  while (parts.length > 2 && NAME_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join("");
}

/** "Charles L. Johnson" -> "charlesjohnson", dropping middle names. */
export function firstLastName(name: string): string {
  const parts = tokens(name).filter((p) => !NAME_SUFFIXES.has(p));
  if (parts.length < 2) return parts.join("");
  return `${parts[0]}${parts[parts.length - 1]}`;
}

/**
 * Surname, for the last-resort tier. "Zonovan Knight" -> "knight".
 *
 * This exists because the two platforms disagree about given names more often
 * than about surnames: ESPN lists "Bam Knight" where Sleeper has "Zonovan
 * Knight", and no amount of normalising the full string reconciles a nickname
 * with a legal first name.
 */
export function lastNameOf(name: string): string {
  const parts = tokens(name).filter((p) => !NAME_SUFFIXES.has(p));
  return parts.length === 0 ? "" : parts[parts.length - 1];
}

export type MatchTier =
  | "espn-id"
  | "team-defense"
  | "name-team"
  | "name"
  | "suffix-name-team"
  | "first-last-team"
  | "surname-team";

export interface CanonicalPlayer {
  id: string;
  fullName: string;
  position: string | null;
  nflTeam: string | null;
  espnId: string | null;
}

export interface UnmatchedEspnPlayer {
  espnPlayerId: string;
  name: string;
  position: string;
  nflTeam: string;
  /** True for QB/RB/WR/TE/K/DEF — the ones a miss actually hurts. */
  fantasyRelevant: boolean;
  /**
   * Share of ESPN leagues rostering this player. The honest severity measure:
   * the universe is full of long-retired players nobody can draft, so a miss
   * at 0% ownership costs nothing and a miss at 40% is a real hole.
   */
  percentOwned: number;
  reason: "ambiguous" | "no-candidate";
}

/** An ESPN-only entity that needs a canonical player row of its own. */
export interface EspnOnlyPlayer {
  espnPlayerId: string;
  name: string;
  /** "HC" or "TQB". */
  position: string;
  nflTeam: string;
}

export interface CrosswalkResult {
  matches: Array<{ espnPlayerId: string; playerId: string; tier: MatchTier }>;
  unmatched: UnmatchedEspnPlayer[];
  /** Rows to create before aliasing; see ESPN_ONLY_POSITIONS. */
  espnOnly: EspnOnlyPlayer[];
  byTier: Record<string, number>;
}

/** Canonical id for an entity that exists only on ESPN. */
export function espnOnlyPlayerId(espnPlayerId: string): string {
  return `espn-${espnPlayerId}`;
}

const FANTASY_GROUPS = new Set<PositionGroup>(["QB", "RB", "WR", "TE", "K", "DEF"]);

/**
 * Resolves ESPN's player universe onto canonical player ids.
 *
 * Every tier below is keyed so that a lookup returns *all* candidates; a key
 * with more than one is discarded as ambiguous. Canonical players are claimed
 * at most once, so a later, weaker tier can never steal a player an earlier
 * one already matched.
 */
export function buildEspnCrosswalk({
  espnPlayers,
  canonical,
  proTeams,
}: {
  espnPlayers: EspnPlayer[];
  canonical: CanonicalPlayer[];
  proTeams: EspnProTeam[];
}): CrosswalkResult {
  // ESPN's spelling, mapped onto ours — "WSH" here is "WAS" in every player
  // row we hold, and keying on the raw value loses the whole franchise.
  const teamAbbr = new Map(
    proTeams.map((t) => [t.id, t.abbrev ? normalizeEspnAbbr(t.abbrev) : ""]),
  );

  const byEspnId = new Map<string, CanonicalPlayer>();
  const byNameTeam = index(canonical, (p) =>
    p.nflTeam ? `${normalizeName(p.fullName)}|${p.nflTeam}` : null,
  );
  const byName = index(canonical, (p) => normalizeName(p.fullName));
  const bySuffixTeam = index(canonical, (p) =>
    p.nflTeam ? `${nameWithoutSuffix(p.fullName)}|${p.nflTeam}` : null,
  );
  const byFirstLastTeam = index(canonical, (p) =>
    p.nflTeam ? `${firstLastName(p.fullName)}|${p.nflTeam}` : null,
  );
  /*
   * Surname plus NFL team plus position. Weak on its own, which is why it runs
   * last and why the usual uniqueness rule still applies: two players sharing
   * a surname, a team and a position are dropped as ambiguous rather than
   * guessed between.
   */
  const bySurnameTeam = index(canonical, (p) =>
    p.nflTeam ? `${lastNameOf(p.fullName)}|${p.nflTeam}` : null,
  );
  /** Team defenses: Sleeper ids them by NFL abbreviation ("BAL"). */
  const defenseByTeam = new Map<string, CanonicalPlayer>();

  for (const p of canonical) {
    if (p.espnId) byEspnId.set(p.espnId, p);
    if ((p.position ?? "").toUpperCase() === "DEF" && p.nflTeam) {
      defenseByTeam.set(p.nflTeam, p);
    }
  }

  const matches: CrosswalkResult["matches"] = [];
  const unmatched: UnmatchedEspnPlayer[] = [];
  const espnOnly: EspnOnlyPlayer[] = [];
  const byTier: Record<string, number> = {};
  const claimed = new Set<string>();

  const take = (espnId: string, player: CanonicalPlayer, tier: MatchTier) => {
    matches.push({ espnPlayerId: espnId, playerId: player.id, tier });
    claimed.add(player.id);
    byTier[tier] = (byTier[tier] ?? 0) + 1;
  };

  /*
   * Order matters, because a canonical player is claimed only once. ESPN
   * sometimes carries the same person twice — "De'Zhaun Stribling" at 40%
   * ownership alongside a dormant "De'Zhaun Ryan Stribling" — and whichever
   * row is seen first takes the canonical id. Working through the universe
   * most-owned first means the row that actually appears on rosters wins, and
   * the duplicate is the one left unmatched.
   */
  const ordered = [...espnPlayers].sort(
    (a, b) => (b.ownership?.percentOwned ?? 0) - (a.ownership?.percentOwned ?? 0),
  );

  for (const e of ordered) {
    const espnId = String(e.id);
    const abbr = teamAbbr.get(e.proTeamId) ?? "";
    const position = POSITION_BY_ID[e.defaultPositionId] ?? "";
    const name = displayName(e);

    // ESPN's universe carries a few nameless placeholder rows. Nothing can be
    // matched on, and nothing is lost by skipping them.
    if (!name) {
      unmatched.push(miss(espnId, e, position, abbr, "no-candidate"));
      continue;
    }

    /* 0. Head coaches and team QBs exist only on ESPN. Nothing to match. */
    if (ESPN_ONLY_POSITIONS.has(e.defaultPositionId)) {
      espnOnly.push({ espnPlayerId: espnId, name, position, nflTeam: abbr });
      continue;
    }

    /* 1. Sleeper already told us, and the position agrees. */
    const byId = byEspnId.get(espnId);
    if (byId && !claimed.has(byId.id) && compatible(e.defaultPositionId, byId.position)) {
      take(espnId, byId, "espn-id");
      continue;
    }

    /* 2. Team defenses resolve by NFL team, never by name — ESPN calls them
          "Falcons D/ST" and Sleeper "Atlanta Falcons". */
    if (e.defaultPositionId === 16) {
      const def = abbr ? defenseByTeam.get(abbr) : undefined;
      if (def && !claimed.has(def.id)) {
        take(espnId, def, "team-defense");
      } else {
        unmatched.push(miss(espnId, e, position, abbr, "no-candidate"));
      }
      continue;
    }

    const attempts: Array<[MatchTier, CanonicalPlayer[] | undefined]> = [
      ["name-team", abbr ? byNameTeam.get(`${normalizeName(name)}|${abbr}`) : undefined],
      ["name", byName.get(normalizeName(name))],
      [
        "suffix-name-team",
        abbr ? bySuffixTeam.get(`${nameWithoutSuffix(name)}|${abbr}`) : undefined,
      ],
      [
        "first-last-team",
        abbr ? byFirstLastTeam.get(`${firstLastName(name)}|${abbr}`) : undefined,
      ],
      ["surname-team", abbr ? bySurnameTeam.get(`${lastNameOf(name)}|${abbr}`) : undefined],
    ];

    let matched = false;
    let sawAmbiguity = false;

    for (const [tier, candidates] of attempts) {
      if (!candidates) continue;
      const viable = candidates.filter(
        (c) => !claimed.has(c.id) && compatible(e.defaultPositionId, c.position),
      );
      if (viable.length === 0) continue;
      if (viable.length > 1) {
        sawAmbiguity = true;
        continue;
      }
      take(espnId, viable[0], tier);
      matched = true;
      break;
    }

    if (!matched) {
      unmatched.push(
        miss(espnId, e, position, abbr, sawAmbiguity ? "ambiguous" : "no-candidate"),
      );
    }
  }

  return { matches, unmatched, espnOnly, byTier };
}

/** ESPN's own `fullName` when it has one, else the name parts it does have. */
function displayName(e: EspnPlayer): string {
  const full = e.fullName?.trim();
  if (full) return full;
  return [e.firstName, e.lastName].filter(Boolean).join(" ").trim();
}

function miss(
  espnPlayerId: string,
  e: EspnPlayer,
  position: string,
  nflTeam: string,
  reason: UnmatchedEspnPlayer["reason"],
): UnmatchedEspnPlayer {
  return {
    espnPlayerId,
    name: displayName(e),
    position,
    nflTeam,
    fantasyRelevant: FANTASY_GROUPS.has(ESPN_GROUP[e.defaultPositionId] ?? "OTHER"),
    percentOwned: e.ownership?.percentOwned ?? 0,
    reason,
  };
}

function index<T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}
