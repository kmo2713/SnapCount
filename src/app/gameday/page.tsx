import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { GamedayShell } from "@/components/gameday/GamedayShell";
import { loadGameday } from "@/lib/data/gameday";

/**
 * The live game-day screen.
 *
 * Server-rendered once so the page arrives with scores already on it, then the
 * client takes over polling. Loading it client-side instead would mean opening
 * the app at noon to a spinner, which is the one moment this page exists for.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gameday",
};

export default async function GamedayPage() {
  // Same split as the root page: the load is what can fail, rendering is not,
  // so the JSX stays outside the try where a catch could never see it anyway.
  let data;
  try {
    data = await loadGameday();
  } catch (err) {
    return <LoadError message={err instanceof Error ? err.message : String(err)} />;
  }

  return <GamedayShell initialData={data} />;
}

function LoadError({ message }: { message: string }) {
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
      <div className="sc-card" style={{ padding: 20, maxWidth: 520, borderColor: "var(--sc-red)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <AlertTriangle size={16} color="var(--sc-red)" />
          <strong>Game day could not load</strong>
        </div>
        <p className="sc-note">{message}</p>
        <p className="sc-note">
          Scores are fetched live, but rosters and projections come from the synced cache —
          so this needs a database with a completed sync behind it. Try{" "}
          <code>npm run sync</code>, then reload.
        </p>
        <Link
          href="/"
          className="sc-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            padding: "0 12px",
            marginTop: 10,
            fontSize: 12,
          }}
        >
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
