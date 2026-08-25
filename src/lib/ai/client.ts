import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client for Snap Count's analysis features.
 *
 * Analysis is strictly additive: without an API key the app keeps working and
 * the existing heuristics stay in place. Nothing here is on the page-load path
 * — every call is triggered by an explicit user action, because firing seven
 * league analyses on every dashboard render would be both slow and expensive.
 */

/** Per the project's default: the most capable model, adaptive thinking. */
export const ANALYSIS_MODEL = "claude-opus-5";

const globalForAnthropic = globalThis as unknown as {
  snapCountAnthropic?: Anthropic;
};

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/** Null when no key is configured, so callers can degrade rather than throw. */
export function getAnthropic(): Anthropic | null {
  if (!hasAnthropicKey()) return null;
  if (!globalForAnthropic.snapCountAnthropic) {
    globalForAnthropic.snapCountAnthropic = new Anthropic();
  }
  return globalForAnthropic.snapCountAnthropic;
}

/** Maps SDK errors onto something worth showing a user. */
export function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "ANTHROPIC_API_KEY is invalid or expired.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Anthropic rate limit reached — try again in a moment.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Anthropic rejected the request: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Anthropic API.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic error ${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export { Anthropic };
