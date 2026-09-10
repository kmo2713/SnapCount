/**
 * Which pages of a play feed to fetch when you already have most of them.
 *
 * ESPN's play feed is ~774KB for one finished game. Re-reading thirteen live
 * games every five minutes for seven hours would be several gigabytes for the
 * sake of a few hundred new plays, so the ledger reads only the tail.
 *
 * The feed paginates oldest-first and reports `count` for a 1.7KB request, so
 * "how far behind am I" is cheap to ask. What makes the tail safe to trust is
 * that the ordering is very nearly exact: measured across a finished game, six
 * of 180 plays sat out of sequence and every one was displaced by exactly one
 * position — always a scoring summary beside the play it summarises. A small
 * margin therefore covers the disorder completely.
 */

/** Plays per page. Larger pages mean fewer requests and more waste. */
export const PAGE_SIZE = 50;

/**
 * Extra plays to re-read beyond the apparent gap.
 *
 * Covers three things: the measured one-position disorder, a play ESPN revises
 * after first publishing it, and the case where `count` shrinks because a play
 * was withdrawn. Ten is far more than the observed disorder and costs at most
 * one extra page.
 */
export const MARGIN = 10;

/**
 * The 1-based page numbers to fetch, newest last.
 *
 * Returns an empty list when nothing is missing, which is the common case:
 * most games on a Sunday afternoon are either finished or between plays, and
 * a ledger that knows it is current should make no request at all.
 */
export function pagesToFetch(
  remoteCount: number,
  haveCount: number,
  pageSize = PAGE_SIZE,
  margin = MARGIN,
): number[] {
  if (remoteCount <= 0) return [];

  const pageCount = Math.ceil(remoteCount / pageSize);

  /*
   * A ledger that is level with ESPN needs nothing. Strictly greater-or-equal
   * rather than equal: our count can legitimately exceed the remote one if a
   * play was withdrawn upstream, and that is not a reason to re-read the game.
   */
  if (haveCount >= remoteCount) return [];

  const missing = remoteCount - haveCount + margin;
  const pagesNeeded = Math.min(pageCount, Math.ceil(missing / pageSize));

  const pages: number[] = [];
  for (let page = pageCount - pagesNeeded + 1; page <= pageCount; page++) {
    if (page >= 1) pages.push(page);
  }
  return pages;
}

/**
 * True when a game is worth asking about at all.
 *
 * A game that has not kicked off has no plays, and one whose plays we already
 * hold in full has nothing new — but "finished" is not the test, because the
 * final plays of a game arrive after its state flips to post. The count
 * comparison is the test, and this only decides whether to spend the 1.7KB
 * asking.
 */
export function shouldProbe(state: string): boolean {
  return state === "in" || state === "post";
}
