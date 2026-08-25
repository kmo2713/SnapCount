"use client";

/**
 * The Claude analysis panel.
 *
 * Deliberately opt-in: nothing calls the API until the button is pressed. A
 * dashboard with seven leagues would otherwise fire seven analyses on every
 * page load, which is slow and costs real money for answers nobody asked for.
 *
 * The heuristics stay visible above this panel either way — Claude augments
 * them, it does not replace the thing that works without an API key.
 */
import { useCallback, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

import type { LineupAnalysis, TradeAnalysis } from "@/lib/ai/schemas";

type Analysis = LineupAnalysis | TradeAnalysis;

interface AnalysisResponse {
  kind: "lineup" | "trade";
  analysis: Analysis;
  cached: boolean;
  model?: string;
  generatedAt?: string;
  error?: string;
  configured?: boolean;
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "var(--sc-green)",
  medium: "var(--sc-accent)",
  low: "var(--sc-text-muted)",
};

const VERDICT_COLOR: Record<string, string> = {
  accept: "var(--sc-green)",
  decline: "var(--sc-red)",
  counter: "var(--sc-accent)",
  close: "var(--sc-cyan)",
};

export function AnalysisPanel({
  request,
  label = "Ask Claude",
  disabled = false,
  disabledHint,
}: {
  /** Body posted to /api/analysis. Null disables the button. */
  request: Record<string, unknown> | null;
  label?: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const run = useCallback(
    async (refresh: boolean) => {
      if (!request) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/analysis", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...request, refresh }),
        });
        const json = (await res.json()) as AnalysisResponse;
        if (!res.ok) {
          setNotConfigured(json.configured === false);
          throw new Error(json.error ?? `Analysis failed (${res.status})`);
        }
        setResult(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [request],
  );

  const isDisabled = disabled || !request || loading;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          className="sc-btn"
          onClick={() => run(false)}
          disabled={isDisabled}
          title={isDisabled && disabledHint ? disabledHint : undefined}
          style={{
            borderColor: result ? "var(--sc-border)" : "var(--sc-accent-border)",
            color: result ? "var(--sc-text)" : "var(--sc-accent)",
          }}
        >
          {loading ? (
            <RefreshCw size={14} className="spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {loading ? "Thinking…" : result ? "Re-read" : label}
        </button>

        {result && !loading && (
          <button
            className="sc-btn"
            onClick={() => run(true)}
            title="Ignore the cached answer and analyse again"
            style={{ fontSize: 12, padding: "5px 9px" }}
          >
            <RefreshCw size={12} />
            Fresh
          </button>
        )}

        {result?.cached && (
          <span style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
            cached · nothing changed since last read
          </span>
        )}
        {isDisabled && disabledHint && !loading && (
          <span style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
            {disabledHint}
          </span>
        )}
      </div>

      {error && (
        <div
          className="sc-card"
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderColor: "#D9534F44",
            fontSize: 12,
            color: "var(--sc-text-muted)",
            lineHeight: 1.5,
          }}
        >
          {error}
          {notConfigured && (
            <div style={{ marginTop: 6 }}>
              Set <code>ANTHROPIC_API_KEY</code> in your environment to enable
              this. Everything else keeps working without it.
            </div>
          )}
        </div>
      )}

      {result && !error && (
        <div
          className="sc-card"
          style={{
            marginTop: 10,
            padding: 14,
            borderColor: "var(--sc-accent-border)",
          }}
        >
          {result.kind === "lineup" ? (
            <LineupBody analysis={result.analysis as LineupAnalysis} />
          ) : (
            <TradeBody analysis={result.analysis as TradeAnalysis} />
          )}

          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: "1px solid var(--sc-border-soft)",
              fontSize: 10,
              color: "var(--sc-text-muted)",
            }}
          >
            {result.model ?? "claude"} · analysis is advisory; make the change in
            Sleeper
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="sc-label" style={{ marginTop: 12, marginBottom: 6 }}>
      {children}
    </div>
  );
}

function LineupBody({ analysis }: { analysis: LineupAnalysis }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.5 }}>
      <div>{analysis.summary}</div>

      {analysis.recommendations.length > 0 ? (
        <>
          <SectionLabel>Recommended changes</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {analysis.recommendations.map((r, i) => (
              <div
                key={i}
                style={{
                  borderLeft: `2px solid ${CONFIDENCE_COLOR[r.confidence]}`,
                  paddingLeft: 10,
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  Start <span style={{ color: "var(--sc-green)" }}>{r.startPlayer}</span>{" "}
                  over <span style={{ color: "var(--sc-red)" }}>{r.sitPlayer}</span>
                  <span style={{ color: "var(--sc-text-muted)", fontWeight: 400 }}>
                    {" "}
                    at {r.slot}
                  </span>
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: CONFIDENCE_COLOR[r.confidence],
                    }}
                  >
                    {r.confidence}
                  </span>
                </div>
                <div style={{ color: "var(--sc-text-muted)", fontSize: 12 }}>
                  {r.reasoning}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div
          style={{ marginTop: 10, fontSize: 12, color: "var(--sc-green)", fontWeight: 600 }}
        >
          No changes recommended — this lineup is already right.
        </div>
      )}

      {analysis.watchList.length > 0 && (
        <>
          <SectionLabel>Watch this week</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--sc-text-muted)", fontSize: 12 }}>
            {analysis.watchList.map((w, i) => (
              <li key={i}>
                <span style={{ color: "var(--sc-text)", fontWeight: 600 }}>
                  {w.player}
                </span>{" "}
                — {w.concern}
              </li>
            ))}
          </ul>
        </>
      )}

      {analysis.matchupOutlook && (
        <>
          <SectionLabel>Matchup</SectionLabel>
          <div style={{ color: "var(--sc-text-muted)", fontSize: 12 }}>
            {analysis.matchupOutlook}
          </div>
        </>
      )}
    </div>
  );
}

function TradeBody({ analysis }: { analysis: TradeAnalysis }) {
  const color = VERDICT_COLOR[analysis.verdict] ?? "var(--sc-accent)";
  return (
    <div style={{ fontSize: 13, lineHeight: 1.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color,
            border: `1px solid ${color}66`,
            background: `${color}1A`,
            padding: "3px 10px",
            borderRadius: 999,
          }}
        >
          {analysis.verdict}
        </span>
        <span style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>
          {analysis.confidence} confidence
        </span>
      </div>

      <div>{analysis.summary}</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
          marginTop: 12,
        }}
      >
        {analysis.yourGains.length > 0 && (
          <div>
            <div className="sc-label" style={{ color: "var(--sc-green)" }}>
              You gain
            </div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
              {analysis.yourGains.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        )}
        {analysis.yourLosses.length > 0 && (
          <div>
            <div className="sc-label" style={{ color: "var(--sc-red)" }}>
              You give up
            </div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
              {analysis.yourLosses.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {analysis.suggestedCounter && (
        <>
          <SectionLabel>Suggested counter</SectionLabel>
          <div style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>
            {analysis.suggestedCounter}
          </div>
        </>
      )}

      <SectionLabel>Roster impact</SectionLabel>
      <div style={{ fontSize: 12, color: "var(--sc-text-muted)" }}>
        {analysis.rosterImpact}
      </div>
    </div>
  );
}
