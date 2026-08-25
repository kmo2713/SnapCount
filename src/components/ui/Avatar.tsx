"use client";

/**
 * Team / league / manager avatar.
 *
 * Deliberately a plain <img> rather than next/image: these are 20-40px thumbs
 * already served from Sleeper's CDN at thumbnail size, so Next's optimizer adds
 * nothing but latency — and on Vercel's Hobby tier image optimizations are a
 * metered resource worth not spending on 100 tiny avatars per page.
 *
 * Coverage is good but not total (a handful of Sleeper rosters have no avatar),
 * so there is always an initials fallback rather than a broken-image icon.
 */
import { useState } from "react";

/** Stable colour per name, so the same team always gets the same chip. */
const FALLBACK_COLORS = [
  "#4C9A5B",
  "#3D8BF2",
  "#C9A63D",
  "#9B7BD9",
  "#6EC6CA",
  "#E2725B",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** First letters of the first two words — "Cash Money Crew" -> "CM". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function Avatar({
  src,
  name,
  size = 28,
  rounded = "circle",
  title,
}: {
  src: string | null | undefined;
  /** Used for the initials fallback and the alt text. */
  name: string;
  size?: number;
  /** Leagues read better as squircles, teams and people as circles. */
  rounded?: "circle" | "square";
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  const radius = rounded === "circle" ? "50%" : Math.round(size * 0.24);

  const shared = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    display: "block" as const,
  };

  if (!src || failed) {
    const color = FALLBACK_COLORS[hashString(name) % FALLBACK_COLORS.length];
    return (
      <span
        aria-hidden="true"
        title={title ?? name}
        style={{
          ...shared,
          background: `${color}26`,
          border: `1px solid ${color}66`,
          color,
          fontSize: Math.max(9, Math.round(size * 0.38)),
          fontWeight: 700,
          lineHeight: `${size - 2}px`,
          textAlign: "center",
          letterSpacing: 0.2,
        }}
      >
        {initials(name)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      title={title ?? name}
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{
        ...shared,
        objectFit: "cover",
        background: "var(--sc-surface-raised)",
        border: "1px solid var(--sc-border)",
      }}
    />
  );
}
