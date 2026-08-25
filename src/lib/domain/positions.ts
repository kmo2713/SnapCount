/**
 * Position + lineup-slot vocabulary.
 *
 * The prototype only knew QB/RB/WR/TE/FLEX/K/DEF. Real leagues in this account
 * also run SUPER_FLEX, WRRB_FLEX and IDP slots, so the ordering and colour maps
 * are widened here and everything unknown falls back to a neutral grey rather
 * than rendering blank.
 */

export const POSITION_COLORS: Record<string, string> = {
  QB: "#E2725B",
  RB: "#4C9A5B",
  WR: "#3D8BF2",
  TE: "#C9A63D",
  K: "#6EC6CA",
  DEF: "#9B7BD9",
  DST: "#9B7BD9",
  FLEX: "#9B7BD9",
  SUPER_FLEX: "#C77DD9",
  WRRB_FLEX: "#7B8FD9",
  REC_FLEX: "#7B8FD9",
  IDP_FLEX: "#8B95A1",
  DL: "#8B95A1",
  LB: "#8B95A1",
  DB: "#8B95A1",
  BN: "#5B6472",
};

export function posColor(pos: string | null | undefined): string {
  if (!pos) return "#5B6472";
  return POSITION_COLORS[pos] ?? "#5B6472";
}

/** Human labels for slots whose wire names are unfriendly. */
export const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SFLX",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  IDP_FLEX: "IDP",
  DEF: "DST",
};

export function slotLabel(slot: string | null | undefined): string {
  if (!slot) return "—";
  return SLOT_LABELS[slot] ?? slot;
}

/** Display order for lineup slots and positions. */
const POSITION_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "WRRB_FLEX",
  "REC_FLEX",
  "FLEX",
  "SUPER_FLEX",
  "K",
  "DEF",
  "DST",
  "DL",
  "LB",
  "DB",
  "IDP_FLEX",
  "BN",
];

export function positionRank(pos: string | null | undefined): number {
  if (!pos) return 99;
  const i = POSITION_ORDER.indexOf(pos);
  return i === -1 ? 98 : i;
}

/**
 * Sorts by lineup slot when present, falling back to the player's own position.
 * Starters keep their league-defined order (slotIndex) so a lineup reads the
 * way it does inside Sleeper.
 */
export function sortByPosition<
  T extends {
    position: string;
    slotPosition?: string | null;
    slotIndex?: number | null;
  },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aIdx = a.slotIndex ?? null;
    const bIdx = b.slotIndex ?? null;
    if (aIdx !== null && bIdx !== null && aIdx !== bIdx) return aIdx - bIdx;
    const byPos = positionRank(a.slotPosition ?? a.position) -
      positionRank(b.slotPosition ?? b.position);
    if (byPos !== 0) return byPos;
    return positionRank(a.position) - positionRank(b.position);
  });
}

/** Roster slots that are not part of the starting lineup. */
const NON_STARTING_SLOTS = new Set(["BN", "IR", "TAXI"]);

/** Filters a league's roster_positions down to just its starting slots. */
export function startingSlots(rosterPositions: string[] | null | undefined): string[] {
  return (rosterPositions ?? []).filter((p) => !NON_STARTING_SLOTS.has(p));
}

/** Positions the grade calculation covers. IDP and K are too noisy to grade. */
export const GRADE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type GradePosition = (typeof GRADE_POSITIONS)[number];

export const GRADE_COLOR: Record<string, string> = {
  A: "#4C9A5B",
  B: "#6EC6CA",
  C: "#F2A63D",
  D: "#E2725B",
  F: "#D9534F",
};

/** Injury statuses that mean "not simply active". */
export const INJURY_SEVERITY: Record<string, number> = {
  Out: 5,
  IR: 4,
  Doubtful: 3,
  PUP: 3,
  Sus: 2,
  Questionable: 1,
  NA: 1,
};

export function isConcerning(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.trim();
  return s !== "" && s !== "Active";
}
