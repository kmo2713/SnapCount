import { ImageResponse } from "next/og";

/**
 * Link-preview card, rendered at request time by Next's OG image runtime.
 *
 * Uses the same "under the lights" palette as the app so a shared link looks
 * like the thing it opens. Deliberately static — no live scores — because OG
 * images are cached aggressively by every platform that scrapes them, and a
 * stale scoreline would be worse than none.
 */
export const alt = "Snap Count — all your fantasy teams, one screen";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#10151A",
          padding: 80,
          // The OG runtime has no access to our CSS custom properties, so the
          // palette is repeated literally here.
          color: "#F5F3EE",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="96" height="96" viewBox="0 0 64 64">
            <ellipse
              cx="32"
              cy="32"
              rx="20"
              ry="12.5"
              fill="none"
              stroke="#F2A63D"
              strokeWidth="3.5"
            />
            <path d="M22 32h20" stroke="#F2A63D" strokeWidth="3" strokeLinecap="round" />
            <path
              d="M27 27.5v9M32 26v12M37 27.5v9"
              stroke="#F5F3EE"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              fontSize: 84,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            Snap Count
          </div>
        </div>

        <div style={{ fontSize: 34, color: "#8B95A1", marginTop: 28 }}>
          All your fantasy teams, one screen.
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 48 }}>
          {["Sleeper", "Yahoo", "ESPN"].map((label, i) => (
            <div
              key={label}
              style={{
                display: "flex",
                fontSize: 24,
                fontWeight: 600,
                padding: "10px 24px",
                borderRadius: 999,
                color: i === 0 ? "#4C9A5B" : "#5B6472",
                border: `2px solid ${i === 0 ? "#4C9A5B" : "#2A323B"}`,
                background: i === 0 ? "#4C9A5B22" : "transparent",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
