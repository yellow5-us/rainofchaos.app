// Pure calculation (SPEC.md §2–3). No DOM, no storage.
import { currencies, DIVINE, goldOf, rowKey } from "./items.js";

// Round half up to `places` decimals, as the game displays ratios.
export function roundHalfUp(x, places = 0) {
  return Number(Math.round(Number(`${x}e${places}`)) + `e-${places}`);
}

// Smallest whole-number pair that displays as the ratio (a, b). Returns [lotLeft, lotRight], not to be changed: each
// ratio's is worked out once.
const lots = new Map();
export function lot([a, b]) {
  if (!(a > 0 && b > 0)) return null;
  const k = `${a}:${b}`;
  if (!lots.has(k)) lots.set(k, findLot(a, b));
  return lots.get(k);
}
function findLot(a, b) {
  const x = Math.max(a, b) / Math.min(a, b);
  const target = roundHalfUp(x, 2);
  for (let n = 1; n <= 1000; n++) {
    const big = roundHalfUp(x * n);
    if (roundHalfUp(big / n, 2) === target) return a >= b ? [big, n] : [n, big];
  }
  return null;
}

export const SLOW = "slow";
export const FAST = "fast";
// Manual: post your own order at the pair's Manual price in that direction (manualOf), which scans don't change.
export const MANUAL = "manual";
// Estimate: post your own order at the pair's estimate (estimateOf), for a pair with no scan.
export const ESTIMATE = "estimate";
// Slow, Manual and Estimate post orders (row recv:give); Fast fills them (row give:recv).
export const posts = (method) => method !== FAST;
// The row a step reads: receiving `recv` for `give` by `method`.
export const rowOf = (method, recv, give) => (posts(method) ? rowKey(recv, give) : rowKey(give, recv));

// Directed rows with no open orders in the latest hour (rates.json noOrders). Row "A>B" is orders
// offering B: read by Fast (Available Trades) it means nothing to fill, so the step can't be relied on; read by Slow
// (Competing Trades) it means nobody else is posting, so the step posts the only order (aloneRatio).
let noOrders = new Set();
export function setNoOrders(rows) {
  noOrders = new Set(rows ?? []);
}

// Stock on offer, from the latest hour: stockOf(x, y) is how much of `x` was listed against `y` (null if
// unknown). An Instant step needs DEPTH_FACTOR times its own size on offer behind the price it uses, or it's "thin":
// Available Trades (Fast) fills orders offering what you receive, so it's the stock of `recv` vs what you receive. A
// Competing step posts its own order, which needs nobody else's stock.
export const DEPTH_FACTOR = 1; // enough stock to cover the order itself
let stockOf = () => null;
export function setStock(fn) {
  stockOf = fn ?? (() => null);
}

