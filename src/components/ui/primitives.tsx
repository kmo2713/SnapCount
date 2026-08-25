"use client";

/**
 * Shared UI atoms, carried over from the prototype's inline-styled helpers.
 * Colours come from CSS custom properties in globals.css; only genuinely
 * dynamic values (a position's colour, a grade's colour) stay inline.
 */
import type { ReactNode } from "react";
import { AlertTriangle, Loader2, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { posColor, slotLabel } from "@/lib/domain/positions";
import { CONSISTENCY_COLOR } from "@/lib/domain/analytics";
import type { Consistency, LeagueFormat, Platform } from "@/lib/domain/types";

const PLATFORM_META: Record<Platform, { label: string; color: string }> = {
  sleeper: { label: "Sleeper", color: "#4C9A5B" },
  yahoo: { label: "Yahoo", color: "#6E5BD9" },
  espn: { label: "ESPN", color: "#D9534F" },
};

/**
 * Shared pill geometry. `compact` exists for the 210px Teams sidebar, where a
 * full-size pair of badges wraps to a second line.
 */
function badgeStyle(compact: boolean) {
  return {
    // inline-flex + an explicit height keeps the pill its natural size even
    // inside a flex parent that defaults to align-items: stretch, which
    // otherwise stretches it to the height of whatever sits beside it.
    display: "inline-flex" as const,
    alignItems: "center" as const,
    height: compact ? 17 : 22,
    fontSize: compact ? 9 : 11,
    fontWeight: 700,
    letterSpacing: compact ? 0.3 : 0.4,
    textTransform: "uppercase" as const,
    padding: compact ? "0 5px" : "0 8px",
    borderRadius: 999,
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  };
}

export function PlatformBadge({
  platform,
  compact = false,
}: {
  platform: Platform;
  compact?: boolean;
}) {
  const meta = PLATFORM_META[platform];
  return (
    <span
      style={{
        ...badgeStyle(compact),
        color: meta.color,
        border: `1px solid ${meta.color}55`,
        background: `${meta.color}1A`,
      }}
    >
      {meta.label}
    </span>
  );
}

const FORMAT_META: Record<LeagueFormat, { label: string; color: string }> = {
  dynasty: { label: "Dynasty", color: "var(--sc-purple)" },
  keeper: { label: "Keeper", color: "var(--sc-cyan)" },
  redraft: { label: "Redraft", color: "var(--sc-text-muted)" },
  guillotine: { label: "Guillotine", color: "var(--sc-orange)" },
};

/**
 * Dynasty / Keeper / Redraft, read from the league's settings.
 *
 * Renders nothing when the format is unknown rather than defaulting to one —
 * Sleeper reports at least one type beyond the documented three (the guillotine
 * league), and a wrong badge here is worse than no badge, since the whole point
 * is telling at a glance whether a trade costs you next season.
 */
export function FormatBadge({
  format,
  compact = false,
}: {
  format: LeagueFormat | null;
  compact?: boolean;
}) {
  if (!format) return null;
  const meta = FORMAT_META[format];
  return (
    <span
      style={{
        ...badgeStyle(compact),
        color: meta.color,
        border: `1px solid color-mix(in srgb, ${meta.color} 35%, transparent)`,
        background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  );
}

/** Position or lineup-slot chip. */
export function PosTag({ pos }: { pos: string | null | undefined }) {
  const c = posColor(pos);
  return (
    <span
      style={{
        // Same stretch guard as PlatformBadge — these sit in flex rows too.
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 20,
        fontSize: 11,
        fontWeight: 800,
        color: c,
        border: `1px solid ${c}66`,
        background: `${c}22`,
        padding: "0 6px",
        borderRadius: 4,
        minWidth: 34,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {slotLabel(pos)}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "56px 24px",
        color: "var(--sc-text-muted)",
        textAlign: "center",
        gap: 8,
      }}
    >
      <Icon size={28} strokeWidth={1.5} />
      <div style={{ fontWeight: 700, color: "var(--sc-text)", fontSize: 15 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, maxWidth: 380, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "40px 0",
        color: "var(--sc-text-muted)",
        justifyContent: "center",
      }}
    >
      <Loader2 size={18} className="spin" />
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: string | null;
}) {
  return (
    <div className="sc-card" style={{ padding: 14 }}>
      <div className="sc-label" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div className="sc-mono" style={{ fontSize: 22, fontWeight: 700 }}>
        {value}
      </div>
      {sub && (
        <div
          className="sc-truncate"
          style={{ fontSize: 11, color: "var(--sc-text-muted)", marginTop: 2 }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  Out: "var(--sc-red)",
  IR: "var(--sc-red)",
  Doubtful: "var(--sc-orange)",
  PUP: "var(--sc-orange)",
  Sus: "var(--sc-orange)",
  Questionable: "var(--sc-accent)",
  NA: "var(--sc-text-muted)",
};

/** Injury designation. Renders muted "Active" rather than nothing when healthy. */
export function StatusTag({
  status,
  bodyPart,
  withIcon = false,
}: {
  status: string;
  bodyPart?: string | null;
  withIcon?: boolean;
}) {
  if (!status || status === "Active") {
    return (
      <span style={{ color: "var(--sc-text-muted)", fontSize: 12 }}>Active</span>
    );
  }
  const color = STATUS_COLOR[status] ?? "var(--sc-accent)";
  return (
    <span
      title={bodyPart ?? undefined}
      style={{
        color,
        fontSize: 12,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {withIcon && <AlertTriangle size={12} />}
      {status}
    </span>
  );
}

/** Boom / Steady / Volatile, or an honest dash before enough weeks are played. */
export function ConsistencyTag({
  consistency,
  samples,
}: {
  consistency: Consistency | null;
  samples: number;
}) {
  if (!consistency) {
    return (
      <span
        title={
          samples === 0
            ? "No games played yet this season"
            : `Only ${samples} week${samples === 1 ? "" : "s"} of scoring so far`
        }
        style={{ color: "var(--sc-text-muted)", fontSize: 12 }}
      >
        —
      </span>
    );
  }
  const Icon =
    consistency === "Boom"
      ? TrendingUp
      : consistency === "Volatile"
        ? TrendingDown
        : Minus;
  return (
    <span
      title={`Based on ${samples} weeks of scoring`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 700,
        color: CONSISTENCY_COLOR[consistency],
      }}
    >
      <Icon size={12} />
      {consistency}
    </span>
  );
}

/** A player's name plus their owner-assigned nickname, when they have one. */
export function PlayerName({
  name,
  nickname,
}: {
  name: string;
  nickname?: string | null;
}) {
  return (
    <span style={{ fontWeight: 600 }}>
      {name}
      {nickname && (
        <span
          style={{
            marginLeft: 6,
            fontWeight: 400,
            fontSize: 11,
            color: "var(--sc-text-muted)",
          }}
        >
          “{nickname}”
        </span>
      )}
    </span>
  );
}

export function Pill({
  label,
  color,
}: {
  label: string;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 19,
        fontSize: 10,
        fontWeight: 700,
        color,
        border: `1px solid ${color}55`,
        background: `${color}1A`,
        padding: "0 7px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

export function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

/**
 * FAAB amounts. Sleeper stores them as plain integers, but every league in
 * practice talks about them as dollars, and budgets run to four figures — so
 * they get a currency mark and a thousands separator.
 */
export function fmtFaab(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}
