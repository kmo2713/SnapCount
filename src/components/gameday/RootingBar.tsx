"use client";

/**
 * Where to look.
 *
 * This is the feature the whole page is built around, and it only works
 * because nine leagues are in one place. Your 75 starter slots span 31 of the
 * 32 NFL teams and your opponents' span 29, so nearly every game has something
 * of yours and something against you in it. Nobody holds that in their head.
 *
 * Two consequences of that spread shape this component, and both were found by
 * running the real numbers rather than reasoning about them:
 *
 *  - **"Root for GB" is usually unanswerable.** With players on both sides of
 *    most games there is no side to name, so `rootFor` comes back null far more
 *    often than not. The tile therefore leads with direction and magnitude and
 *    treats a named side as a bonus, not as the headline.
 *  - **Nearly every game is technically "conflicted".** A flag that fires on
 *    every card carries no signal, so it is shown only when the opposing pull
 *    is big enough to change how you would feel about the game — see
 *    CONFLICT_SHARE.
 */
import { fmt } from "@/components/ui/primitives";
import type { NflGame, RootingInterest, RootingMode } from "@/lib/domain/gameday";

/**
 * How much of a game's total pull must run the *other* way before it is worth
 * calling conflicted.
 *
 * With a lineup this spread, a token opposing contribution is the normal case
 * rather than the interesting one. A third is the point where the game stops
 * being "good for you with a caveat" and starts being genuinely split.
 */
const CONFLICT_SHARE = 0.33;

function isMeaningfullyConflicted(interest: RootingInterest): boolean {
  if (!interest.conflicted) return false;

  let helps = 0;
  let hurts = 0;
  for (const c of interest.contributions) {
    if (c.net > 0) helps += c.net;
    else hurts += -c.net;
  }

  const total = helps + hurts;
  if (total <= 0) return false;
  return Math.min(helps, hurts) / total >= CONFLICT_SHARE;
}

export function RootingBar({
  rooting,
  games,
  mode,
  onMode,
}: {
  rooting: RootingInterest[];
  games: Map<string, NflGame>;
  mode: RootingMode;
  onMode: (m: RootingMode) => void;
}) {
  return (
    <div className="sc-gameday-rooting">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 6,
          flexWrap: "wrap",
        }}
      >
        <span className="sc-section-title">Where to look</span>
        <span className="sc-note" style={{ margin: 0, fontSize: 11 }}>
          {mode === "leverage"
            ? "weighted by how much a point moves each league — a model, not a prediction"
            : "raw projected point swing, unweighted"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {(["leverage", "raw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="sc-btn"
              onClick={() => onMode(m)}
              aria-pressed={mode === m}
              style={{
                fontSize: 11,
                minHeight: 44,
                padding: "0 10px",
                color: mode === m ? "var(--sc-accent)" : undefined,
                borderColor: mode === m ? "var(--sc-accent-border)" : undefined,
              }}
            >
              {m === "leverage" ? "Leverage" : "Raw points"}
            </button>
          ))}
        </div>
      </div>

      {rooting.length === 0 ? (
        <div className="sc-note" style={{ margin: 0 }}>
          None of your players are in this week&apos;s games.
        </div>
      ) : (
        <div
          className="sc-gameday-strip"
          tabIndex={0}
          role="group"
          aria-label="Games by rooting interest"
        >
          {rooting.map((r) => (
            <RootingTile
              key={r.eventId}
              interest={r}
              game={games.get(r.eventId)}
              mode={mode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RootingTile({
  interest,
  game,
  mode,
}: {
  interest: RootingInterest;
  game: NflGame | undefined;
  mode: RootingMode;
}) {
  const color =
    interest.direction === "for"
      ? "var(--sc-green)"
      : interest.direction === "against"
        ? "var(--sc-red)"
        : "var(--sc-text-muted)";

  const conflicted = isMeaningfullyConflicted(interest);

  /*
   * Emphasis tracks strength rather than size. A slate where six games matter
   * a lot should not be six shouting cards — the border earns attention only
   * for the games at the top of the order.
   */
  const emphasised = interest.strength > 0.6;

  const value =
    mode === "raw"
      ? `${interest.net > 0 ? "+" : ""}${fmt(interest.net, 0)}`
      : `${interest.net > 0 ? "+" : ""}${fmt(interest.net * 100, 1)}`;

  const leagues = interest.contributions.length;

  return (
    <div
      className="sc-card"
      style={{
        padding: "8px 10px",
        minWidth: 138,
        borderColor: emphasised ? color : "var(--sc-border)",
      }}
      title={
        interest.contributions.length > 0
          ? interest.contributions
              .map((c) => `${c.leagueName}: ${c.net > 0 ? "+" : ""}${fmt(c.net, 2)}`)
              .join("\n")
          : undefined
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>
          {game?.shortName ?? interest.eventId}
        </span>
        {game?.state === "in" && (
          <span
            role="img"
            aria-label="live"
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--sc-red)",
              flexShrink: 0,
            }}
          />
        )}
      </div>

      <div className="sc-mono" style={{ fontSize: 16, fontWeight: 700, color }}>
        {value}
      </div>

      <div style={{ fontSize: 10, color: "var(--sc-text-muted)" }}>
        {mode === "raw" ? "proj pts" : "win %"} · {leagues} {leagues === 1 ? "league" : "leagues"}
      </div>

      {/*
        A named side when there is one. With players on both sides of most
        games there usually is not, and saying nothing is better than saying
        something wrong.
      */}
      {interest.rootFor && (
        <div style={{ fontSize: 10, color, fontWeight: 700 }}>root {interest.rootFor}</div>
      )}

      {conflicted && (
        <div style={{ fontSize: 9, color: "var(--sc-orange)", marginTop: 2 }}>
          pulls both ways
        </div>
      )}
    </div>
  );
}