// Fill time: how long a step takes at the pair's recent pace. perHour(x, y) is how much of `x` per hour, over the last
// few hours, fills orders like the step's (null if unknown): SIDE_SHARE of what traded against `y`, as a trade fills
// orders on one side of the pair or the other and the digests don't say which, and some of it fills orders posted and
// bought between scans. A route's steps happen one after another, so its time is their sum; a step whose pair had no
// recent trades has no fill time, and nor has its route.
export const SIDE_SHARE = 0.25;
let perHour = () => null;
export function setPerHour(fn) {
  perHour = fn ?? (() => null);
}
// boughtOf(key): how fast a row's orders are bought as measured from its scans (undercut.js), in what they offer (what
// the step gives) per hour; null when not measured. It's the pace of a Competing step when known, and then undercutting
// isn't taken off it: it was measured with the orders posted ahead already in the list.
let boughtOf = () => null;
export function setBought(fn) {
  boughtOf = fn ?? (() => null);
}
// A Competing step's order joins the queue at the pair's most competitive price: aheadOf(key) is the stock already
// posted there as read from the game, in what those orders offer (what the step gives); null when not read.
let aheadOf = () => null;
export function setAhead(fn) {
  aheadOf = fn ?? (() => null);
}
// undercutOf(key): how fast orders are posted at a better price than a row's best (undercut.js), in what those orders
// offer (what the step gives) per hour; null when unknown. Your order falls behind them, so they slow the queue's drain
// (pace less undercutting), down to UNDERCUT_FLOOR of the pace.
export const UNDERCUT_FLOOR = 0.5;
let undercutOf = () => null;
export function setUndercut(fn) {
  undercutOf = fn ?? (() => null);
}
// What drains a Competing queue, in what the step receives per hour: the pace less the undercutting (`undercut`, in what
// the step gives, at `per` received per given), no less than UNDERCUT_FLOOR of the pace.
export const drain = (pace, undercut, per) => Math.max(pace - (undercut ?? 0) * per, UNDERCUT_FLOOR * pace);
// Whether two ratios [l, r] are the same price.
export const sameRatio = (a, b) => Math.abs(a[0] * b[1] - b[0] * a[1]) <= 1e-9 * a[0] * b[1];
// readEmpty(key): the game showed that row with no trades, so it has no price.
let readEmpty = () => false;
export function setReadEmpty(fn) {
  readEmpty = fn ?? (() => false);
}
// usualOf(recv, give): how much of `recv` the pair has traded for each `give` lately (null when it hasn't traded).
let usualOf = () => null;
export function setUsual(fn) {
  usualOf = fn ?? (() => null);
}
// `per` of recv for each give as the game shows a ratio recv:give: two decimals, the smaller side 1.
const shown = (per) => (per >= 1 ? [roundHalfUp(per, 2), 1] : [1, roundHalfUp(1 / per, 2)]);
// A step posting the only order (nobody else posting) asks the pair's usual price; `instant` when the orders on the other
// side already pay that or more: posting there fills them at once.
function aloneRatio(ratios, recv, give) {
  const per = usualOf(recv, give);
  if (!(per > 0)) return null;
  const buyers = ratios[rowKey(give, recv)]; // what they want (give) : what they offer (recv)
  if (buyers && buyers[1] / buyers[0] >= per) return { instant: true };
  return { ratio: shown(per) };
}
// estimateOf(recv, give): how much of `recv` the pair traded for each `give` in its latest hour, when that was recent
// (null otherwise): an Estimate step's price, as the game would show it. manualOf(key): a row's Manual price, typed in
// (SPEC.md §3.2b), or null.
let estimateOf = () => null;
export function setEstimate(fn) {
  estimateOf = fn ?? (() => null);
}
let manualOf = () => null;
export function setManual(fn) {
  manualOf = fn ?? (() => null);
}
// The estimate as a row recv:give (want:have), or null.
export const estimateRatio = (recv, give) => {
  const per = estimateOf(recv, give);
  return per > 0 ? shown(per) : null;
};
// Where a row's price comes from for a kind (SPEC.md §3.2b–c): "manual", its Manual price, else as "estimated": the scan
// (in `ratios`), else the estimate. { value: [l, r] as a row recv:give, from: "manual" | "scan" | "estimate" }, or null.
export function priceSource(ratios, kind, recv, give) {
  const key = rowKey(recv, give), manual = kind === "manual" ? manualOf(key) : null;
  if (manual) return { value: manual, from: "manual" };
  if (ratios[key]) return { value: ratios[key], from: "scan" };
  const estimate = estimateRatio(recv, give);
  return estimate ? { value: estimate, from: "estimate" } : null;
}
export const priceOf = (ratios, kind, recv, give) => priceSource(ratios, kind, recv, give)?.value ?? null;

// Gold for a set of orders receiving `recv`, rounded up per order; null when the fee isn't known.
export function goldCost(recv, orders) {
  const fee = goldOf(recv);
  return fee === null ? null : orders.reduce((sum, o) => sum + Math.ceil(fee * o.received), 0);
}

// The exchange accepts at most this many of a currency on either side of one order.
export const MAX_ORDER = 999_999;

// A price whose exact lot is over MAX_ORDER (1 : 16666.67 is 100 : 1,666,667) is traded in rounded whole-number
// orders instead (SPEC.md §3.2): rounded so they always fill (Available Trades) or top the list (Competing), whatever
// the price behind the two decimals shown (up to 0.005 either way). The rounding falls on the cheap side, the big
// number, so it costs under one unit of it:
//   buying the expensive side: as many whole units as `have` affords at 0.005 more each, paying that rounded up
//     (the rest is extra);
//   buying the cheap side: all of `have`, asking that much at 0.005 less, rounded down.
// `ratio` is want:have as shown; `maxRecv` caps what's received (a book level's stock). Orders of at most
// MAX_ORDER a side; null when even one unit is over it.
const ROUND = 0.005;
function roundedOrders([want, has], have, maxRecv = Infinity) {
  const x = Math.max(want, has) / Math.min(want, has);
  if (x + ROUND > MAX_ORDER) return null;
  const orders = [];
  if (has >= want) {
    // Paying p of what you have for each whole unit you want.
    const p = x + ROUND, perOrder = Math.floor(MAX_ORDER / p);
    for (let left = Math.min(Math.floor(have / p + 1e-9), maxRecv); left > 0;) {
      const w = Math.min(left, perOrder);
      orders.push({ lots: w, received: w, given: Math.ceil(w * p - 1e-9) });
      left -= w;
    }
  } else {
    // Getting r of what you want for each unit you have.
    const r = x - ROUND, perOrder = Math.floor(MAX_ORDER / x);
    for (let left = Math.min(have, Math.floor(maxRecv / r + 1e-9)); left > 0;) {
      const g = Math.min(left, perOrder), got = Math.floor(g * r + 1e-9);
      if (got <= 0) break;
      orders.push({ lots: g, received: got, given: g });
      left -= g;
    }
  }
  return orders;
}

