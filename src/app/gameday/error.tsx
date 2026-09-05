"use client";

/**
 * The game-day error boundary.
 *
 * This route renders two Recharts trees and a lot of upstream-shaped data, so a
 * malformed series or an unexpected null is a real way for the screen to throw
 * mid-render. Without a boundary here that replaces the whole live view with
 * Next's default error page — at exactly the moment the page is worth having.
 *
 * Reset rather than reload, so recovering costs a re-render instead of a fresh
 * server fetch of the whole slate.
 */
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function GamedayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side detail, which Next
    // deliberately withholds from the client in production.
    console.error("[gameday] render failed", error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <div
        className="sc-card"
        style={{ padding: 20, maxWidth: 520, borderColor: "var(--sc-red)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <AlertTriangle size={16} color="var(--sc-red)" />
          <strong>Game day hit an error</strong>
        </div>

        <p className="sc-note">
          The scores themselves are fine — this is the page failing to draw, not the data
          failing to load. Trying again usually clears it.
        </p>

        {error.digest && (
          <p className="sc-note sc-mono" style={{ fontSize: 10 }}>
            {error.digest}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="sc-btn"
            onClick={reset}
            style={{ minHeight: 44, padding: "0 12px", fontSize: 12 }}
          >
            Try again
          </button>
          <Link
            href="/"
            className="sc-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
              padding: "0 12px",
              fontSize: 12,
            }}
          >
            Back to the dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
