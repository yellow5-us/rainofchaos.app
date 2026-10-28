// rates.json: the leagues, and each pair's volumes, stock and prices by window (SPEC.md §5, §6.2–6.3).

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// The game's files (game.js `files`): { rates, catalog, gold }.
export const loadRates = (files) => loadJson(files.rates);
export const loadCatalog = (files) => loadJson(files.catalog);
export const loadGold = (files) => loadJson(files.gold);

export function defaultLeague(rates) {
  const softcore = Object.entries(rates.leagues).filter(([, l]) => l.kind === "challenge-softcore");
  softcore.sort((a, b) => b[1].chaosVolume - a[1].chaosVolume);
  return softcore[0]?.[0] ?? Object.keys(rates.leagues)[0];
}

// The leagues offered in the dropdown, in this order: Standard, Hardcore, the current challenge
// league and its hardcore version ("Hardcore X" in PoE1, "HC X" in PoE2). Only those present in rates.json.
export function listedLeagues(rates) {
  const current = defaultLeague(rates);
  return ["Standard", "Hardcore", current, `Hardcore ${current}`, `HC ${current}`]
    .filter((n, i, all) => rates.leagues[n] && all.indexOf(n) === i);
}

const pairOf = (league, a, b) => league?.pairs[[a, b].sort().join("|")];
const volumeOf = (pair, id) => (pair.a === id ? pair.volA : pair.volB);

// How much of `offered` was on offer against `other` in the latest hour (lowest over the hour), or
// null when the pair wasn't listed then or the file has no stock.
export function stockOn(league, offered, other) {
  const pair = pairOf(league, offered, other);
  if (!pair?.stock) return null;
  return pair.a === offered ? pair.stock[0] : pair.stock[1];
}

// How much of `x` traded against `other` per hour over the job's recent window (last 4 finished hours),
// or null if the pair has no data.
export const RECENT_HOURS = 4;
export function perHourOf(league, x, other) {
  const pair = pairOf(league, x, other);
  if (!pair) return null;
  return (pair.a === x ? pair.recentA : pair.recentB) / RECENT_HOURS;
}

// Amounts of `a` and `b` traded in the pair's latest hour, or null when the pair has no data.
export function pairVolume(league, a, b) {
  const pair = pairOf(league, a, b);
  return pair ? [volumeOf(pair, a), volumeOf(pair, b)] : null;
}

// Units of `b` per unit of `a` the pair usually trades at: over its recent hours, else its last days, else its latest hour
// (null when it hasn't traded).
export function usualPrice(league, a, b) {
  const pair = pairOf(league, a, b);
  if (!pair) return null;
  const [x, y] = pair.a === a ? ["A", "B"] : ["B", "A"];
  const w = ["recent", "day", "vol"].find((k) => pair[k + x] > 0 && pair[k + y] > 0);
  return w ? pair[w + y] / pair[w + x] : null;
}

// Units of `b` per unit of `a` over each window the job keeps that has trades: the latest hour, the recent hours and the
// last days ([] with no data).
export function pairPrices(league, a, b) {
  const pair = pairOf(league, a, b);
  if (!pair) return [];
  const [x, y] = pair.a === a ? ["A", "B"] : ["B", "A"];
  return ["vol", "recent", "day"].map((w) => [pair[w + x], pair[w + y]]).filter(([p, q]) => p > 0 && q > 0).map(([p, q]) => q / p);
}