// What's left after the whole lots (less than one) still trades (SPEC.md §3.2): rounded as roundedOrders does, at most
// one unit of the cheap side in the other side's favour, and added to the last order when both sides still fit
// MAX_ORDER (one order to place, whose amounts show a price a hair better for the other side), else an order of its own.
// `ratio` is want:have as shown; `maxRecv` caps what's received. Changes `orders`; returns what it spent.
function topUp(orders, ratio, left, maxRecv = Infinity) {
  const [more] = roundedOrders(ratio, left, maxRecv) ?? [];
  if (!more) return 0;
  const last = orders.at(-1);
  if (last && last.received + more.received <= MAX_ORDER && last.given + more.given <= MAX_ORDER) {
    Object.assign(last, { lots: last.lots + more.lots, received: last.received + more.received, given: last.given + more.given });
  } else {
    orders.push(more);
  }
  return more.given;
}

// Order books read from the game (SPEC.md §3.2a): bookOf(key) is a pair's Available Trades as read, best price
// first, [{ ratio: [l, r] in the key's order, stock: of what you receive }], or null (none, or too old).
let bookOf = () => null;
export function setBooks(fn) {
  bookOf = fn ?? (() => null);
}

// Orders for `fills` ({ lots, received, given } each), merged into as few as fit MAX_ORDER on both sides; a lot
// bigger than that can't trade at all (the caller's tooBig).
function ordersOf(fills) {
  const orders = [];
  let cur = null;
  for (const f of fills) {
    const lotRecv = f.received / f.lots, lotGive = f.given / f.lots;
    for (let left = f.lots; left > 0;) {
      if (!cur) orders.push((cur = { lots: 0, received: 0, given: 0 }));
      const n = Math.min(left, Math.floor((MAX_ORDER - cur.received) / lotRecv), Math.floor((MAX_ORDER - cur.given) / lotGive));
      if (n <= 0) { cur = null; continue; }
      Object.assign(cur, { lots: cur.lots + n, received: cur.received + n * lotRecv, given: cur.given + n * lotGive });
      left -= n;
    }
  }
  return orders;
}

// An Available Trades step from the pair's order book: the price levels taken best first, each at its own price, in
// whole lots of it, a level only once the one before is used up (as the game fills an order priced at the worst
// level it reaches; the rest of what it would give back is refunded). What's entered is that worst level's ratio.
// Every level used up with more to spend: what's on offer is bought, and the rest is the step's extra.
function bookLeg(book, recv, give, have) {
  const fills = [], more = [];
  let left = have, ratio = null, tooBig = false, rounded = false, rest = null;
  for (const [i, level] of book.entries()) {
    const l = lot(level.ratio);
    if (!l) break;
    const [lotGive, lotRecv] = l;
    if (Math.max(lotGive, lotRecv) > MAX_ORDER) {
      // Too big for exact lots: rounded orders at this level's price (want:have is the level's ratio reversed).
      const os = roundedOrders([level.ratio[1], level.ratio[0]], left, level.stock);
      if (!os) { tooBig = i === 0; break; }
      const spent = os.reduce((sum, o) => sum + o.given, 0);
      if (os.length) { more.push(...os); left -= spent; ratio = level.ratio; rounded = true; }
      if (os.reduce((sum, o) => sum + o.received, 0) < level.stock) break; // `have` ran out here
      continue;
    }
    const onOffer = Math.floor(level.stock / lotRecv), afford = Math.floor(left / lotGive);
    const n = Math.min(onOffer, afford);
    if (n > 0) {
      fills.push({ lots: n, received: n * lotRecv, given: n * lotGive });
      left -= n * lotGive;
      ratio = level.ratio;
    }
    // What's left is spent here (less than a lot of it in a top-up): no need of worse prices.
    if (afford <= onOffer) { rest = { level, stock: level.stock - n * lotRecv }; break; }
  }
  const best = lot(book[0].ratio);
  const orders = [...ordersOf(fills), ...more];
  if (rest && topUp(orders, [rest.level.ratio[1], rest.level.ratio[0]], left, rest.stock)) ratio = rest.level.ratio;
  const received = orders.reduce((s, o) => s + o.received, 0), given = orders.reduce((s, o) => s + o.given, 0);
  return {
    noOrders: false, book: true,
    depth: book.reduce((s, b) => s + b.stock, 0),
    fillHours: 0,
    // The book is the truth here, not the hourly stock: what's on offer is bought, and what isn't is extra
    // (never "not enough").
    thin: false,
    recv, give, have, lots: orders.reduce((s, o) => s + o.lots, 0), rounded,
    // The best price's lot (what a lot of this pair is worth, for valuing extras), and what was received.
    lotRecv: best ? best[1] : 0, lotGive: best ? best[0] : 0, received, given, orders,
    ratio: [(ratio ?? book[0].ratio)[1], (ratio ?? book[0].ratio)[0]],
    tooBig,
    extra: have - given,
    gold: goldCost(recv, orders),
  };
}

