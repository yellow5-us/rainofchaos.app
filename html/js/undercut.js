// How a row's list moves (SPEC.md §3.6), from its list reads of the last hour: how fast orders are posted ahead of its
// best price (undercutting) and how fast its orders are bought, for fill times.
export const READS_FOR = 60 * 60 * 1000; // list reads kept and used
export const MIN_GAP = 2 * 60 * 1000; // reads closer than this aren't compared (the same orders, read again)
export const MAX_GAP = 20 * 60 * 1000; // further apart, too much can have come and gone between them
export const MIN_SPAN = 20 * 60 * 1000; // compared time needed before a rate counts
export const MIN_UNDERCUTS = 3; // comparisons with stock ahead needed for a rate: fewer are one-off orders, not a flow
export const MIN_BUYS = 3; // comparisons with stock bought needed for a rate: fewer are too few trades to time

// Ratios [l, r] in the row's order (what's wanted : what's offered): `a` is more competitive than `b` when it asks less
// of what's wanted for each unit offered.
const better = (a, b) => a[0] * b[1] < b[0] * a[1];
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

// reads: [{ at, levels: [{ ratio, stock }] }], oldest first, best price first. Each read compared with the last one
// taken (at least MIN_GAP before it, at most MAX_GAP): `found(earlier, later)` is how much of the offered currency the
// comparison finds. Stock per hour; `few` with fewer than `least` comparisons that found any; null without MIN_SPAN of
// comparisons.
function rate(reads, now, least, few, found) {
  let anchor = null, total = 0, span = 0, hits = 0;
  for (const read of reads) {
    if (now - read.at > READS_FOR || !read.levels.length) continue;
    const gap = anchor ? read.at - anchor.at : 0;
    if (anchor && gap < MIN_GAP) continue;
    if (anchor && gap <= MAX_GAP) {
      const n = found(anchor.levels, read.levels);
      if (n) hits++;
      total += n;
      span += gap;
    }
    anchor = read;
  }
  if (span < MIN_SPAN) return null;
  return hits >= least ? total / (span / 3600000) : few;
}

// Undercutting: the stock now listed at a better price than the earlier read's best came in ahead of an order posted then.
export const undercutRate = (reads, now) => rate(reads, now, MIN_UNDERCUTS, 0, (was, is) =>
  is.filter((l) => better(l.ratio, was[0].ratio)).reduce((sum, l) => sum + l.stock, 0));

// Buying: orders fill best price first, so what was bought is the stock gone from prices still listed, and all of the
// stock at prices better than the best one still listed (or, with none still listed, better than the last one shown: a
// price further down can have dropped off the 5 the list shows). Prices gone from further down were taken down. Not
// measured (null) with fewer than MIN_BUYS comparisons that saw any bought: too few to time.
export const boughtRate = (reads, now) => rate(reads, now, MIN_BUYS, null, (was, is) => {
  const kept = was.find((w) => is.some((l) => same(l.ratio, w.ratio)));
  const edge = kept?.ratio ?? (is.length < 5 ? null : is.at(-1).ratio);
  return was.reduce((sum, w) => {
    const still = is.find((l) => same(l.ratio, w.ratio));
    if (still) return sum + Math.max(w.stock - still.stock, 0);
    return !edge || better(w.ratio, edge) ? sum + w.stock : sum;
  }, 0);
});
