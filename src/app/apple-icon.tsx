import { ImageResponse } from "next/og";

/**
 * iOS home-screen icon.
 *
 * Generated as a PNG rather than shipped as apple-icon.svg: Safari does not
 * render SVG touch icons, and Next silently ignores an SVG at this filename —
 * the icon simply never appears. iOS applies its own corner mask, so the
 * artwork is drawn square.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#10151A",
        }}
      >
        <svg width="180" height="180" viewBox="0 0 180 180">
          <ellipse
            cx="90"
            cy="90"
            rx="56"
            ry="35"
            fill="none"
            stroke="#F2A63D"
            strokeWidth="9"
          />
          <path d="M62 90h56" stroke="#F2A63D" strokeWidth="8" strokeLinecap="round" />
          <path
            d="M76 76v28M90 71v38M104 76v28"
            stroke="#F5F3EE"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    size,
  );
}