// One trade: receive `recv`, give `give`, starting with `have` of `give` (SPEC.md §3.2).
// `ratios` maps rowKey -> [left, right] as displayed in game. `pinned`, a ratio as entered (want:have), trades at exactly
// that price instead (a listing's step in progress, posted at it): no order book, no place in the Competing list.
// `queued`, when given, is the stock ahead of a Competing order in what it gives, in place of the row's stock at its best
// price (a posted order's place, which the caller knows). A Manual step has the row's stock ahead of it only when its price
// is the price read. A Manual step is pinned at its row's Manual price, else (none typed yet) the
// Competing price scanned, else the estimate. An Estimate step is priced at the pair's estimate, with nothing ahead of it.
export function leg(ratios, method, recv, give, have, pinned = null, queued = null) {
  const key = rowOf(method, recv, give);
  const read = ratios[key];
  if (method === MANUAL && !pinned) pinned = priceOf(ratios, "manual", recv, give);
  if (pinned) ratios = { [key]: posts(method) ? pinned : [pinned[1], pinned[0]] };
  else if (method === ESTIMATE) ratios = { [key]: estimateRatio(recv, give) };
  let row = ratios[key];
  // Nobody else posting (the game showed no Competing trades, or the latest hour had none): the order is the only one,
  // at the pair's usual price, or it fills the other side's orders when they already pay that.
  const alone = posts(method) && method !== ESTIMATE && !pinned && !row && (readEmpty(key) || noOrders.has(key));
  if (alone) {
    const a = aloneRatio(ratios, recv, give);
    if (!a) return { missing: key };
    if (a.instant) return { ...leg(ratios, FAST, recv, give, have), alone: true };
    row = a.ratio;
  }
  if (!row || !lot(row)) return { missing: key };
  const book = method === FAST && !pinned ? bookOf(key) : null;
  if (book?.length) return bookLeg(book, recv, give, have);
  const bought = posts(method) ? boughtOf(key) : null, undercut = posts(method) && bought == null ? undercutOf(key) : null;
  // The pace in what the step receives per hour, at `per` received per given: its row's measured buying, else the pair's.
  const paceAt = (per) => (bought != null ? bought * per : perHour(recv, give));
  const l = lot(row);
  // Slow row recv:give is (recv per lot, give per lot); Fast row give:recv is the reverse.
  const [lotRecv, lotGive] = posts(method) ? l : [l[1], l[0]];
  // The ratio as entered, oriented want:have (Fast reads its row the other way round).
  const ratio = posts(method) ? row : [row[1], row[0]];
  // Split into orders of at most MAX_ORDER on both sides; a lot bigger than that is traded in rounded orders
  // (roundedOrders), and only a single unit over it can't trade at all.
  const lotsPerOrder = Math.floor(MAX_ORDER / Math.max(lotRecv, lotGive));
  const rounded = lotsPerOrder ? null : roundedOrders(ratio, have);
  const orders = rounded ?? [];
  if (lotsPerOrder) {
    for (let left = Math.floor(have / lotGive); left > 0; left -= lotsPerOrder) {
      const n = Math.min(left, lotsPerOrder);
      orders.push({ lots: n, received: n * lotRecv, given: n * lotGive });
    }
    topUp(orders, ratio, have % lotGive);
  }
  const lots = orders.reduce((s, o) => s + o.lots, 0);
  const received = orders.reduce((s, o) => s + o.received, 0);
  const given = orders.reduce((s, o) => s + o.given, 0);
  const depth = alone ? null : method === FAST ? stockOf(recv, give) : stockOf(give, recv);
  const pace = given ? paceAt(received / given) : perHour(recv, give);
  const ahead = !posts(method) ? 0
    : queued ?? (method === ESTIMATE || (method === MANUAL && !(read && sameRatio(read, row))) ? 0 : aheadOf(key)) ?? 0;
  const size = method === FAST ? received : given;
  return {
    noOrders: noOrders.has(key) && !posts(method),
    alone, // posting the only order, at the pair's usual price
    depth, // stock behind this step's price, in `recv` (Fast) or `give` (Slow) units
    // Available Trades fill existing orders, so they're instant (`thin` covers too little on offer).
    // Competing: the queue ahead at this price (in `recv` at this price) and then this step, at the row's measured
    // buying, or else the pair's pace less the undercutting; null when the pace is unknown or the pair had no recent
    // trades.
    fillHours: received === 0 || method === FAST ? 0 : !(pace > 0) ? null
      : (received + ahead * received / given) / drain(pace, undercut, received / given),
    undercut: method === FAST ? null : undercut, // Competing: orders posted ahead per hour, in `give` units
    bought: method === FAST ? null : bought, // Competing: the row's orders bought per hour as measured, in `give` units
    ahead, // Competing: stock posted ahead of this step's orders, in `give` units
    thin: method === FAST && depth !== null && size > 0 && depth < size * DEPTH_FACTOR, // Available: too little to fill
    recv, give, have, lots, lotRecv, lotGive, received, given, orders, ratio,
    rounded: !!rounded,
    tooBig: !lotsPerOrder && !rounded,
    extra: have - given,
    gold: goldCost(recv, orders),
  };
}

