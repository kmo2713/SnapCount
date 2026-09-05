/**
 * A small in-process rate limiter, for endpoints that spend something.
 *
 * This app has no authentication anywhere and does not want any — it is one
 * person's dashboard. That is fine for reading public NFL scores. It is not
 * fine for the two things a public URL can be made to do here: bill an
 * Anthropic key, and turn one inbound request into ten upstream ones.
 *
 * The memos elsewhere were mistaken for this. They are not the same tool: a
 * memo collapses *identical* work, so it helps a crowd asking one question and
 * does nothing against one caller asking many different ones. Worse, a live
 * scoreboard's memo must expire in seconds, so anything that enumerates a key
 * — `?week=1..18`, or event ids — outruns it by construction. Measured: 54
 * round-robin requests across 18 weeks rebuilt every time with an 18-slot
 * cache, because the 15s TTL expired entries before they were reused. Capacity
 * limits have to be enforced by counting, not by caching.
 *
 * Deliberately per-instance rather than backed by a store. Vercel may run
 * several instances, so the true ceiling is this budget times the instance
 * count — which bounds the damage without adding Redis to a personal project.
 * The failure it prevents is an unbounded loop, and that it does prevent.
 */

interface Bucket {
  /** Tokens remaining in the current window. */
  tokens: number;
  /** When the window resets. */
  resetAt: number;
}

const globalForLimit = globalThis as unknown as {
  snapCountRateLimits?: Map<string, Bucket>;
};

/**
 * How many distinct callers are tracked before the oldest are dropped.
 *
 * Bounded because the key is derived from a request header, which a caller
 * controls — an unbounded map keyed on caller identity is itself the memory
 * leak the limiter is supposed to prevent.
 */
const MAX_TRACKED = 500;

export interface RateLimit {
  allowed: boolean;
  /** Seconds until the window resets — for a Retry-After header. */
  retryAfter: number;
  remaining: number;
}

/**
 * Spends one token from `key`'s budget.
 *
 * Fixed window rather than sliding: the point is a ceiling on cost, and a
 * fixed window is easier to reason about than a rolling one when the thing
 * being limited is money.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimit {
  const existing = globalForLimit.snapCountRateLimits;
  const buckets =
    existing instanceof Map
      ? existing
      : (globalForLimit.snapCountRateLimits = new Map<string, Bucket>());

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { tokens: limit - 1, resetAt: now + windowMs });

    // Evict expired buckets, then the soonest-expiring, to stay bounded.
    if (buckets.size > MAX_TRACKED) {
      for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
      while (buckets.size > MAX_TRACKED) {
        const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)[0];
        if (!oldest) break;
        buckets.delete(oldest[0]);
      }
    }

    return { allowed: true, retryAfter: 0, remaining: limit - 1 };
  }

  if (bucket.tokens <= 0) {
    return {
      allowed: false,
      retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
      remaining: 0,
    };
  }

  bucket.tokens--;
  return { allowed: true, retryAfter: 0, remaining: bucket.tokens };
}

/**
 * Who to charge for a request.
 *
 * `x-forwarded-for` is spoofable, which matters less than it looks: this is a
 * cost ceiling, not an access control, and a caller who rotates the header to
 * dodge it is doing exactly what a caller from many real addresses would do.
 * The per-key budget is the floor; `callerKey("global")` is available where a
 * hard total is wanted regardless of source.
 */
export function callerKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `${scope}:${ip}`;
}
