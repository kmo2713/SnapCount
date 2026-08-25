import { AlertTriangle } from "lucide-react";

import { Dashboard } from "@/components/Dashboard";
import { loadDashboard } from "@/lib/data/dashboard";

/**
 * Data is fetched on the server on every request; the cache-aside layer decides
 * whether that means a Postgres read or a live Sleeper call.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  try {
    const data = await loadDashboard();
    return <Dashboard initialData={data} />;
  } catch (err) {
    return <StartupError message={err instanceof Error ? err.message : String(err)} />;
  }
}

/** Shown when we could not load anything at all — usually a config problem. */
function StartupError({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        padding: 24,
      }}
    >
      <div
        className="sc-card"
        style={{ padding: 24, maxWidth: 560, borderColor: "var(--sc-red)" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <AlertTriangle size={18} color="var(--sc-red)" />
          <span className="sc-wordmark" style={{ fontSize: 18 }}>
            Snap Count could not start
          </span>
        </div>
        <p style={{ fontSize: 13, color: "var(--sc-text-muted)", lineHeight: 1.6 }}>
          {message}
        </p>
        <p style={{ fontSize: 13, color: "var(--sc-text-muted)", lineHeight: 1.6 }}>
          Check <code>SLEEPER_USERNAME</code> and <code>DATABASE_URL</code> in{" "}
          <code>.env.local</code>, then reload. Snap Count runs without a database
          — it just falls back to calling Sleeper directly on every page load.
        </p>
      </div>
    </div>
  );
}
