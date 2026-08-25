/**
 * Turning a database failure into something you can act on.
 *
 * Drizzle throws with the message "Failed query: <sql> params: …" and hangs the
 * real Postgres error off `err.cause`. On its own the thrown message tells you
 * which query broke but never why, which is the half that matters — an
 * unmigrated table and a bad password look identical.
 */

interface PgErrorish {
  message?: string;
  code?: string;
  detail?: string;
  hint?: string;
  table?: string;
  routine?: string;
}

/** Postgres error codes worth naming in plain English. */
const CODE_HINTS: Record<string, string> = {
  "42P01": "that table does not exist — run `npm run db:migrate`",
  "42703": "that column does not exist — your schema is behind, run `npm run db:migrate`",
  "42501": "permission denied for that table",
  "28P01": "password authentication failed",
  "3D000": "that database does not exist",
  "08006": "connection failure",
  "08003": "connection already closed",
  ECONNREFUSED: "nothing is listening on that host/port — is Postgres running?",
};

function pgCause(err: unknown): PgErrorish | null {
  const cause = (err as { cause?: unknown })?.cause;
  if (cause && typeof cause === "object") return cause as PgErrorish;
  // postgres.js connection errors surface directly rather than via cause.
  if (err && typeof err === "object" && "code" in err) return err as PgErrorish;
  return null;
}

/**
 * A one-line, actionable description of a database failure.
 * Falls back to the original message when there is nothing better to say.
 */
export function describeDbError(err: unknown): string {
  const cause = pgCause(err);
  const base = err instanceof Error ? err.message : String(err);

  if (!cause) return base;

  const parts: string[] = [];
  if (cause.message) parts.push(cause.message);

  if (cause.code) {
    const hint = CODE_HINTS[cause.code];
    parts.push(hint ? `[${cause.code}: ${hint}]` : `[${cause.code}]`);
  }
  if (cause.detail) parts.push(cause.detail);

  return parts.length > 0 ? parts.join(" ") : base;
}

/** True when the failure is "this relation/column is not there yet". */
export function isMissingRelation(err: unknown): boolean {
  const code = pgCause(err)?.code;
  return code === "42P01" || code === "42703";
}
