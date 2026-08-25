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
import type { Consistency, Platform } from "@/lib/domain/types";

const PLATFORM_META: Record<Platform, { label: string; color: string }> = {
  sleeper: { label: "Sleeper", color: "#4C9A5B" },
  yahoo: { label: "Yahoo", color: "#6E5BD9" },
  espn: { label: "ESPN", color: "#D9534F" },
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  const meta = PLATFORM_META[platform];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: meta.color,
        border: `1px solid ${meta.color}55`,
        background: `${meta.color}1A`,
        padding: "2px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
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
        fontSize: 11,
        fontWeight: 800,
        color: c,
        border: `1px solid ${c}66`,
        background: `${c}22`,
        padding: "1px 6px",
        borderRadius: 4,
        minWidth: 34,
        textAlign: "center",
        display: "inline-block",
        whiteSpace: "nowrap",
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
        fontSize: 10,
        fontWeight: 700,
        color,
        border: `1px solid ${color}55`,
        background: `${color}1A`,
        padding: "1px 7px",
        borderRadius: 999,
        whiteSpace: "nowrap",
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