// Routes (SPEC.md §3.1) start and end in `base`, one of the game's hubs. For an item, with H any hub other than
// the base S:
//   S → Item → H → S
//   S → H → Item → S
//   S → Item → S       (the direct route)
// Path of Exile 1 (hubs Chaos, Divine) gets three routes either way: Div mode Div → Item → Chaos → Div,
// Div → Chaos → Item → Div, Div → Item → Div; Chaos mode Chaos → Item → Div → Chaos, Chaos → Div → Item →
// Chaos, Chaos → Item → Chaos. `path(item)` lists the currencies received, in order.
export function routesFor(base) {
  const others = currencies.hubs.filter((h) => h !== base);
  return [
    ...others.map((h) => ({ id: `after:${h}`, path: (item) => [item, h, base] })),
    ...others.map((h) => ({ id: `before:${h}`, path: (item) => [h, item, base] })),
    { id: "direct", path: (item) => [item, base] },
  ];
}

// Full round trip (SPEC.md §3.3–3.4): the trades, and what's left over along the way, kept as it is.
// `perStep` overrides the method for individual steps, keyed by stepKey(recv, give). `fixed[i]`, when given, is step i as
// it was posted (a listing's step in progress or done, SPEC.md §4.6), used in place of the live one. With `estimate`, a
// step with no price scanned is an Estimate step instead (SPEC.md §3.2c), and so is valuing what's left over.
export const stepKey = (recv, give) => `${recv}>${give}`;

export function runRoute(ratios, item, route, method, start, perStep = {}, base = DIVINE, fixed = [], estimate = false) {
  const { hubs, end, sellTo } = currencies;
  const missing = (key) => ({ route, method, base, missing: key, estimate });
  const steps = [];
  const left = new Map(); // currency other than the base -> how much of it is left over, kept
  let have = start, cur = base, kept = 0; // kept: the base left over partway
  for (const recv of route.path(item)) {
    const o = perStep[stepKey(recv, cur)];
    let m = fixed[steps.length]?.method ?? o ?? method;
    let t = fixed[steps.length] ?? leg(ratios, m, recv, cur, have);
    if (t.missing && estimate) {
      m = ESTIMATE;
      t = leg(ratios, m, recv, cur, have);
    }
    if (t.missing) return missing(t.missing);
    // The first trade's extra is simply unspent.
    if (steps.length && t.extra > 0) {
      if (cur === base) kept += t.extra;
      else left.set(cur, (left.get(cur) ?? 0) + t.extra);
    }
    steps.push({ method: m, key: stepKey(recv, cur), ...t });
    have = t.received;
    cur = recv;
  }

  // What's left over is worth something, for ranking only (nothing more is traded): a hub at the ratio of the row
  // converting it to the base would use (an order book's best price is that ratio too); an item at what it would sell
  // for into the sell-to hub (Chaos in PoE1; whole units, so a few may be worth nothing), then that hub's worth.
  // Units of `give` per unit of `recv` at the row's ratio, or the row's key when it has none.
  const rate = (recv, give) => {
    const key = rowOf(method, recv, give), l = ratios[key] && lot(ratios[key]);
    if (l) return { per: posts(method) ? l[1] / l[0] : l[0] / l[1] };
    const e = estimate && estimateRatio(recv, give), el = e && lot(e); // an estimate's row is recv:give
    return el ? { per: el[1] / el[0] } : { missing: key };
  };
  const perBase = {}; // hub -> units per base
  for (const h of hubs) {
    if (h === base) continue;
    const c = rate(base, h);
    if (c.missing) return missing(c.missing);
    perBase[h] = c.per;
  }
  const inBase = (h, n) => (h === base ? n : n / perBase[h]);
  let worth = 0;
  for (const [id, n] of left) {
    if (hubs.includes(id)) {
      worth += inBase(id, n);
      continue;
    }
    let s = leg(ratios, method, sellTo, id, n);
    if (s.missing && estimate) s = leg(ratios, ESTIMATE, sellTo, id, n);
    if (s.missing && readEmpty(s.missing)) continue; // nobody to sell it to: worth nothing
    if (s.missing) return missing(s.missing);
    worth += inBase(sellTo, s.received);
  }
  const spent = steps[0].given;
  const gain = steps.at(-1).received + kept - spent; // in the base (the start currency)
  const value = gain + worth; // in the base
  let perDiv = 1; // base per div
  if (base !== end) {
    const c = rate(end, base);
    if (c.missing) return missing(c.missing);
    perDiv = c.per;
  }
  const rank = value / perDiv; // in div, for sorting
  // The trades happen one after another, so the route's fill time is their sum, unknown when any one's is.
  const fillHours = steps.some((s) => s.fillHours == null) ? null : steps.reduce((sum, s) => sum + s.fillHours, 0);
  return {
    route, method, base, steps,
    unspent: start - spent,
    gain, leftovers: [...left], value,
    // Gold of the steps whose fee is known; goldUnknown means some steps' fees aren't, so it's a minimum.
    gold: steps.reduce((sum, s) => sum + (s.gold ?? 0), 0),
    goldUnknown: steps.some((s) => s.gold === null),
    fillHours,
    // An Instant trade with nothing, or too little, on offer to fill is the one thing that stops a route.
    blocked: steps.some((s) => s.noOrders || s.thin),
    // The starting amount too small for it: the first trade that trades nothing can't afford one unit (not a lot over
    // the cap, nor too little on offer). Such a route isn't one at all (allResults leaves it out).
    unaffordable: (() => { const s = steps.find((x) => !x.lots); return !!s && !s.tooBig && s.have > 0; })(),
    rank,
    gainRank: gain / perDiv, // the gain alone in div: what profit per minute sorts by
  };
}

// One result per route, best first; routes with missing ratios sort last. Every route uses `method`, except steps
// overridden in perStepByRoute[routeId], and with `estimate`, steps with no price scanned (runRoute).
export function allResults(ratios, item, start, method, perStepByRoute = {}, base = DIVINE, estimate = false) {
  // No step trades a currency for itself (SPEC.md §3.1), e.g. Div → Chaos → Chaos → Div when the item is Chaos.
  const routes = routesFor(base).filter((r) => [base, ...r.path(item)].every((x, i, p) => x !== p[i - 1]));
  // A route the starting amount can't afford isn't offered at all (SPEC.md §4.2).
  const results = routes.map((r) => runRoute(ratios, item, r, method, start, perStepByRoute[r.id], base, [], estimate))
    .filter((r) => !r.unaffordable);
  const sortRank = (r) => (r.missing || r.blocked ? -Infinity : r.rank);
  return results.sort((x, y) => (x.missing ? 1 : 0) - (y.missing ? 1 : 0) || sortRank(y) - sortRank(x));
}
