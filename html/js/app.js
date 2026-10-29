// Pages and wiring (SPEC.md §4). Hash routes: #/home (the guide; #/ and no hash go there),
// #/trade-recommendations (Competitive Trading), with /available for Instant Trading and /estimated for Estimated Trading,
// #/item/<id>/<mode>, #/my-listings (Active tab), #/my-listings/completed, #/trade-volumes, #/imported-ratios.
import {
  allResults, drain, ESTIMATE, estimateRatio, FAST, goldCost, leg, MANUAL, MAX_ORDER, roundHalfUp, routesFor, runRoute, sameRatio, setAhead, setBooks,
  rowOf, setBought, setEstimate, setNoOrders, setTyped, setPerHour, setReadEmpty, setStock, setUndercut, setUsual, SIDE_SHARE, SLOW, stepKey as pathKey,
} from "./calc.js";
import {
  catalogNames, currencies, GOLD_ICON, iconUrl, idOfName, isBase, itemOf, itemsIn, nameOf, rowKey, setCatalog,
  setCurrencies, setGold,
} from "./items.js";
import {
  defaultLeague, latestPrice, listedLeagues, loadCatalog, loadGold, loadRates,
  pairPrices, pairVolume,
  perHourOf, stockOn, usualPrice,
} from "./rates.js";
import * as store from "./store.js";
import { boughtRate, undercutRate } from "./undercut.js";
import { game } from "./game.js";

setCurrencies(game);

const $ = (sel) => document.querySelector(sel);

// PoE1 / PoE2, next to the brand: each game has its own address (/poe1, /poe2). Switching opens the other
// game's home page, its own description; the page you were on (e.g. a currency, which may not exist there)
// doesn't carry over. game.js records the game, so / goes to it next time.
$("#game").value = game.id;
$("#game").addEventListener("change", (e) => {
  location.href = `/${e.target.value}#/home`;
});

const main = $("#main");
let rates = null;
let pendingRemoveCompleted = false;
let query = ""; // search box on the Imported Ratios page
const PAGE_SIZE = 40; // long lists show this many matches at a time

// The game's two views of a pair. Available Trades (default view) = fill orders already on the market;
// Competing Trades (Alt held) = post your own order at the competitive price. Then Estimated Trading: Competitive, with a
// pair that has no scan at its estimate (SPEC.md §3.2c). Shown in this order; Competitive is the default.
const MODES = {
  competitive: { method: SLOW, tab: "Competitive Trading" },
  available: { method: FAST, tab: "Instant Trading" },
  estimated: { method: SLOW, estimate: true, tab: "Estimated Trading" },
};
// What a step's Type selector calls each method.
const METHOD_NAMES = { [FAST]: "Instant", [SLOW]: "Competitive", [MANUAL]: "Manual", [ESTIMATE]: "Estimate" };
const DEFAULT_MODE = "competitive";
let editLines = null; // [[a, b], ...] ratio lines open in the dialog
let editingRatio = null; // "listingId|row|side": the Manual listing step's number being typed (side 0 Want, 1 Have)
let editingTyped = null; // "rowKey|side": a number being typed in the price window on My Listings
let resortOnClose = false; // a ratio changed: re-sort the item page's routes once the dialog closes or the import window hides
// Import Market Ratios' state (SPEC.md §4.3, §4.7): { watch } while watching the game (its stream, video, timers and
// readings), else what its status line says ({ note, warn } or { error }), or {} before anything's happened.
let live = {};
let reader = null; // the price reader (js/reader.js), a worker started the first time the game is watched
const CAN_WATCH = !!navigator.mediaDevices?.getDisplayMedia; // screen sharing (SPEC.md §4.7)
const GAME_WINDOW = game.id === "poe1" ? "Path of Exile" : "Path of Exile 2"; // the game window's title, to share
const SHARE_NAME = `Share ${GAME_WINDOW} Screen`; // what the import window's record button does (its hover), asking for it

// ---------- formatting ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (n) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 3 }));
const signed = (n) => (n > 0 ? `+${num(n)}` : num(n));
const signClass = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");

// Currency icon from GGG's CDN (via data/catalog.json). A currency not in the catalog yet, or whose image
// fails to load, gets a generic placeholder; hovering shows its name.
const placeholder = (id) => `<span class="icon unknown" title="${esc(nameOf(id))}" aria-label="${esc(nameOf(id))}">?</span>`;
const PLACEHOLDER_JS = "this.outerHTML='<span class=&quot;'+this.className+' unknown&quot; title=&quot;'+this.title+'&quot;>?</span>'";
const iconImg = (id) =>
  `<img class="icon" src="${esc(iconUrl(id))}" alt="${esc(nameOf(id))}" title="${esc(nameOf(id))}" onerror="${PLACEHOLDER_JS}">`;
const icon = (id) => (iconUrl(id) ? iconImg(id) : placeholder(id));
// Icon standing in for the name (hover shows it).
const iconOnly = icon;
// An icon after a ratio's number (3,096[chaos] : 1[div]): it keeps its gap from the number even first in its cell (CSS .icon.unit).
const unit = (id) => icon(id).replace('class="icon', 'class="icon unit');
// Icon + name whatever the currency, where it names the item (a hub can be one, SPEC.md §4.1).
const titled = (id) => `${icon(id)}${esc(nameOf(id))}`;

// An amount, its currency's icon first ([chaos]3,096). Amounts only appear on item pages, whose heading names the item,
// so every currency is icon-only.
const qty = (n, id) => `${icon(id)}${num(n)}`;

// A result is only worth doing if it gains something; zero and negative results are shown greyed out.
const profitable = (r) => !r.missing && !r.blocked && r.rank > 0;
// In-game wording for a direction with no open orders, by the column/method that reads it.
const noOrdersTag = (available) => `<span class="tag warn">no ${available ? "available" : "competing"} trades</span>`;
// An Instant step whose price has less than its own size on offer behind it.
const thinTag = (s) => `<span class="tag warn" title="Less than this order on offer last hour">only ${num(s.depth)} available</span>`;
// Estimated fill time: "instant" (Available Trades), "< 1 min", "~25 min", "~3.2 h" (rough: "~"), "—" (unknown, as with
// no recent trades).
function fillTime(h) {
  if (h == null) return "—";
  if (h === 0) return "instant";
  if (h < 1 / 60) return "< 1 min";
  return h < 1 ? `~${Math.round(h * 60)} min` : `~${h.toFixed(1)} h`;
}
// How long something took, as fill times are written but exact: "< 1 min", "25 min", "3.2 h".
const took = (h) => (h < 1 / 60 ? "< 1 min" : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
// A Competing step's fill time on hover: what its scans measured that it's worked out from.
function fillTitle(s) {
  const give = esc(nameOf(s.give)), lines = [
    s.bought != null && `Paced by your scans: about ${num(Math.round(s.bought))} ${give} bought an hour`,
    s.undercut > 0 && `Counts orders posted ahead of yours: about ${num(Math.round(s.undercut))} ${give} an hour`,
  ].filter(Boolean);
  return lines.length ? ` title="${lines.join("&#10;")}"` : "";
}
const routeFill = (r) => fillTime(r.fillHours);

// Why a route can't be done (an Instant trade with nothing, or too little, to fill); "" if not.
const blockedTag = (r) => {
  const s = r.steps.find((x) => x.noOrders) ?? r.steps.find((x) => x.thin);
  if (!s) return "";
  return s.noOrders ? noOrdersTag(true) : `<span class="tag warn">not enough available</span>`;
};
// A route stops at a ratio it has no price for: one never read, or one the game showed with no trades.
const emptyIn = (r) => !!ratioOf(r.missing)?.empty;
// What a route missing a price says: which pair, and that the game showed no trades for it, or else `hint` (where to read
// it). One missing an estimate too (Estimated Trading) had no scan and no trades lately.
const missingText = (r, hint = "") => `<p>${missingTag(r)} ${emptyIn(r) ? "The game showed no trades for"
  : r.estimate ? "Not scanned, and no trades in the last hours:" : "Not read from the game yet:"} ${
  r.missing.split(">").map(iconOnly).join(" : ")}.${emptyIn(r) || !hint ? "" : ` ${hint}`}</p>`;
const missingTag = (r) => (emptyIn(r) ? noOrdersTag(r.method === FAST)
  : `<span class="tag warn">${r.estimate ? "no estimate" : "not scanned"}</span>`);
// Tags in table cells go on their own line under the value they're about, so the values stay lined up.
const below = (tag) => (tag ? `<div class="tags-below">${tag}</div>` : "");
// Gold's icon, before its amount as any currency's.
const goldIcon = `<img class="icon" src="${GOLD_ICON}" alt="gold" title="Gold">`;
const goldAmount = (n) => (n == null ? "—" : `${goldIcon}${num(n)}`);
// Route gold total; "> N" when some steps' fees are unknown (N is the known part), "—" if none are known.
const goldTotal = (r) => (!r.goldUnknown ? goldAmount(r.gold) : r.gold ? `&gt; ${goldAmount(r.gold)}` : "—");
// Amounts of several currencies in one place, always in the same order: the hubs from the most valuable (Divine, then
// Chaos, then Exalted in PoE2), then items. Each is [id, html].
const hubFirst = (id) => (isBase(id) ? -currencies.hubs.indexOf(id) : 1);
const inOrder = (parts) => parts.sort(([a], [b]) => hubFirst(a) - hubFirst(b)).map(([, html]) => html).join(" ");
// Profit: the start currency gained (or lost), with what's left over of other currencies, kept as it is
// (+0[div] 416[vivid]; 1[div] +312[chaos]).
const profit = (r) => inOrder([[r.base, `${icon(r.base)}${signed(r.gain)}`], ...r.leftovers.map(([id, n]) => [id, qty(n, id)])]);
// The route as icons: the currency it starts in, then each one received, e.g. [chaos] → [item] → [div].
const routeLabel = (r, item) => [r.base, ...r.route.path(item.id)].map(iconOnly).join(" → ");

// ---------- league / data helpers ----------

const league = () => store.state.league;
// Only prices read from the game (Import Market Ratios) are calculated with (SPEC.md §2).
const ratios = () => store.ratioValues(league());
// What My Listings calculates with: the scans, less those with a newer price typed in (SPEC.md §4.6), whose steps are
// Estimate steps at it.
const listingRatios = () => {
  const out = ratios();
  for (const key of Object.keys(store.leagueState(league()).typed ?? {})) if (typedFor(key)) delete out[key];
  return out;
};
// The hub every route starts in (the Starting Amount toggle) and how much of it.
const baseId = () => store.state.base;
const start = () => store.state.start[baseId()];
// Hub names without " Orb" ("Chaos", "Divine").
const hubName = (id) => nameOf(id).replace(/ Orb$/, "");
const items = () => itemsIn(rates.leagues[league()]);
// What Trade Recommendations lists: every item plus the hubs other than the start currency (SPEC.md §4.1).
const tradeItems = () => [...currencies.hubs.filter((h) => h !== baseId()).map(itemOf), ...items()]
  .sort((x, y) => x.name.localeCompare(y.name));
const noOrderRows = () => new Set(rates.leagues[league()]?.noOrders ?? []);
const matches = (name) => name.toLowerCase().includes(query.trim().toLowerCase());

// A scanned ratio's tag is just how long ago it was read ("<1m", "3m", "2h"), green: a scan is used for SCAN_FOR (store.js),
// then forgotten. The page counts them up every SCAN_TICK and is drawn again when one runs out.
const SCAN_TICK = 15000;
// When a scan was read, for hovering over its age or tag: "Oct 9, 2026, 3:04 PM" in the viewer's own format.
const scanDate = (at) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const age = (at) => {
  const m = Math.floor((Date.now() - at) / 60000);
  return m < 1 ? "<1m" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
};
const verifiedTag = (at, title, href = null) => href
  ? ` <a class="tag verified" href="${href}" title="${title}" data-scan-at="${at}">${age(at)}</a>`
  : ` <span class="tag verified" title="${title}" data-scan-at="${at}">${age(at)}</span>`;
// A price that isn't scanned, at its estimate (SPEC.md §3.2c): muted, outlined. `title` is its hover.
const ESTIMATE_TITLE = "No scan yet: the average of the last hour's trades. Import Market Ratios reads the real price.";
const estimateTag = (title = ESTIMATE_TITLE) => ` <span class="tag estimate" title="${title}">estimate</span>`;
setInterval(() => {
  let old = false;
  for (const el of document.querySelectorAll("[data-scan-at]")) {
    const at = Number(el.dataset.scanAt);
    if (Date.now() - at >= store.SCAN_FOR) old = true;
    else el.textContent = age(at);
  }
  // My Listings' waits count down: drawn again unless a box, a dropdown or a window is open.
  const busy = document.activeElement?.matches("select, input") || $("dialog[open]");
  if (old || (location.hash.startsWith("#/my-listings") && !busy)) render();
}, SCAN_TICK);
// A row's scan while it's in use (render drops older ones).
const ratioOf = (key) => {
  const r = store.leagueState(league()).ratios[key];
  return r && Date.now() - r.verifiedAt < store.SCAN_FOR ? r : undefined;
};
const isScanned = (key) => !!ratioOf(key);
// A row's typed price while it's in use (under SCAN_FOR old) and newer than its scan, else null.
const typedFor = (key) => {
  const t = store.typedOf(league(), key);
  return t && Date.now() - t.at < store.SCAN_FOR && !(ratioOf(key)?.verifiedAt > t.at) ? t.value : null;
};
const MANUAL_TITLE = "Your price, typed in on My Listings";
const manualTag = () => ` <span class="tag estimate" title="${MANUAL_TITLE}">manual</span>`;
const lineScanned = ([a, b]) => isScanned(rowKey(a, b)) || isScanned(rowKey(b, a));
// A ratio's tag: its scan's age, else nothing.
const scanTag = (key, href = null) => (isScanned(key)
  ? verifiedTag(ratioOf(key).verifiedAt, `Scanned ${scanDate(ratioOf(key).verifiedAt)}`, href) : "");
// Every pair among an item and the hubs (vs Chaos, vs Divine, Chaos vs Divine), both ways: every price any of its routes
// uses (its page's tag).
const tradeKeys = (id) => {
  const ids = [...new Set([id, ...currencies.hubs])];
  return ids.flatMap((a, i) => ids.slice(i + 1).flatMap((b) => [rowKey(a, b), rowKey(b, a)]));
};
// The pairs one route trades through, from the starting currency and back, both ways: every price it uses. A route is
// scanned when all of them are (Trade Recommendations' Competitive and Instant Trading); else it's on Estimated Trading.
const routeKeys = (id, route) => {
  const path = [baseId(), ...route.path(id)];
  return path.slice(1).flatMap((b, i) => [rowKey(path[i], b), rowKey(b, path[i])]);
};
// A trade's or route's oldest price, read (`keys`, tradeKeys' or routeKeys'): when (it's that fresh at least) and which
// ratio it is (its tag). at 0 and no key with none read.
const oldestRead = (keys) => keys.reduce((old, key) => {
  const at = ratioOf(key)?.verifiedAt;
  return at != null && (old.key === null || at < old.at) ? { at, key } : old;
}, { at: 0, key: null });
// Hovering it: the pair that ratio is of (hubs first, in the game's order: "Chaos Orb:Vivid Crystallised Lifeforce",
// "Chaos Orb:Divine Orb") and when.
const oldestTitle = (keys) => {
  const { at, key } = oldestRead(keys);
  if (!key) return "";
  const order = (x) => (isBase(x) ? currencies.hubs.indexOf(x) : currencies.hubs.length);
  const pair = key.split(">").sort((x, y) => order(x) - order(y));
  return `${pair.map(nameOf).join(":")} at ${scanDate(at)}`;
};
// A trade's or route's tag: as old as its oldest price, once every one of them is read; in Estimated Trading (`estimate`),
// the estimate tag until then.
const keysTag = (keys, estimate = false) => (keys.every(isScanned) ? verifiedTag(oldestRead(keys).at, esc(oldestTitle(keys)))
  : estimate ? estimateTag("Some prices are the average of the last hour's trades, not a scan") : "");
const tradeTag = (id, estimate) => keysTag(tradeKeys(id), estimate);

// ---------- shared pieces ----------

// An item's volume, beside its name on its page: the hub currency traded last hour in each of the item's hub markets,
// e.g. the chaos traded in its Chaos market + the divines in its Divine market.
function volumeHtml(itemId) {
  const lg = rates.leagues[league()];
  return currencies.hubs.filter((h) => h !== itemId).map((h) => {
    const traded = pairVolume(lg, itemId, h)?.[1];
    return qty(traded ?? 0, h);
  }).join(" + ");
}

// The pair's line as drawn in the ratio tables: item first, or Chaos before Divine.
const lineOf = (x, y) => {
  const [hx, hy] = [currencies.hubs.indexOf(x), currencies.hubs.indexOf(y)];
  if (hx >= 0 && hy >= 0) return hx < hy ? [x, y] : [y, x]; // two hubs: in the game's hub order
  return hx >= 0 ? [y, x] : [x, y];
};

// The ratio a step used, want:have, as a button that shows the pair's prices.
// Beside it, the age of that price's scan, or an Estimate step's estimate tag. A waiting Manual listing step
// (`manual`, its "listingId|row") was typed in, not scanned: it opens no dialog, both its numbers are shaded, each a box
// once clicked, and in the scan tag's place its reset puts it back to the Competing price, or with none scanned the
// estimate (greyed out while it's that).
const stepRow = (s) => rowOf(s.method, s.recv, s.give);
// Where a Manual step's reset goes: the price typed in, else the Competing price scanned, else the estimate.
const resetRatio = (recv, give) => typedFor(rowKey(recv, give)) ?? ratioOf(rowKey(recv, give))?.value ?? estimateRatio(recv, give);
function manualRatio(s, manual) {
  const part = (i) => (editingRatio === `${manual}|${i}`
    ? `<input type="number" min="0" step="any" id="manual-ratio" value="${s.ratio[i]}" aria-label="${i ? "Have" : "Want"}">`
    : `<button type="button" class="manual-edit" data-manual-edit="${manual}|${i}" title="Change">${num(s.ratio[i])}</button>`);
  const scanned = ratioOf(rowKey(s.recv, s.give))?.value, back = resetRatio(s.recv, s.give), off = back && !sameRatio(back, s.ratio);
  const reset = `<button type="button" class="reset" data-manual-reset="${manual}"${off ? "" : " disabled"}
    title="${typedFor(rowKey(s.recv, s.give)) ? "Back to your price" : scanned ? "Back to the Competing price" : back ? "Back to the estimate"
      : "No Competing price scanned"}">reset</button>`;
  return `<span class="manual-ratio">${part(0)}${unit(s.recv)} : ${part(1)}${unit(s.give)}${reset}</span>`;
}
const ratioCellFor = (s, manual) => `<td>${manual ? manualRatio(s, manual) : `<button class="ratio-link" data-pair="${lineOf(s.recv, s.give).join("|")}"
  title="Show this pair's prices">${num(s.ratio[0])}${unit(s.recv)} : ${num(s.ratio[1])}${unit(s.give)}</button>${
    s.method === ESTIMATE ? (s.typed ? manualTag() : estimateTag()) : scanTag(stepRow(s))}`}${
  below(s.noOrders ? noOrdersTag(s.method === FAST) : s.thin ? thinTag(s) : s.rounded ? ROUNDED_TAG : "")}</td>`;
// A price whose smallest exact lot is over the 999,999 limit is traded in rounded whole-number orders (SPEC.md §3.2).
const ROUNDED_TAG = `<span class="tag manual" title="The smallest exact trade at this price is over the exchange's ${num(MAX_ORDER)} limit, so the orders are rounded to whole numbers, a little in the other side's favour, so they always go through">rounded</span>`;

// Per-row choice of Competitive or Instant (the tabs' order). Overrides last for the session, per item and mode,
// until one of the item page's tabs is clicked: that puts every step back to the tab's type.
const stepMethods = {}; // "itemId|mode|base" -> { routeId: { stepKey: method } }
const methodsFor = (itemId, mode) => (stepMethods[`${itemId}|${mode}|${baseId()}`] ??= {});
const resetMethods = (itemId) => Object.keys(stepMethods).filter((k) => k.startsWith(`${itemId}|`)).forEach((k) => delete stepMethods[k]);

// `data` is the select's data attribute (data-step="…"), which the change handler reads. Listings' waiting steps add Manual.
const methodSelect = (data, method, choices = [SLOW, FAST]) => `<select class="method" ${data} aria-label="Trade type">${choices.map((m) =>
  `<option value="${m}" ${method === m ? "selected" : ""}>${METHOD_NAMES[m]}</option>`).join("")}</select>`;
// An Estimate step's Type is just the word: it has no price scanned to trade Competitive or Instant at.
const methodCell = (s) => `<td>${s.method === ESTIMATE ? METHOD_NAMES[ESTIMATE] : methodSelect(`data-step="${s.routeId}|${s.key}"`, s.method)}</td>`;

// A step's gold for `orders`: the fee of the currency it receives.
const goldCell = (s, orders) => `<td class="num gold">${goldAmount(goldCost(s.recv, orders))}</td>`;

// A step with a problem, i.e. one with a warning: no orders on its side, too little stock behind its price,
// one lot over the order cap, or a trade that can't afford a unit. A trade left with nothing because an
// earlier one failed has no warning of its own, so it isn't one.
const stepProblem = (s) => s.noOrders || s.thin || s.tooBig || (!s.lots && s.have > 0);

// Steps as the game's order form: "I want" on the left, "I have" on the right. A leg over the
// 999,999-per-side cap becomes one row per order, since each is placed separately.
// `bad`: this step has a problem (stepProblem), so its row is shaded red.
// `cells` (a listing's, SPEC.md §4.6) can replace a step's Fill Time (`fill`) and Type (`trades`) cell
// contents and its Want and Have amounts (`amount`, given "want" or "have" and the usual HTML; null for the usual), add
// a cell at the end (`extra`), and name a Manual step whose ratio can be typed (`manual`).
function stepRows(s, n, { bad = false } = {}, cells = {}) {
  const fillOf = (x) => cells.fill?.(s) ?? x;
  const tradesTd = () => (cells.trades ? `<td>${cells.trades(s)}</td>` : methodCell(s));
  const extra = cells.extra ? `<td class="step-states">${cells.extra(s)}</td>` : "";
  // Clicking an amount (number or icon) copies the whole number, e.g. 2940, to paste into the game.
  const amount = (x, id) => {
    const copy = `<b class="copy" data-copy="${x}" title="Click to copy ${x}">${qty(x, id)}</b>`;
    return cells.amount?.(s, id === s.recv ? "want" : "have", copy) ?? copy;
  };
  const label = `${n}`;
  const cls = bad ? "bad" : "";
  // A trade that can't trade anything reads like the others, showing one lot, with the reason beside Have.
  // A trade left with nothing because an earlier one failed isn't tagged: the earlier one says why.
  if (!s.lots) {
    const lot = { received: s.lotRecv, given: s.lotGive };
    const tag = s.tooBig
      ? `<span class="tag warn" title="Untradeable for this ratio">over ${num(MAX_ORDER)} limit</span>`
      : s.have > 0 ? `<span class="tag warn" title="You'd have ${num(s.have)} ${esc(nameOf(s.give))}">cannot afford</span>` : "";
    return `<tr class="${cls}">
      <td>${label}</td>
      <td>${amount(lot.received, s.recv)}</td>
      <td>${amount(lot.given, s.give)}${below(tag)}</td>
      ${ratioCellFor(s, cells.manual?.(s))}
      <td class="num">${fillOf("—")}</td>
      ${goldCell(s, [lot])}${tradesTd()}${extra}
    </tr>`;
  }
  return s.orders.map((o, i) => {
    // Orders split by the cap are numbered under their step, e.g. "2 order 1 of 2" then "order 2 of 2", lined up
    // with the first (the step's label is there, unseen).
    const split = s.orders.length > 1 ? `<span class="muted">order ${i + 1} of ${s.orders.length}</span>` : "";
    return `<tr class="${cls}">
      <td>${i === 0 ? label : `<span class="ghost" aria-hidden="true">${label}</span>`}${split ? " " : ""}${split}</td>
      <td>${amount(o.received, s.recv)}</td>
      <td>${amount(o.given, s.give)}</td>
      ${i === 0 ? ratioCellFor(s, cells.manual?.(s)) : "<td></td>"}
      <td class="num"${i === 0 ? fillTitle(s) : ""}>${i === 0 ? fillOf(fillTime(s.fillHours)) : ""}</td>
      ${goldCell(s, [o])}
      ${i === 0 ? tradesTd() + extra : `<td></td>${extra ? "<td></td>" : ""}`}
    </tr>`;
  }).join("");
}

function stepsHtml(r, cells = {}) {
  const { steps } = r;
  // The Ratio header opens every pair this route uses, in step order.
  const pairs = steps.map((s) => lineOf(s.recv, s.give).join("|"));
  const lines = [...new Set(pairs)];
  const header = `<button class="ratio-link" data-pair="${lines.join(",")}" title="Show this route's prices">Ratio</button>`;
  return `<div class="scroll"><table class="steps">
    <thead><tr><th>#</th><th>Want</th><th>Have</th><th>${header}</th><th class="num">Fill Time</th><th class="num">Gold Cost</th><th>Type</th>${cells.extra ? '<th class="step-states"></th>' : ""}</tr></thead>
    <tbody>${steps.map((s, i) => {
      const step = { ...s, routeId: r.route.id, index: i };
      return stepRows(step, i + 1, { bad: stepProblem(s) }, cells) + (cells.after?.(step) ?? "");
    }).join("")}</tbody>
  </table></div>`;
}

// A ratio as read from the game, with the decimals it showed (8.30 stays 8.30), in six cells so every row's parts line
// up: icon, number, colon, number, icon (the numbers hugging the colon, the icons their numbers), then `tags`. A price
// not read shows `empty` across the middle three.
const decimalsOf = (v) => (String(v).split(".")[1] ?? "").length;
const fixed = (v, d) => (v === "" || v == null ? "" : Number(v).toFixed(d));
function ratioCells(a, b, key, flip, tags = "") {
  const r = ratioOf(key), v = r?.value, empty = r?.empty ? "no trades" : "not scanned";
  const side = (i) => fixed(v[i], r.digits?.[i] ?? decimalsOf(v[i]));
  const middle = v ? `<td class="r-num r-end">${side(flip ? 1 : 0)}</td><td class="r-colon">:</td><td class="r-num">${side(flip ? 0 : 1)}</td>`
    : `<td class="r-none muted" colspan="3">${empty}</td>`;
  return `<td class="r-icon r-end">${iconOnly(a)}</td>${middle}<td class="r-icon">${iconOnly(b)}</td><td class="r-tags">${tags}</td>`;
}
// The Available column (flip) reads row B:A, the Competing one row A:B; either may have no orders. Only the dialog says
// so (it's opened from the trade pages); Imported Ratios doesn't need it.
const ratioCell = (a, b, key, flip, withNoOrders) =>
  ratioCells(a, b, key, flip, `${scanTag(key, "#/imported-ratios")}${withNoOrders && noOrderRows().has(key) ? below(noOrdersTag(flip)) : ""}`);

// The game shows a pair as "A : B" both ways. By default it's "Available Trades", the orders already on
// the other side: internal row B:A, so it's drawn flipped. Holding Alt shows "Competing Trades", the
// price you'd post at: internal row A:B. Example: Chaos 371 : 1 Divine available, 380 : 1 competing.
// Imported Ratios' columns after the prices: Wait, how long the orders already at the Competing price take to fill at the
// pair's recent pace less its undercutting (the queue a new order joins, SPEC.md §3.6; blank without its stock); Spread,
// how far apart the Available and Competing prices are; and how much traded last hour.
function waitCell(a, b) {
  const key = rowKey(a, b), stock = ratioOf(key)?.stock, bought = boughtFor(league(), key), pace = bought ?? paceOf(league(), b, a);
  return `<td class="num wait">${stock == null || pace == null ? ""
    : fillTime(pace > 0 ? stock / drain(pace, bought == null ? undercutFor(league(), key) : null, 1) : null)}</td>`;
}
function spreadCell(a, b) {
  const av = ratioOf(rowKey(b, a))?.value, co = ratioOf(rowKey(a, b))?.value;
  const spread = av && co ? Math.abs((co[0] / co[1]) / (av[1] / av[0]) - 1) * 100 : null;
  return `<td class="num spread">${spread == null ? "" : `${spread.toFixed(1)}%`}</td>`;
}
// The price window on My Listings (`typing`) can have its prices typed over (SPEC.md §4.6): each is the price My Listings
// uses (one typed in, the scan, else the estimate), its two numbers shaded, each a box once clicked, with its tag; one typed
// in has a reset that removes it. None of them: as anywhere else.
function typedCells(a, b, key, flip) {
  const [x, y] = key.split(">"), typed = typedFor(key), scan = ratioOf(key)?.value ? ratioOf(key) : null;
  const v = typed ?? scan?.value ?? estimateRatio(x, y);
  if (!v) return ratioCells(a, b, key, flip);
  const digits = !typed && scan ? scan.digits : null;
  const part = (i) => (editingTyped === `${key}|${i}`
    ? `<input type="number" min="0" step="any" id="typed-ratio" value="${v[i]}" aria-label="${esc(nameOf(i ? y : x))}">`
    : `<button type="button" class="manual-edit" data-typed-edit="${key}|${i}" title="Change">${fixed(v[i], digits?.[i] ?? decimalsOf(v[i]))}</button>`);
  const tag = typed ? `${manualTag()} <button type="button" class="reset" data-typed-reset="${key}"
    title="Back to the ${scan ? "scanned price" : "estimate"}">reset</button>` : scan ? scanTag(key) : estimateTag();
  const [l, r] = flip ? [1, 0] : [0, 1];
  return `<td class="r-icon r-end">${iconOnly(a)}</td><td class="r-num r-end">${part(l)}</td><td class="r-colon">:</td><td class="r-num">${
    part(r)}</td><td class="r-icon">${iconOnly(b)}</td><td class="r-tags">${tag}</td>`;
}
const ratioLine = ([a, b], withStats, withNoOrders = false, typing = false) => {
  const v = withStats && pairVolume(rates.leagues[league()], a, b);
  const stats = withStats ? `${waitCell(a, b)}${spreadCell(a, b)}<td class="vol muted">${qty(v?.[0] ?? 0, a)} ⇄ ${qty(v?.[1] ?? 0, b)}</td>` : "";
  const cell = (key, flip) => (typing ? typedCells(a, b, key, flip) : ratioCell(a, b, key, flip, withNoOrders));
  return `<tr>${cell(rowKey(b, a), true)}${cell(rowKey(a, b), false)}${stats}</tr>`;
};

// Groups of lines, each under its own heading, e.g. one group per item (vs Chaos, vs Divine).
const ratioTable = (groups) => `<div class="scroll"><table class="ratios">
  <thead><tr><th colspan="6">Available Trades</th><th colspan="6">Competing Trades</th>
    <th class="num" title="How long the Competing orders already at that price take to fill">Wait</th>
    <th class="num" title="How far apart the Available and Competing prices are">Spread</th><th class="vol">Traded last hour</th></tr></thead>
  ${groups.map((g) => `<tbody data-row="${g.id ?? "hubs"}"><tr class="group"><th colspan="15"><div class="group-head">
    <span>${g.id // a currency's name opens its page in Available Trades; the hubs' block has none
      ? `<a href="#/item/${g.id}/available" title="Open in Available Trades">${icon(g.id)}${esc(g.title)}</a>`
      : esc(g.title)}</span>
  </div></th></tr>${g.lines.map((line) => ratioLine(line, true)).join("")}</tbody>`).join("")}
</table></div>`;

// The hubs against each other (PoE1: Chaos ↔ Divine), then one block per item with a line per hub.
const hubGroup = () => ({
  title: currencies.hubs.map(hubName).join(" ↔ "),
  lines: currencies.hubs.flatMap((a, i) => currencies.hubs.slice(i + 1).map((b) => [a, b])),
});
const itemGroup = (item) => ({ id: item.id, title: item.name, lines: currencies.hubs.map((h) => [item.id, h]) });

// Search box for long lists; typing re-renders and keeps the cursor in the box.
const searchBox = (placeholder) =>
  `<p><input type="search" id="search" placeholder="${placeholder}" value="${esc(query)}" autocomplete="off"></p>`;

// Pagination for the Imported Ratios list: PAGE_SIZE rows per page. The page resets when the
// search changes or you navigate away.
let pageNo = 1;
// Trade Recommendations' tables opened or closed by hand, by key; kept while on that page. Only Profitable starts open.
const sectionState = new Map();
const sectionOpen = (key) => sectionState.get(key) ?? key === "profitable";
const pageCount = (total) => Math.max(1, Math.ceil(total / PAGE_SIZE));
const paged = (list) => {
  pageNo = Math.min(pageNo, pageCount(list.length));
  return list.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
};
function pager(total) {
  const pages = pageCount(total);
  if (pages < 2) return "";
  const btn = (n, label, disabled) => `<button class="page" data-page="${n}" ${disabled ? "disabled" : ""}>${label}</button>`;
  return `<p class="pager">${btn(pageNo - 1, "‹ Prev", pageNo === 1)}
    <span class="muted">Page ${pageNo} of ${pages} · ${num(total)} currencies</span>
    ${btn(pageNo + 1, "Next ›", pageNo === pages)}</p>`;
}

// ---------- pages ----------

// Summary sort: click a header to sort by it, again to reverse. Rows with no value (e.g. isn't scanned)
// always go last. Lasts for the session; defaults to profit / minute, highest first.
const SORTS = {
  item: { label: "Item", desc: false, value: (r) => r.item.name },
  profit: { label: "Profit", desc: true, value: (r) => (r.result.missing ? null : r.result.rank) },
  gold: { label: "Gold Cost", desc: false, num: true, value: (r) => (r.result.missing ? null : r.result.gold) },
  fill: { label: "Fill Time", desc: false, num: true, value: (r) => (r.result.missing ? null : r.result.fillHours) },
  // "[icon] / min": every route's profit is in the start currency, so its icon heads the column and the cells are bare.
  perMinute: { get label() { return `${iconOnly(baseId())} / min`; }, desc: true, num: true, value: (r) => perMinute(r.result, r.result.gainRank) },
};
let sort = { key: "perMinute", desc: true };
// Profit per minute of fill time, a fill under a minute counted as one (so instant routes give their whole profit);
// null when the fill time is unknown.
const perMinute = (r, amount) => (r.missing || r.fillHours == null ? null
  : amount / Math.max(r.fillHours * 60, 1));
// Only the start currency gained counts (what's left over of others doesn't), in that currency, always to two decimals
// (0.90, 0.00); its icon first unless `bare`.
const perMinuteHtml = (r, bare = false) => {
  const x = perMinute(r, r.gain);
  if (x == null) return "—";
  const v = Math.round(x * 100) / 100 || 0;
  return `${bare ? "" : icon(r.base)}${v > 0 ? "+" : ""}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function sortRows(rows) {
  const { value } = SORTS[sort.key];
  const dir = sort.desc ? -1 : 1;
  return rows.sort((x, y) => {
    const a = value(x), b = value(y);
    if (a == null || b == null) return (a == null) - (b == null);
    return dir * (typeof a === "string" ? a.localeCompare(b) : a - b);
  });
}

const sortHeader = (key) => {
  const { label, num: right } = SORTS[key];
  const arrow = sort.key === key ? (sort.desc ? " ▼" : " ▲") : "";
  return `<th${right ? ' class="num"' : ""}><button class="sort${sort.key === key ? " active" : ""}" data-sort="${key}">${label}${arrow}</button></th>`;
};

// Starting Amount (SPEC.md §1): how much of which hub every route starts with. On Trade Recommendations and item pages, at
// the top right of the page; the icons pick the hub, the selected one highlighted.
function startControls() {
  const buttons = game.starts.map((id) => `<button type="button" data-base="${id}" class="${id === baseId() ? "active" : ""}"
    title="${esc(hubName(id))}" aria-label="${esc(hubName(id))}">${iconOnly(id)}</button>`).join("");
  return `<div class="page-head"><span class="actions start"><label for="start-amount">Starting Amount:</label>
    <input id="start-amount" type="number" min="1" step="1" value="${start()}">
    <span class="base-toggle" role="group" aria-label="Currency to start with">${buttons}</span></span></div>`;
}

// Competitive / Instant tabs, styled like Imported Ratios'. `href(mode)` is each tab's address.
const modeTabs = (mode, href, itemId) => `<div class="tabs">${Object.entries(MODES)
  .map(([m, md]) => `<a href="${href(m)}" class="${m === mode ? "active" : ""}" data-reset-steps="${itemId}">${md.tab}</a>`).join("")}</div>`;
// Competitive / Instant / Estimated Trading as a selector (links), like the starting currency's. Competitive and Instant list
// the routes whose prices are all scanned; Estimated, the rest. The mode last shown is where item pages lead back to.
const exchangeHref = (m) => `#/trade-recommendations${m === DEFAULT_MODE ? "" : `/${m}`}`;
const modeToggle = (mode) => `<p class="mode-pick"><span class="mode-toggle" role="group" aria-label="Trading">${Object.entries(MODES)
  .map(([m, md]) => `<a href="${exchangeHref(m)}" class="${m === mode ? "active" : ""}"${m === mode ? ' aria-current="page"' : ""}>${md.tab}</a>`).join("")}</span></p>`;

// After "nothing scanned" (Trade Recommendations, Imported Ratios): a link that opens the header's import window.
const importHint = () => `Use <a href="#" data-import>Import Market Ratios</a> at the top right to read them from the game.`;

// Trade Recommendations: the starting amount, the Competitive / Instant / Estimated selector, then the tables.
function summaryPage(mode) {
  const { method, estimate = false } = MODES[mode];
  // Every route of every item, each on its own row (SPEC.md §4.1): in Competitive and Instant Trading the routes whose every
  // price is scanned, in Estimated Trading the others. Routes the starting amount can't afford aren't listed.
  const now = ratios(), all = [];
  for (const item of tradeItems()) {
    for (const result of allResults(now, item.id, start(), method, {}, baseId(), estimate)) {
      const keys = routeKeys(item.id, result.route);
      if (keys.every(isScanned) !== estimate) all.push({ item, result, key: `${item.id}|${result.route.id}`, tag: keysTag(keys, estimate).trim() });
    }
  }
  const rows = all.filter((r) => matches(r.item.name));
  sortRows(rows); // every table uses the chosen sort

  const row = ({ item, result, key, tag }) => {
    const link = `<a href="#/item/${item.slug}/${mode}" data-pick-route="${item.id}|${result.route.id}">${titled(item.id)}</a>`;
    // The route's scan age tag (its oldest price), in a narrow column of its own so the tags line up.
    const scanned = `<td class="age">${tag}</td>`;
    if (result.missing) {
      return `<tr class="losing" data-row="${key}"><td>${link}</td>${scanned}<td colspan="5">${missingTag(result)}</td></tr>`;
    }
    return `<tr class="${profitable(result) ? "" : "losing"}" data-row="${key}">
      <td>${link}</td>
      ${scanned}
      <td class="profit ${signClass(result.rank)}">${profit(result)}</td>
      <td class="num">${routeFill(result)}</td>
      <td class="num ${signClass(result.gain)}">${perMinuteHtml(result, true)}</td>
      <td class="num">${goldTotal(result)}</td>
      <td>${routeLabel(result, item)}${below(blockedTag(result))}</td>
    </tr>`;
  };
  const table = (list) => `<div class="scroll"><table class="summary">
      <thead><tr>${sortHeader("item")}<th class="age"></th>${sortHeader("profit")}${sortHeader("fill")}${sortHeader("perMinute")}${sortHeader("gold")}<th>Route</th></tr></thead>
      <tbody>${list.map((r) => row(r)).join("")}</tbody>
    </table></div>`;
  // Each table opens and closes by its heading, which gives its count; open, it lists every row (drawn only then).
  const section = (key, title, list, { empty = "" } = {}) => (list.length || empty
    ? `<details class="section" data-section="${key}"${sectionOpen(key) ? " open" : ""}>
      <summary><h2>${title} <span class="muted">(${num(list.length)})</span></h2></summary>
      ${!sectionOpen(key) ? "" : list.length ? table(list) : `<p class="muted">${empty}</p>`}</details>` : "");
  // Untradeable: an Instant trade has nothing, or too little, on offer to fill, or a price is missing.
  const untradeable = (r) => r.result.missing || r.result.blocked;
  const good = rows.filter((r) => profitable(r.result));
  const blocked = rows.filter(untradeable);
  const losing = rows.filter((r) => !profitable(r.result) && !untradeable(r));

  if (!all.length) {
    return `${startControls()}
    ${modeToggle(mode)}
    <p class="muted">${estimate ? `Every trade for ${esc(league())} is scanned.`
      : `No trades have been scanned for ${esc(league())} in the last 4 hours. ${importHint()}`}</p>`;
  }
  return `${startControls()}
    ${modeToggle(mode)}
    ${searchBox("Search items")}
    ${section("profitable", "Profitable", good, { empty: `None${query ? " matching" : " right now"}.` })}
    ${section("unprofitable", "Unprofitable", losing)}
    ${section("untradeable", "Untradeable", blocked)}`;
}

// A route's line, in the order of its steps' columns: its profit, fill time, profit per minute (from that fill time) and
// gold. A listing passes its own fill time (SPEC.md §4.6).
const routeSummary = (r, hours = r.fillHours) => {
  const timed = { ...r, fillHours: hours };
  return `<b class="${signClass(r.rank)}">${profit(r)}</b><span class="sep">·</span>${fillTime(hours)}${perMinute(timed, r.gain) == null ? ""
    : `<span class="sep">·</span><span class="${signClass(r.gain)}">${perMinuteHtml(timed)}</span> / min`}<span class="sep">·</span><span class="neg">${goldTotal(r)}</span>`;
};

// The route whose Trade Recommendations row was clicked last ({ item, route } ids): its item page highlights it while it's
// profitable.
let pickedRoute = {};

// An item's routes, most profit a minute first (a stable sort, so ties and routes with no rate keep their profit order);
// routes that can't be done or are missing a price have no rate.
const byPerMinute = (results) => results.sort((x, y) => {
  const [a, b] = [x, y].map((r) => (r.blocked ? null : perMinute(r, r.gainRank)));
  return a == null || b == null ? (a == null) - (b == null) : b - a;
});

// Route order per "itemId|mode", best first. Set when the page is opened and again after every ratio or
// starting amount change (cleared then and on navigation); Type dropdown changes only update the numbers.
const routeOrder = new Map();
// Item pages' route folds opened or closed by hand ("itemId|mode|base|routeId" -> open), and the inner folds of routes
// that can't be done, opened by hand; both kept until the page changes.
const routeFold = new Map();
const routeOpen = new Set();

function itemPage(slug, mode) {
  const { method, estimate = false } = MODES[mode];
  const item = slug ? itemOf(slug) : null;
  if (!item) return `<h1>Not found</h1><p><a href="${exchangeHref(mode)}">Back to Trade Recommendations</a></p>`;
  // The start currency isn't traded for itself (SPEC.md §4.2): pick another to start with.
  if (item.id === baseId()) {
    return `${startControls()}
    <p class="back"><a href="${exchangeHref(mode)}">← Back to Trade Recommendations</a></p>
    <h1>${titled(item.id)}</h1>
    <p class="muted">${esc(hubName(item.id))} is your starting currency, so it has no routes. Start with another currency to see them.</p>`;
  }
  const orderKey = `${item.id}|${mode}|${baseId()}`;
  // Estimated Trading has the routes not every price of which is scanned (the others are on Competitive and Instant).
  const current = byPerMinute(allResults(ratios(), item.id, start(), method, methodsFor(item.id, mode), baseId(), estimate)
    .filter((r) => !estimate || !routeKeys(item.id, r.route).every(isScanned)));
  // An edit can change which routes are left (one the starting amount can't afford isn't offered), so a kept order
  // that no longer matches is worked out again.
  const kept = routeOrder.get(orderKey);
  if (!kept || kept.length !== current.length || kept.some((id) => !current.some((r) => r.route.id === id))) {
    routeOrder.set(orderKey, current.map((r) => r.route.id));
  }
  const results = routeOrder.get(orderKey).map((id) => current.find((r) => r.route.id === id));
  // Highlight the route picked on Trade Recommendations while it's profitable, else whichever is most profitable right now
  // (after edits), if any make a profit.
  const top = (pickedRoute.item === item.id && current.find((r) => r.route.id === pickedRoute.route && profitable(r)))
    || current.find((r) => profitable(r)); // `current` is sorted best first

  // Every route in the same box, a fold: path and totals on its line, then its steps. Unprofitable ones are greyed and
  // start folded; profitable ones start open. A route missing a ratio has no steps (the calculation stops at the first
  // gap): it says which pair, and where to read it, or that the game showed no trades there.
  const fold = (r, cls, head, body) => {
    const key = `${item.id}|${mode}|${baseId()}|${r.route.id}`, open = routeFold.get(key) ?? profitable(r);
    return `<details class="other${cls}" data-row="${r.route.id}" data-route-fold="${esc(key)}"${open ? " open" : ""}>
        <summary>${head}</summary>${body}</details>`;
  };
  const box = (r) => r.missing
    ? fold(r, " losing", `<h3>${routeLabel(r, item)}</h3>`, missingText(r, importHint()))
    : fold(r, `${profitable(r) ? "" : " losing"}${r === top ? " top" : ""}`, `<h3 class="split"><span>${routeSummary(r)}</span>
          <span>${routeLabel(r, item)}</span></h3>`,
        (stuck(r) ? stuckSteps(r) : stepsHtml(r)) + addListingFoot(item, r));
  // A route that can't be done for want of stock (a main trade with no orders on its side, or too little on offer)
  // or with one lot over the limit shows its steps folded under one line saying why; opened, it stays open while on
  // the page. (One the starting amount can't afford isn't listed at all: allResults leaves it out.)
  const stuck = (r) => (r.steps.some((x) => x.noOrders) ? "a trade has no available orders"
    : r.steps.some((x) => x.thin) ? `not enough on offer for a trade at this starting amount`
    : r.steps.some((x) => !x.lots && x.tooBig) ? `one unit is over the ${num(MAX_ORDER)} limit` : null);
  const stuckSteps = (r) => {
    const key = `${item.id}|${mode}|${baseId()}|${r.route.id}`;
    return `<details class="route-steps" data-route-open="${esc(key)}"${routeOpen.has(key) ? " open" : ""}>
        <summary class="muted">Can't be done: ${stuck(r)}.</summary>
        ${stepsHtml(r)}</details>`;
  };

  return `${startControls()}
    <p class="back"><a href="${exchangeHref(mode)}">← Back to Trade Recommendations</a></p>
    <h1>${titled(item.id)}${tradeTag(item.id, estimate)} <span class="muted item-volume">${volumeHtml(item.id)} traded last hour</span></h1>
    ${modeTabs(mode, (m) => `#/item/${slug}/${m}`, item.id)}
    ${results.length ? results.map(box).join("")
      : estimate && tradeKeys(item.id).every(isScanned) ? `<p class="muted">Every trade of ${esc(item.name)} is scanned: see Competitive and Instant Trading.</p>`
      : `<p class="muted">Not enough starting ${esc(hubName(baseId()))}</p>`}
`;
}

// ---------- listings (SPEC.md §4.6) ----------

// Routes you've started, kept in this browser with their league. Each step is waiting (it follows the scans, as on the item
// page), in progress (posted in the game: kept as it was then, only its fill time following the scans) or done (filled:
// kept as it was then). At most one is in progress.
const listings = () => (store.state.listings ??= []);
const leagueListings = (completed) => listings().filter((l) => l.league === league() && !!l.completed === completed);
const listingOf = (id) => listings().find((l) => l.id === id);
let pendingDelete = null; // the listing whose Delete asks first
// The route's steps in order, by calc.js's stepKey (recv>give), for its per-step Type choices.
const routeOf = (l) => routesFor(l.base).find((r) => r.id === l.routeId);
// The currencies it goes through: its base, then each one received.
const pathOf = (l) => [l.base, ...routeOf(l).path(l.item)];
const pathKeys = (l) => {
  const path = pathOf(l);
  return path.slice(1).map((recv, i) => pathKey(recv, path[i]));
};
// Each route step is one row of `steps`, or more once a started step was cancelled partway: that row done for what it
// traded, then a row of its own after it (`repost`) posting what was left (`left`, of the same Have) again, the same way.
// legOf(l, i) is the route step row i trades, methodOf how it's traded.
const legOf = (l, i) => l.steps.slice(0, i + 1).filter((st) => !st.repost).length - 1;
// A step's choice is a method, or a Manual step's { method: MANUAL, ratio } (want:have); stepSlot is where it's kept. A price
// typed into a Manual step is kept as `typed` too, on whatever Type is picked after, so picking Manual again brings it back.
const stepSlot = (l, i) => (l.steps[i].repost ? [l.steps[i], "method"] : [l.methods, legOf(l, i)]);
const methodOf = (l, i) => l.steps[i].method ?? l.methods[legOf(l, i)];
// The next step to start or complete: the first that isn't done (the steps' length when all are).
const nextStep = (l) => {
  const i = l.steps.findIndex((st) => st.state !== "done");
  return i < 0 ? l.steps.length : i;
};
// What's kept of a step once it's posted or done: the trade as worked out then.
const FROZEN = ["method", "recv", "give", "have", "lots", "lotRecv", "lotGive", "received", "given", "orders", "ratio", "rounded", "tooBig", "extra", "gold"];
const freeze = (s) => Object.fromEntries(FROZEN.map((k) => [k, s[k]]));

// When a step's order went up, for its time: when its play button was clicked, unless it was marked done within LATE_PLAY
// of that (play clicked late, as the order filled): then when the step before it was done (step 1: when the listing was
// added).
const LATE_PLAY = 60 * 1000;
const postedAt = (l, i) => {
  const st = l.steps[i], before = i === 0 ? l.added : l.steps[i - 1].doneAt ?? st.at;
  return st.at == null || (st.doneAt != null && st.doneAt - st.at < LATE_PLAY) ? before : st.at;
};

// What's ahead of a posted order (SPEC.md §4.6), from its row's list as last read: all the stock at better prices (posted
// after it, they fill first), and at its price, what was there when it was started (`queue`, with or without the order
// itself; orders at one price fill oldest first) as far as the stock there now, less the order (unless that list was read
// before it was started), still holds it. Its price off the list (worse than the 5 shown): everything shown. Null without
// a list read.
const better = (a, b) => a[0] * b[1] < b[0] * a[1];
function aheadOfPosted(st) {
  const f = st.fixed, list = store.listOf(league(), rowKey(f.recv, f.give));
  if (!list?.levels.length) return null;
  const ahead = list.levels.filter((x) => better(x.ratio, f.ratio)).reduce((n, x) => n + x.stock, 0);
  const at = list.levels.find((x) => sameRatio(x.ratio, f.ratio));
  if (!at) return better(f.ratio, list.levels.at(-1).ratio) ? ahead : list.levels.reduce((n, x) => n + x.stock, 0);
  const own = list.at != null && st.at != null && list.at < st.at ? 0 : f.given;
  return ahead + Math.max(0, Math.min(st.queue ?? at.stock, at.stock - own));
}
// A started step stays as it was when it was started (ratio, Have, Want, gold, how it's traded); only its fill time follows
// the scans, worked out at its ratio from what's ahead of it, counting down from the pair's latest scan (or from when it
// was posted, if later).
function startedFill(l, i) {
  const st = l.steps[i], f = st.fixed, queued = f.method === FAST ? null : aheadOfPosted(st);
  const t = leg(ratios(), f.method, f.recv, f.give, f.given, f.ratio, queued);
  if (t.missing) return null;
  const from = Math.max(ratioOf(stepRow(f))?.verifiedAt ?? 0, postedAt(l, i)), h = t.fillHours;
  return h == null || h === 0 ? h : Math.max(h - (Date.now() - from) / 3600000, 1 / 120);
}

// The listing worked out now: started and done rows as they were, the rest from the latest scans. A route step with
// several rows trades what they all do together (the next one has what they all bought). `rows` is each row's trade,
// for its line in the steps table.
function listingResult(l) {
  const keys = pathKeys(l);
  const perStep = Object.fromEntries(keys.map((k, i) => [k, l.methods[i]]));
  const kept = (f, hours) => ({ ...f, noOrders: false, thin: false, depth: null, undercut: null, bought: null, ahead: 0, fillHours: hours });
  const path = pathOf(l);
  // A repost waiting to start trades what was left at the latest price.
  const reposted = (st, i) => {
    const k = legOf(l, i), m = methodOf(l, i), now = listingRatios();
    let t = leg(now, m.method ?? m, path[k + 1], path[k], st.left, m.ratio), method = m.method ?? m;
    if (t.missing) [t, method] = [leg(now, ESTIMATE, path[k + 1], path[k], st.left, null, null, true), ESTIMATE];
    return t.missing ? t : { ...t, method };
  };
  const rows = l.steps.map((st, i) => (st.state === "done" ? kept(st.fixed, 0) : st.state === "progress" ? kept(st.fixed, startedFill(l, i))
    : st.repost ? reposted(st, i) : undefined));
  const missing = rows.find((t) => t?.missing);
  if (missing) return { missing: missing.missing };
  const sum = (parts, k) => (parts.some((p) => p[k] == null) ? null : parts.reduce((n, p) => n + p[k], 0));
  const fixed = keys.map((_, k) => {
    const parts = rows.filter((_, i) => legOf(l, i) === k);
    if (parts.length === 1) return parts[0];
    return { ...parts[0], received: sum(parts, "received"), given: sum(parts, "given"), lots: sum(parts, "lots"),
      orders: parts.flatMap((p) => p.orders), gold: sum(parts, "gold"), fillHours: sum(parts, "fillHours") };
  });
  // A started or done step's extra is what the step before it bought and it didn't spend, as for any step (§3.3).
  for (const [i, f] of fixed.entries()) if (i > 0 && f && fixed[i - 1]) fixed[i] = { ...f, extra: fixed[i - 1].received - f.given };
  // A waiting step with no price scanned is an Estimate step, whatever Type it was given (SPEC.md §4.6).
  const r = runRoute(listingRatios(), l.item, routeOf(l), MODES[l.mode].method, l.start, perStep, l.base, fixed, "typed");
  if (r.missing) return r;
  // Each row's own line: a route step's trade as worked out, or with several rows, each row's part of it.
  const lines = l.steps.map((st, i) => {
    const k = legOf(l, i), alone = l.steps.filter((_, j) => legOf(l, j) === k).length === 1;
    return alone ? r.steps[k] : { ...rows[i], key: r.steps[k].key };
  });
  return { ...r, rows: lines };
}

// The stock already at a step's price when it's posted, in what it gives: its row's orders as last read, or the price's own
// stock when it's the best.
function queueAt(s) {
  const key = rowKey(s.recv, s.give);
  const level = store.listOf(league(), key)?.levels.find((x) => sameRatio(x.ratio, s.ratio));
  if (level) return level.stock;
  const r = ratioOf(key);
  return r?.value && sameRatio(r.value, s.ratio) ? r.stock ?? 0 : 0;
}

// When the next step's order seems to have gone up without its play button (SPEC.md §4.6): the time of the latest scan of
// its row's list (after it became the next step) whose stock at its price rose by about its order since the scan before
// (SEEN_GAP at most), or null. Only for orders posted, and not once it's been answered No (`noHint`).
const SEEN = [0.95, 1.05], SEEN_GAP = 20 * 60 * 1000;
function orderSeenAt(l, i, s) {
  const st = l.steps[i];
  if (l.completed || st.state !== "waiting" || st.noHint || i !== nextStep(l) || !s?.lots || s.method === FAST || s.method === ESTIMATE) return null;
  const since = i === 0 ? l.added : l.steps[i - 1].doneAt ?? l.added;
  const reads = store.readsOf(league(), rowKey(s.recv, s.give));
  // The stock at its price in a read; 0 where its price would be among those shown, null below them.
  const stockIn = (levels) => {
    const at = levels.find((x) => sameRatio(x.ratio, s.ratio));
    return at ? at.stock : levels.length < 5 || better(s.ratio, levels.at(-1).ratio) ? 0 : null;
  };
  for (let k = reads.length - 1; k > 0; k--) {
    const [was, is] = [reads[k - 1], reads[k]];
    if (is.at < since) break;
    if (is.at - was.at > SEEN_GAP) continue;
    const [a, b] = [stockIn(was.levels), stockIn(is.levels)];
    if (a != null && b != null && b - a >= SEEN[0] * s.given && b - a <= SEEN[1] * s.given) return is.at;
  }
  return null;
}

// A step's play button starts it, once the step before it is done: it's kept as it is from then on (scans don't change
// it), but for its fill time. Clicked again, it goes back to waiting, worked out from the latest scans again. `at` is when
// its order went up: now, or the scan that saw it (Yes on the hint).
// Each start keeps what its fill time was worked out from (the pace, the undercutting and the stock ahead),
// to compare the fill times with the real ones (?debug's reads file).
function playStep(l, i, at = Date.now()) {
  const st = l.steps[i], r = listingResult(l), s = !r.missing && r.rows[i];
  const repost = st.repost ? { repost: true, left: st.left, method: st.method } : {};
  if (st.state === "progress") {
    l.steps[i] = { state: "waiting", ...repost };
  } else if (st.state === "waiting" && i === nextStep(l) && s?.lots && s.method !== ESTIMATE) {
    l.steps[i] = { state: "progress", at, fixed: freeze(s), fillAtStart: s.fillHours, queue: queueAt(s),
      pace: paceOf(league(), s.recv, s.give), bought: s.bought ?? null, undercut: s.undercut ?? null, ahead: s.ahead ?? 0, ...repost };
  } else {
    return;
  }
  store.save();
}
// A step's check marks the started step done, as it was started (the next step waits for its own play button). The
// last done step's check, while the step after it isn't started, puts it back to started (its time counting on from when
// it was first started): a cancelled one with its whole order, and the repost of what was left goes (uncancel).
const lastDone = (l) => {
  const k = nextStep(l), i = k - 1;
  return i >= 0 && (k === l.steps.length || l.steps[k].state === "waiting") ? i : -1;
};
function checkStep(l, i) {
  const st = l.steps[i];
  if (st.state === "progress") {
    Object.assign(st, { state: "done", doneAt: Date.now() });
  } else if (st.state === "done" && i === lastDone(l)) {
    uncancel(l, i);
    Object.assign(st, { state: "progress" });
    delete st.doneAt;
  } else {
    return;
  }
  store.save();
}
// The started step's cancel: its order was taken down with `left` of its Have not traded (SPEC.md §4.6). None left is
// the check; all of it, back to waiting (its play button again); in between, it's done for what it traded, at its own
// price, its whole order kept apart (its row still shows it), and a repost after it trades the rest the same way, at the
// latest price, waiting for its own play button. More than it had isn't taken (false).
function cancelStep(l, i, left) {
  const st = l.steps[i], n = Math.floor(Number(left));
  if (st?.state !== "progress" || !(n >= 0) || n > st.fixed.given) return false;
  if (n === 0) return checkStep(l, i), true;
  if (n === st.fixed.given) return playStep(l, i), true;
  const whole = st.fixed, given = whole.given - n, received = Math.round((whole.received * given) / whole.given);
  Object.assign(st, { state: "done", doneAt: Date.now(), whole, fixed: { ...whole, received, given, extra: whole.have - given } });
  l.steps.splice(i + 1, 0, { state: "waiting", repost: true, left: n, method: methodOf(l, i) });
  store.save();
  return true;
}
let cancelling = null; // "listingId|row" whose Cancelled box is open
// The Cancelled box, for the started step whose cancel was clicked: floating beside that button (placeCancelBox), so
// nothing on the page moves: "Cancelled" and its ×, then "[icon][  ] Remaining", how much of its Have wasn't traded.
function cancelBox() {
  if (!cancelling) return "";
  const [id, i] = cancelling.split("|"), st = listingOf(id)?.steps[Number(i)];
  if (st?.state !== "progress") return "";
  return `<div class="cancel-box" id="cancel-box" role="dialog" aria-labelledby="cancel-title">
    <div class="cancel-head"><h4 id="cancel-title">Cancelled</h4><button type="button" class="cancel-close" data-cancel-close aria-label="Close" title="Close">×</button></div>
    <form data-cancel-form novalidate>${icon(st.fixed.give)}<input type="number" id="cancel-left" min="0" max="${st.fixed.given}" step="1" aria-label="Remaining"
      title="At most ${num(st.fixed.given)}"><label for="cancel-left">Remaining</label></form></div>`;
}
// Level with its cancel button's row, just right of it; left of the row's buttons when there's no room on the right.
function placeCancelBox() {
  const box = $("#cancel-box"), b = cancelling && $(`[data-listing-cancel="${cancelling}"]`);
  if (!box || !b) return;
  const r = b.getBoundingClientRect(), buttons = b.closest(".step-buttons").getBoundingClientRect(), gap = 8;
  const right = r.right + gap + box.offsetWidth <= document.documentElement.clientWidth - gap;
  box.style.left = `${right ? r.right + gap : Math.max(gap, buttons.left - gap - box.offsetWidth)}px`;
  box.style.top = `${r.top + r.height / 2 - box.offsetHeight / 2}px`;
}
// Undoing a cancel: the repost after row i goes, and row i has its whole order again.
function uncancel(l, i) {
  const st = l.steps[i];
  if (!st.whole) return;
  if (l.steps[i + 1]?.repost && l.steps[i + 1].state === "waiting") l.steps.splice(i + 1, 1);
  st.fixed = st.whole;
  delete st.whole;
}

const ESTIMATE_NOTE = "Set its Type to Manual and type the price the game shows first";
const CHECK_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const PLAY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`;
const CANCEL_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/></svg>`; // stop: the order taken down
// A step's play button, cancel and check, in the order they happen, each an outline until it's on: play filled in green
// once the step is started (or done), the check blue once it's done. The cancel is for the started step (its order taken
// down partway), and for a repost waiting to start (undoing the cancel). Each is disabled where it can't be clicked. An
// Estimate step (`estimate`) has none: it has no price to post at until it's Manual or scanned, and says so instead.
function stepButtons(l, i, estimate = false) {
  const st = l.steps[i], k = nextStep(l);
  if (estimate && st.state === "waiting") return `<span class="estimate-note" title="${ESTIMATE_NOTE}">Cannot trade</span>`;
  const btn = (kind, on, can, title, iconSvg) => `<button type="button" class="step-check${on ? " on" : ""}" data-listing-${kind}="${l.id}|${i}"
    title="${title}" aria-label="${title}" aria-pressed="${on}"${can ? "" : " disabled"}>${iconSvg}</button>`;
  const started = st.state !== "waiting", done = st.state === "done", undo = done && i === lastDone(l);
  const play = btn("play", started, st.state === "progress" || (st.state === "waiting" && i === k),
    st.state === "progress" ? "Started: click to put it back to waiting" : started ? "Started" : i === k ? "Start this step" : "Finish the step before first", PLAY_ICON);
  const check = btn("check", done, st.state === "progress" || undo,
    st.state === "progress" ? "Mark this step done" : undo ? "Done: click to put it back to started" : done ? "Done" : "Not started", CHECK_ICON);
  const unpost = st.repost && st.state === "waiting";
  const cancel = btn("cancel", false, st.state === "progress" || unpost,
    st.state === "progress" ? "Cancel this step" : unpost ? "Remove this step: back to the order before it" : "Cancel a started step", CANCEL_ICON);
  return `<span class="step-buttons">${play}${cancel}${check}</span>`;
}

// A listing's fill time, step by step: a done step as long as it took (from when it was posted to when it was marked
// done), the step in progress as long as it's taken so far and its wait still to go, and each waiting step's fill time
// now. A completed listing's steps are all done, so it's how long the trade took. Null when not known.
function listingHours(l, r) {
  const HOUR = 3600000;
  let total = 0;
  for (const [i, st] of l.steps.entries()) {
    const ahead = r.rows[i]?.fillHours;
    if (st.state === "done") total += (st.doneAt - postedAt(l, i)) / HOUR;
    else if (ahead == null) return null;
    else total += st.state === "progress" ? (Date.now() - postedAt(l, i)) / HOUR + ahead : ahead;
  }
  return total;
}

// A listing's times, in local time, on a 12-hour clock: "2026-10-23 @ 02:39pm".
const listingTime = (at) => {
  const d = new Date(at), h = d.getHours(), two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} @ ${two(h % 12 || 12)}:${two(d.getMinutes())}${h < 12 ? "am" : "pm"}`;
};

function listingBox(l) {
  const r = listingResult(l);
  // The route's path as on the item page.
  const path = pathOf(l).map(iconOnly).join(" → ");
  // Above the box: what it started with and the profit projected when it was added (neither ever changes); once completed,
  // the profit it made; and when it was added (and completed).
  const actual = l.completed && !r.missing
    ? `<span class="apart"><b>Profit</b> <b class="${signClass(r.rank)}">${profit(r)}</b></span>` : "";
  const meta = `<div class="listing-meta"><span><b>Start</b> <b>${qty(l.start, l.base)}</b><span class="apart"><b>Projected</b> <b class="${signClass(l.expected.rank)}">${profit({ ...l.expected, base: l.base })}</b></span>${actual}</span><span class="listing-times">${listingTime(l.added)}${
    l.completed ? ` <span class="range-dash">-</span> ${listingTime(l.completedAt)}` : ""}</span></div>`;
  const wrap = (body) => `<div class="listing">${meta}<section class="other" data-row="listing-${l.id}">${body}${foot}</section></div>`;
  // Completed only once every step is done.
  const done = l.steps.every((st) => st.state === "done");
  // A completed listing is a snapshot: no step buttons, and Mark As Active (to the right of Delete) puts it back on Active.
  const complete = l.completed ? `<button type="button" data-listing-active="${l.id}">Mark As Active</button>`
    : `<button type="button" class="complete" data-listing-complete="${l.id}"${done ? "" : ' disabled title="Finish every step first"'}>Mark As Completed</button>`;
  const foot = `<div class="listing-foot"><button type="button" class="danger" data-listing-delete="${l.id}">Delete</button>${complete}</div>
    ${pendingDelete === l.id ? confirmBox("This deletes the listing.", "listing-delete") : ""}`;
  if (r.missing) return wrap(`<h3>${path}</h3>${missingText(r)}`);

  const cells = {
    // A done step's Fill Time is how long it took, from when it was started to when it was marked done; the rest as on
    // the item page.
    fill: (s) => {
      const st = l.steps[s.index];
      return st.state !== "done" ? null : `<span title="How long it took">${took((st.doneAt - postedAt(l, s.index)) / 3600000)}</span>`;
    },
    // A waiting step can change how it's traded: with no Competing price scanned (an Estimate step's), only Estimate or
    // Manual; a started or done step says how it is.
    trades: (s) => (l.steps[s.index].state === "waiting"
      ? methodSelect(`data-listing-step="${l.id}|${s.index}" data-ratio="${s.ratio.join(":")}"`, s.method,
        s.method === ESTIMATE || (s.method === MANUAL && !isScanned(rowKey(s.recv, s.give))) ? [ESTIMATE, MANUAL] : [SLOW, FAST, MANUAL])
      : METHOD_NAMES[s.method]),
    // A waiting Manual step's ratio is typed in its cell.
    manual: (s) => (l.steps[s.index].state === "waiting" && s.method === MANUAL ? `${l.id}|${s.index}` : null),
    // A cancelled step shows its whole order, as posted, and after its Have how much of it filled: "[div]25 (1 filled)".
    amount: (s, side, copy) => {
      const st = l.steps[s.index];
      return st.whole && side === "have" ? `${copy} <span class="filled">(${num(s.given)} filled)</span>` : null;
    },
    extra: l.completed ? null : (s) => stepButtons(l, s.index, s.method === ESTIMATE),
    // Under the next step, when a scan seems to show its order up: Yes starts it from that scan, No hides it for good.
    after: (s) => {
      const seen = orderSeenAt(l, s.index, s), id = `${l.id}|${s.index}`;
      return seen == null ? "" : `<tr class="hint-row"><td colspan="8"><div class="hint-line"><span>Similar order detected. Was it yours?</span>
        <button type="button" class="go" data-listing-yes="${id}">Yes</button><button type="button" data-listing-no="${id}">No</button></div></td></tr>`;
    },
  };
  // Never dimmed, unlike a route that isn't worth doing: it's started, and its line and steps say what's wrong.
  return wrap(`<h3 class="split"><span>${routeSummary(r, listingHours(l, r))}</span>
    <span>${path}</span></h3>${stepsHtml({ ...r, steps: r.rows }, cells)}`);
}

// "Are you sure?" under what asks it: `text`, then Yes (red) and Cancel, ids `${id}-yes` and `${id}-cancel`.
const confirmBox = (text, id) => `<div class="confirm">${text} Are you sure?
  <div class="choices"><button id="${id}-yes" class="destructive">Yes</button><button id="${id}-cancel">Cancel</button></div></div>`;

// A tab's Clear All (My Listings' Completed), under the tabs at the left: red, disabled with
// nothing to clear, asking first ("This removes 3 completed listings for Allflame. Are you sure?"). `id` names its buttons.
const clearAll = (id, asking, n, what) => `<p class="clear-all"><button id="${id}" class="destructive"${n ? "" : " disabled"}>Clear All</button></p>
  ${asking ? confirmBox(`This removes ${n} ${what} for ${esc(league())}.`, id) : ""}`;

// My Listings (SPEC.md §4.6): Active (#/my-listings) and Completed (#/my-listings/completed).
function listingsPage(completed) {
  const tab = (c) => `<a href="#/my-listings${c ? "/completed" : ""}" class="${c === completed ? "active" : ""}">${c ? "Completed" : "Active"} (${num(leagueListings(c).length)})</a>`;
  const list = leagueListings(completed).sort((a, b) => b.added - a.added);
  const done = leagueListings(true).length;
  return `<div class="tabs">${tab(false)}${tab(true)}</div>
    ${completed ? clearAll("remove-completed", pendingRemoveCompleted, done, `completed listing${done === 1 ? "" : "s"}`) : ""}
    ${list.length ? list.map(listingBox).join("")
      : `<p class="muted">${completed ? `No completed listings for ${esc(league())}.`
        : `Nothing listed for ${esc(league())}. Use Add to My Listings on a trade's page to follow it here.`}</p>`}`;
}

// An item page's route: how many active listings it has (the same item and path, any amount), then Add to My Listings.
function addListingFoot(item, r) {
  const n = leagueListings(false).filter((l) => l.item === item.id && l.routeId === r.route.id && l.base === r.base).length;
  return `<div class="listing-foot">${n ? `<a class="count-pill" href="#/my-listings" title="${n} active listing${n === 1 ? "" : "s"} of this trade">${n}</a>` : ""}
    <button type="button" data-add-listing="${r.route.id}">Add to My Listings</button></div>`;
}
function addListing(item, mode, routeId) {
  const { method, estimate = false } = MODES[mode];
  const r = allResults(ratios(), item.id, start(), method, methodsFor(item.id, mode), baseId(), estimate)
    .find((x) => x.route.id === routeId);
  if (!r || r.missing) return;
  listings().push({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, league: league(), item: item.id, routeId,
    base: baseId(), start: start(), mode, added: Date.now(), completed: false,
    expected: { gain: r.gain, leftovers: r.leftovers, rank: r.rank },
    // An Estimate step is Competitive once its pair is scanned.
    methods: r.steps.map((s) => (s.method === ESTIMATE ? SLOW : s.method)), steps: r.steps.map(() => ({ state: "waiting" })),
  });
  store.save();
}

// Two tabs: Modified (`#/page`, the default; `#/page/modified` works too) and All
// (`#/page/all`).
const tabs = (page, modified, onlyModified) => {
  const tab = (href, text, active) => `<a href="${href}" class="${active ? "active" : ""}">${text}</a>`;
  return `<div class="tabs">${tab(`#/${page}`, `Modified (${modified})`, onlyModified)}${tab(`#/${page}/all`, "All", !onlyModified)}</div>`;
};

// Imported Ratios (#/imported-ratios): the currencies with a ratio scanned in the last 4 hours, with search and paging, each
// showing every line of a currency (vs Chaos and vs Divine) even if only one is scanned.
function ratesPage() {
  const has = (g) => g.lines.some(lineScanned);
  if (!has(hubGroup()) && !items().map(itemGroup).some(has)) {
    return `<p class="muted">No rates have been scanned for ${esc(league())} in the last 4 hours. ${importHint()}</p>`;
  }
  const found = items().filter((i) => matches(i.name)).map(itemGroup).filter(has);
  // The latest read first (after Chaos ↔ Divine, which always leads when it's in the list).
  const readAt = (g) => Math.max(...g.lines.flatMap(([a, b]) => [rowKey(a, b), rowKey(b, a)]).map((k) => ratioOf(k)?.verifiedAt ?? 0));
  found.sort((x, y) => readAt(y) - readAt(x));
  const lead = [hubGroup()].filter(has);
  return `${searchBox("Search currencies")}
    ${pager(found.length)}
    ${lead.length || found.length ? ratioTable([...lead, ...paged(found)]) : `<p class="muted">No matches.</p>`}
    ${pager(found.length)}`;
}

// Trade Volumes (#/trade-volumes): every currency (the hubs too) with how many of it traded last hour in all its hub
// markets (Currency / hr), then a column per hub ("[icon] / hr") with how many of that hub changed hands in its market
// with the currency (blank for a hub's own), each followed by its pair's scan age. Counts, not worth. Sorted by any column (click its header, again to reverse; for the
// session): by default Currency / hr, most first.
let volumeSort = { key: "total", desc: true };
function volumesPage() {
  const lg = rates.leagues[league()], hubs = currencies.hubs;
  const ids = [...hubs, ...items().map((i) => i.id)].filter((id) => matches(nameOf(id)));
  // How many of `id` traded in all its hub markets, and how many of hub `h` changed hands for it (null for a hub's own).
  const total = (id) => hubs.reduce((sum, h) => sum + (h === id ? 0 : pairVolume(lg, id, h)?.[0] ?? 0), 0);
  const paid = (id, h) => (h === id ? null : pairVolume(lg, id, h)?.[1] ?? 0);
  const value = (id, key) => (key === "name" ? null : key === "total" ? total(id) : paid(id, key) ?? -1);
  const dir = volumeSort.desc ? -1 : 1;
  ids.sort((x, y) => dir * (volumeSort.key === "name" ? nameOf(x).localeCompare(nameOf(y)) : value(x, volumeSort.key) - value(y, volumeSort.key)));
  const header = (key, label) => {
    const arrow = volumeSort.key === key ? (volumeSort.desc ? " ▼" : " ▲") : "";
    return `<th${key === "name" ? "" : ' class="num"'}><button class="sort${volumeSort.key === key ? " active" : ""}" data-volume-sort="${key}">${label}${arrow}</button></th>`;
  };
  // id: whose count it is, its icon first; none in a hub's column, whose header has the hub's icon.
  const cell = (n, id) => `<td class="num">${n === null ? "" : id ? qty(n, id) : num(n)}</td>`;
  // A hub count's age tag, in a narrow column of its own after it (no header) so the counts stay lined up: the pair's
  // older price read, either way round (none never scanned).
  const ageCell = (id, h) => {
    const keys = h === id ? [] : [rowKey(id, h), rowKey(h, id)].filter(isScanned);
    const oldest = keys.sort((x, y) => ratioOf(x).verifiedAt - ratioOf(y).verifiedAt)[0];
    return `<td class="age">${oldest ? scanTag(oldest) : ""}</td>`;
  };
  return `${searchBox("Search currencies")}
    ${pager(ids.length)}
    ${ids.length ? `<div class="scroll"><table class="volumes">
      <thead><tr>${header("name", "Currency")}${header("total", "Currency / hr")}${hubs.map((h) => `${header(h, `${iconOnly(h)} / hr`)}<th class="age"></th>`).join("")}</tr></thead>
      <tbody>${paged(ids).map((id) => `<tr><td><a href="#/item/${itemOf(id).slug}/available">${icon(id)}${esc(nameOf(id))}</a></td>
        ${cell(total(id), id)}${hubs.map((h) => cell(paid(id, h)) + ageCell(id, h)).join("")}</tr>`).join("")}</tbody>
    </table></div>` : `<p class="muted">No matches.</p>`}
    ${pager(ids.length)}`;
}

// ---------- render + events ----------

function renderHeader() {
  const select = $("#league");
  select.innerHTML = listedLeagues(rates)
    .map((name) => `<option value="${esc(name)}" ${name === league() ? "selected" : ""}>${esc(name)}</option>`)
    .join("");
}

function render() {
  const [, page, arg, modeArg] = location.hash.split("/");
  if (!page) {
    location.replace("#/home"); // no page (e.g. /poe1, #/): the game's home page; hashchange renders it
    return;
  }
  const home = page === "home";
  // Trade Recommendations: #/trade-recommendations[/<mode>]; item pages: #/item/<id>/<mode>.
  const mode = (page === "trade-recommendations" ? arg : modeArg) ?? DEFAULT_MODE; // a mode not in MODES fails to draw
  const navTarget = home || ["my-listings", "trade-volumes", "imported-ratios"].includes(page) ? page : "trade-recommendations"; // item pages are under Trade Recommendations
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#/${navTarget}`));
  // The League dropdown is filled from the rates, so it shows once they've loaded.
  $(".league").hidden = !rates;
  $('nav a[href="#/my-listings"] span').textContent = rates ? `My Listings (${num(leagueListings(false).length)})` : "My Listings";
  fitNav();
  // Home shows at once and loads the rates behind it (for the League dropdown; a failure there is retried by
  // the next page). Every other page needs them, so it waits.
  if (home && !rates) loadData().then(() => { $(".league").hidden = false; }, () => {});
  if (!home && !rates) {
    main.innerHTML = `<p class="muted">Loading rates…</p>`;
    loadData().then(render, () => { main.innerHTML = `<p class="load-error" role="alert">${ERROR_ICON}<span>Couldn't load rates. Try reloading the page.</span></p>`; });
    return;
  }
  if (rates) store.dropOld(league(), Date.now() - store.SCAN_FOR); // scans in use only (SPEC.md §5)
  const content = home ? $(`#home-${game.id}`).innerHTML
    : page === "item" ? itemPage(decodeURIComponent(arg ?? ""), mode)
    : page === "my-listings" ? listingsPage(arg === "completed")
    : page === "imported-ratios" ? ratesPage()
    : page === "trade-volumes" ? volumesPage()
    : summaryPage(mode);
  const before = markNext ? rowTexts() : null;
  markNext = false;
  // The Cancelled box or a Manual ratio being typed in keeps the focus, and what's typed, through the redraw.
  const typing = document.activeElement?.id === "cancel-left" ? document.activeElement.value : null;
  const ratioTyping = document.activeElement?.id === "manual-ratio" ? document.activeElement.value : null;
  const typedTyping = document.activeElement?.id === "typed-ratio" ? document.activeElement.value : null;
  main.innerHTML = content
    + liveDialog()
    + ratioDialog()
    + cancelBox();
  markChanges(before);
  // The import window is docked beside the page, which stays usable; the price window is modal, over it too.
  const docked = $("#live-dialog");
  if (docked) {
    placeUnderHeader();
    docked.show();
    // show() puts the focus on its first button (the help button, ringed): the page is still the one in use.
    if (docked.contains(document.activeElement)) document.activeElement.blur();
    if (live?.watch?.video) drawPreview(live.watch.video); // straight back, not the stand-in till the next look
  }
  placeCancelBox();
  if (typing != null && $("#cancel-left")) Object.assign($("#cancel-left"), { value: typing }).focus();
  if (ratioTyping != null && $("#manual-ratio")) Object.assign($("#manual-ratio"), { value: ratioTyping }).focus();
  const dialog = $("#ratio-dialog");
  if (dialog) {
    dialog.showModal();
    if ($("#typed-ratio")) Object.assign($("#typed-ratio"), typedTyping != null ? { value: typedTyping } : {}).focus();
    dialog.addEventListener("close", () => { // Esc or its ×
      endDialog();
      // The text box clicked to close it keeps the focus through the redraw.
      const { id } = document.activeElement ?? {};
      render();
      if (id) document.getElementById(id)?.focus();
    });
  }
}

// After a scan, whatever it changed on the page behind the dialog lights up and fades (SPEC.md §4.7): a Trade
// Recommendations row, an item page's route, a Imported Ratios block (each marked data-row). It's kept across the redraws while
// it fades, picking up where it was.
const CHANGED_FOR = 4000;
let markNext = false;
const lit = new Map(); // data-row -> when it changed
const rowTexts = () => new Map([...main.querySelectorAll("[data-row]")].filter((el) => !el.closest("dialog"))
  .map((el) => [el.dataset.row, el.textContent]));
function markChanges(before) {
  const now = Date.now();
  if (before) for (const [key, text] of rowTexts()) if (before.get(key) !== text) lit.set(key, now);
  for (const [key, at] of lit) if (now - at > CHANGED_FOR) lit.delete(key);
  for (const el of main.querySelectorAll("[data-row]")) {
    const at = lit.get(el.dataset.row);
    if (at === undefined || el.closest("dialog")) continue;
    el.classList.add("changed");
    el.style.animationDelay = `${at - now}ms`;
  }
}

// The price window closed: nothing open in it any more.
function endDialog() {
  editLines = null;
  editingTyped = null;
}

// The import window's stop button: sharing the game's window stops, and the window hides to its strip.
function stopLive() {
  closeLive();
  hideWindow(true);
}
// The import window hidden to its strip, or shown: hidden, an item page's routes re-sort if a scan changed a price.
function hideWindow(hidden) {
  windowHidden = hidden;
  if (!hidden) return;
  panelHelp = false;
  if (resortOnClose) routeOrder.clear();
  resortOnClose = false;
}

// The price window: Market/Alt ratios for the pairs in editLines (from a Ratio cell or header). Lives inside main;
// re-opened after each render while it's set.
function ratioDialog() {
  if (!editLines) return "";
  const full = (id) => `${icon(id)}${esc(nameOf(id))}`;
  // For each pair: its name first, then the two column headings directly above the prices they label. One table for all
  // pairs so their columns line up. Prices are read with Import Market Ratios (the header's); on My Listings they can be
  // typed over too.
  const typing = location.hash.startsWith("#/my-listings");
  const block = ([a, b]) => `<tbody class="dialog-pair">
    <tr class="group"><th colspan="12"><div class="dialog-title"><span>${full(a)} ↔ ${full(b)}</span></div></th></tr>
    <tr class="cols"><th colspan="6">Available Trades</th><th colspan="6">Competing Trades</th></tr>
    ${ratioLine([a, b], false, true, typing)}
  </tbody>`;
  return `<dialog id="ratio-dialog">
    <button id="dialog-close" class="close" aria-label="Close" title="Close">×</button>
    <table class="ratios">${editLines.map(block).join("")}</table>
  </dialog>`;
}

// Import Market Ratios: on its left edge a strip (the recording light above an arrow) that hides the window to just the
// strip and shows it again; then a title bar (the window's name, then its stop button and its help button at the right, a
// line under both), then just the panel; the pairs it reads show on the page behind. When it isn't watching (not started yet,
// or sharing cancelled or stopped), its footer has the button that shares the game's screen, under the panel's line, at
// the right.
function liveDialog() {
  const what = windowHidden ? "Show the import window" : "Hide the import window";
  return `<dialog id="live-dialog" class="live${windowHidden ? " collapsed" : ""}">
    <button type="button" class="live-tab" data-live-tab title="${what}" aria-label="${what}" aria-expanded="${!windowHidden}">${recLight()}<span aria-hidden="true">${windowHidden ? "‹" : "›"}</span></button>
    <div class="live-window">
    <div class="dialog-head"><h2>${IMPORT_NAME}</h2><span class="head-actions">${helpButton()}${shareButton()}</span></div>
    <table class="ratios"><tbody class="live-import"><tr class="live-panel"><td colspan="12">${livePanel()}</td></tr></tbody></table>
    </div>
  </dialog>`;
}
// The import window, always on the page, hidden to its strip until its arrow or Import Market Ratios shows it (either
// again hides it; Esc doesn't, as it cancels other things). Sharing hides it; stopping the share (its stop button, or the browser's) hides it too, but
// a share that fails shows it, to say why.
let windowHidden = true;
// The recording light: dim, pulsing red while it watches and reads, solid red while the game's window can't be seen.
const recLight = () => {
  const w = live?.watch, kind = !w?.stream ? "" : w.lost ? " lost" : " on";
  return `<span class="rec-light${kind}" aria-hidden="true"></span>`;
};
// After the help button: the record button, which shares the game's window, or while it shares the stop button (none
// where the browser can't share a window).
const shareButton = () => (live?.watch ? `<button id="live-stop" class="close stop" aria-label="Stop" title="Stop">${STOP_ICON}</button>`
  : CAN_WATCH ? `<button type="button" class="close record" data-live-watch aria-label="${SHARE_NAME}" title="${SHARE_NAME}">${RECORD_ICON}</button>` : "");
// The record button: a red dot in a circle, the help button's size.
const RECORD_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle class="record-dot" cx="10" cy="10" r="4.5"/></svg>`;
// The stop button: a square in a circle, the help button's circle's size with a thicker line; grey, red under the mouse.
const STOP_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="6.5" y="6.5" width="7" height="7" rx="1" fill="currentColor"/></svg>`;

// ---------- what a frame read gives (SPEC.md §4.7) ----------

// The boxes a reading fills. The game shows "want : have", its I Want the pair's first currency. Its Available Trades
// list is row have>want (filling orders), Competing row want>have. Only the lists read are filled.
function liveFills([want, have], found) {
  const fill = (r, key, value, digits) => ({ key, value, digits, stock: r.stock });
  const out = [];
  // Each list's every price and stock too, hidden: the row's orders (SPEC.md §3.2a), with the "worse than" row's stock
  // (everything beyond the list) apart. Available's row is have>want, Competing's want>have, each in its key's order.
  const levels = (list, ratioOf) => ({ levels: found[list].map((x) => ({ ratio: ratioOf(x), stock: x.stock })), rest: found.rest?.[list]?.stock ?? null });
  if (found.available) {
    const r = found.available[0];
    out.push({ ...fill(r, rowKey(have, want), [r.have.value, r.want.value], [r.have.digits, r.want.digits]),
      list: levels("available", (x) => [x.have.value, x.want.value]) });
  }
  if (found.competing) {
    const r = found.competing[0];
    out.push({ ...fill(r, rowKey(want, have), [r.want.value, r.have.value], [r.want.digits, r.have.digits]),
      list: levels("competing", (x) => [x.want.value, x.have.value]) });
  }
  return out;
}

// Whether a reading of the pair [want, have] has its best price (Available's, else Competing's) over 3x off every
// average the pair has (its latest hour, recent hours and last days; else its current ratio), as a reading of a
// different pair would be. One thin hour can be far off the rest: 1,620 Transmutation for 4 Chaos, 405 each, where the
// recent hours and the days say 231 and 257 and the game 103.
function farOff([a, b], found) {
  const r = (found.available ?? found.competing)[0];
  const price = r.have.value / r.want.value; // per unit wanted
  const cur = store.ratioValues(league())[rowKey(a, b)];
  const avg = pairPrices(rates.leagues[league()], a, b); // b per a
  const refs = avg.length ? avg : cur ? [cur[1] / cur[0]] : [];
  return refs.length > 0 && refs.every((ref) => Math.abs(Math.log(price / ref)) > Math.log(3));
}

function closeLive() {
  if (live?.watch) endWatch(live.watch, "sharing was stopped or started again");
  live = {};
}

// The price reader's worker, started once with the catalog's names. false if it can't be started.
async function loadReader() {
  if (reader) return true;
  try {
    const worker = new Worker(new URL("./reader.js", import.meta.url), { type: "module" });
    const ok = await new Promise((done) => {
      worker.onmessage = ({ data }) => done(!!data.ready);
      worker.onerror = () => done(false);
      worker.postMessage({ names: catalogNames() });
    });
    if (!ok) { worker.terminate(); return false; }
    let id = 0;
    const waiting = new Map();
    worker.onmessage = ({ data }) => { waiting.get(data.id)?.(data); waiting.delete(data.id); };
    reader = (msg, transfer) => new Promise((done) => { msg.id = ++id; waiting.set(msg.id, done); worker.postMessage(msg, transfer); });
    return true;
  } catch {
    return false;
  }
}

// ---------- watching the game (SPEC.md §4.7) ----------
// Import Market Ratios: the game's window, shared with the browser, is glanced at every LIVE_GLANCE (a tiny copy of
// it) and read only when that changed since the last read: holding Alt is seen at once. A read takes a tenth to half a
// second with the hover box, much less without.
const LIVE_GLANCE = 100, WINDOW_KEPT = 15000, PREVIEW_EVERY = 100;
// A double click (two short clicks, no tone) each time watching the game reads prices: Import Market Ratios filling in a pair,
// a pair's own Import taking its frame. The game is usually in front, so the page can't be seen. Browsers only make
// sound after a click on the page, so it's readied by the share button's.
const CLICK_VOLUME = 0.5, CLICK_GAP = 0.09;
let audio = null;
function readySound() {
  try {
    audio ??= new AudioContext();
    audio.resume();
  } catch {
    audio = null; // no Web Audio: no sound
  }
}
function scanSound() {
  if (!audio) return;
  // Each click: two pitches together dying away within a few milliseconds, too short to hear as a tone; peaking
  // at CLICK_VOLUME (full scale is 1).
  const rate = audio.sampleRate, n = Math.round(0.04 * rate), buf = audio.createBuffer(1, n, rate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    d[i] = Math.exp(-t / 0.005) * (Math.sin(2 * Math.PI * 1300 * t) + 0.6 * Math.sin(2 * Math.PI * 700 * t));
  }
  const peak = d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  for (let i = 0; i < n; i++) d[i] *= CLICK_VOLUME / peak;
  const t = audio.currentTime + 0.01;
  for (const at of [0, CLICK_GAP]) {
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(audio.destination);
    src.start(t + at);
  }
}

async function startWatch() {
  readySound();
  closeLive();
  const watch = { since: Date.now() };
  const mine = (live = { watch });
  render();
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "window" }, audio: false });
  } catch {
    if (live === mine) stopWatch(mine, "Sharing was cancelled.");
    return;
  }
  if (live !== mine) { stream.getTracks().forEach((t) => t.stop()); return; }
  const video = document.createElement("video");
  Object.assign(video, { muted: true, playsInline: true, srcObject: stream });
  Object.assign(watch, { stream, video });
  // onended, not addEventListener: in Firefox 157 a track's listeners missed an ended event that onended got. The
  // track's readyState is checked on every look anyway (watchCheck).
  const track = stream.getVideoTracks()[0];
  if (track) track.onended = () => { if (live === mine) stopWatch(mine, "Sharing was cancelled."); };
  try {
    await video.play();
  } catch {
    if (live === mine) stopWatch(mine, "The shared window can't be shown.", "warn");
    return;
  }
  if (!(await loadReader())) {
    if (live === mine) stopWatch(mine, "Couldn't load the price reader.", "error");
    return;
  }
  // The preview is checked on its own, PREVIEW_EVERY, so it's back soon after the panel is drawn again.
  const paint = () => { if (watch.ended) return; drawPreview(video); watch.paint = setTimeout(paint, PREVIEW_EVERY); };
  windowHidden = true; // watching: out of the way, to its strip
  render();
  paint();
  watchNext(mine);
}
function endWatch(watch, why) {
  clearTimeout(watch.timer);
  clearTimeout(watch.paint);
  watch.stream?.getTracks().forEach((t) => t.stop());
  if (watch.ended) return;
  watch.ended = true;
  debug?.ended(watch, why);
}
// Stop watching, saying why: the panel stays, to share again. Stopped from the browser, the window hides to its strip; a
// share that failed shows it, to say why.
function stopWatch(mine, note, kind = "") {
  endWatch(mine.watch, note);
  live = kind === "error" ? { error: note } : { note, warn: kind === "warn" };
  hideWindow(!kind);
  render();
}
// ?debug in the address loads js/debug/watch.js: what watching sees, for a share that won't read (SPEC.md §4.7).
let debug = null;
if (new URLSearchParams(location.search).has("debug")) import("./debug/watch.js").then((m) => { debug = m; render(); });
// While watching, the shared window as it's seen, at most PREVIEW_W wide: the shared video itself, which
// the browser plays however busy reading keeps the page. Drawing the panel again takes it out of the page, which
// pauses it, so it's put back (and played) into the panel's slot.
function drawPreview(video) {
  const slot = $(".live-preview-slot");
  if (!slot || !video.videoWidth) return;
  const scale = previewScale(video.videoWidth), w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
  if (video.width !== w || video.height !== h) [video.width, video.height] = [w, h];
  if (video.parentNode !== slot) {
    video.className = "live-image live-preview";
    slot.replaceChildren(video);
  }
  if (video.paused) video.play().catch(() => {});
}
// The next look, after `wait`.
const watchNext = (mine, wait = LIVE_GLANCE) => { mine.watch.timer = setTimeout(() => watchCheck(mine), wait); };
// A look: the window at 96 x 54, as grey levels. Where the game's window was found, just the window (its lists and names):
// the game moving round it isn't a change.
const GLANCE_W = 96, GLANCE_H = 54;
function glance(watch) {
  const c = (watch.small ??= Object.assign(document.createElement("canvas"), { width: GLANCE_W, height: GLANCE_H }));
  const g = c.getContext("2d", { willReadFrequently: true });
  const { video, region: r } = watch;
  if (r) g.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, GLANCE_W, GLANCE_H);
  else g.drawImage(video, 0, 0, GLANCE_W, GLANCE_H);
  const d = g.getImageData(0, 0, GLANCE_W, GLANCE_H).data, out = new Uint8Array(GLANCE_W * GLANCE_H);
  for (let i = 0; i < out.length; i++) out[i] = (d[4 * i] + d[4 * i + 1] + d[4 * i + 2]) / 3;
  return out;
}
// The game's window in a frame, from its buttons (findWindows): a little wider than they are, down past Competing's
// last row; null without one.
function regionOf(win, video) {
  if (!win) return null;
  const span = win.right - win.left, x = Math.max(0, Math.round(win.left - 0.05 * span)), y = Math.max(0, Math.round(win.y - 0.05 * span));
  const w = Math.min(video.videoWidth, Math.round(win.right + 0.05 * span)) - x, h = Math.min(video.videoHeight, Math.round(win.y + 0.75 * span)) - y;
  return w > 20 && h > 20 ? { x, y, w, h } : null;
}
// The share of a look that changed by more than 12 levels since `was`; over 1.5% is a change worth reading.
function changeOf(was, now) {
  let n = 0;
  for (let i = 0; i < now.length; i++) if (Math.abs(now[i] - was[i]) > 12) n++;
  return n / now.length;
}
const CHANGED = 0.015;
// One look at the game (liveRead decides what a read is worth). A window that hasn't changed since the last read
// isn't read again: it would read the same. A cursor is too small to count as a change, so after a read that saw the
// hover box (`hover`) but not both lists (nor one with the other shown empty), a cursor over them perhaps, the next look
// reads again.
async function watchCheck(mine) {
  const { watch } = mine;
  if (live !== mine) return;
  const { video, stream } = watch;
  if (stream.getVideoTracks().every((t) => t.readyState === "ended")) {
    stopWatch(mine, "Sharing was cancelled.");
    return;
  }
  if (!video.videoWidth) { debug?.looked(watch, false); watchNext(mine); return; }
  const now = glance(watch);
  // An unchanged window isn't read again.
  const change = watch.last ? changeOf(watch.last, now) : 1;
  if (watch.last && !watch.again && change <= CHANGED) {
    debug?.looked(watch, true, change);
    // The same frame still there: a reading waiting on a second look is confirmed.
    if (watch.pending) livePending(mine);
    if (live === mine) watchNext(mine);
    return;
  }
  // The frame goes to the reader (js/reader.js) as a bitmap: the page isn't held up while it's read. Kept for ?debug
  // only, to save the frames that matter.
  const drawing = performance.now(), bitmap = await createImageBitmap(video), handed = performance.now();
  const frame = debug ? await createImageBitmap(bitmap) : null;
  // A frame that misses the window soon after one showed it (the game redrawing it as Alt goes down) is read where the
  // window last was: as quick as any read. Without it for longer, nothing's read (the lists are read only within it).
  const recent = !!watch.win && Date.now() - watch.winAt < WINDOW_KEPT;
  const got = await reader({ bitmap, style: game.window, last: recent ? watch.win : null, crops: watch.pending && !watch.pending.held ? watch.pending.crops : null, debug: !!debug }, [bitmap]);
  if (live !== mine) return;
  // Import Market Ratios, a reading waiting on its second read: if the names and best prices haven't moved, that's it.
  if (got.same) {
    watch.last = now;
    debug?.note(watch, "live: same names and best prices, confirmed without reading again");
    livePending(mine);
    if (live === mine) watchNext(mine);
    return;
  }
  const found = got.found ?? {}, win = found.window ?? null, parts = got.parts ?? {};
  if (win) [watch.win, watch.winAt] = [win, Date.now()];
  const readMs = (parts.copy ?? 0) + (parts.grey ?? 0) + (parts.find ?? 0);
  // Glanced at from now on where the window is (where it last was, just after a miss; the whole frame without one).
  const region = win ? regionOf(win, video) : recent ? watch.region ?? null : null;
  const same = JSON.stringify(region) === JSON.stringify(watch.region ?? null);
  watch.region = region;
  watch.last = same ? now : glance(watch);
  watch.lost = !win && !recent;
  watch.again = !!found.hover && !(found.available && found.competing) && !found.empty;
  debug?.read(watch, { found, ms: readMs, win, frame, lastPlace: !win && recent, parts: { ...parts, draw: handed - drawing + (parts.draw ?? 0) } });
  liveRead(mine, got);
  if (live !== mine) return;
  const status = $(".live-watch-status")?.closest(".live-status");
  if (status) status.outerHTML = watchStatus(watch);
  const light = $("#live-dialog .rec-light");
  if (light) light.outerHTML = recLight();
  // A shorter rest than a read, and none while a reading waits on its second read.
  watchNext(mine, watch.pending && !watch.pending.held ? 0 : Math.max(LIVE_GLANCE, 0.5 * readMs));
}
// Import Market Ratios (SPEC.md §4.3): a frame counts only when it's certain: both lists read, or one where the game
// shows the other has no trades (`empty`, findListsIn's), both names read as catalog currencies (I Want on the left,
// I Have on the right), a pair the site keeps, a price within 3x of the pair's hourly average, and the same pair and
// best prices again (in the next frame read, or the same frame still there at the next look; the stock under them may
// change between the two, as people trade). Anything less is passed over. The newest reading is filled in: with a
// sound when its prices are new, quietly when only the stock changed.
function liveRead(mine, { found = {}, names, ranks, crops, failed }) {
  const { watch } = mine;
  const [want, have] = names ? names.map((n) => n && idOfName(n)) : [null, null];
  const why = failed ? `the reader failed (${failed})` : !names ? "not both lists, nor one with the other shown empty"
    : !want || !have ? `names not certain${ranks ? ` (${ranks.join("; ")})` : ""}`
    : want === have || !(isBase(want) || isBase(have)) ? `not a pair kept here (${nameOf(want)}, ${nameOf(have)})`
    : farOff([want, have], found) ? "price over 3x off the hourly average" : null;
  // A pair's price box gone (no box shown, or another pair's): shown again, it's a new hover, imported again.
  const shown = !why ? [want, have].sort().join("|") : null;
  for (const [id, was] of Object.entries(watch.applied ?? {})) if (!found.hover || (shown && id !== shown)) was.gone = true;
  if (why) {
    watch.pending = null;
    debug?.note(watch, `live: ${why}`);
    return;
  }
  const best = (list) => list && `${list[0].want.text}:${list[0].have.text}`;
  const prices = JSON.stringify([want, have, best(found.available), best(found.competing)]);
  const full = JSON.stringify([want, have, found.available, found.competing, found.rest ?? null]);
  if (watch.pending?.prices === prices) {
    Object.assign(watch.pending, { full, found });
    livePending(mine);
  } else {
    watch.pending = { prices, full, pair: [want, have], found, crops, since: Date.now() };
    debug?.note(watch, `live: ${nameOf(want)} / ${nameOf(have)} read, waiting for a second read`);
  }
}
// A pair imported in the last LIVE_HOLD (either way round) isn't imported again until that's up, unless that import had
// one list and this has both: a reading of it then waits (taken when the time's up if it's still there), and the next
// one read replaces it. The very reading last imported isn't imported again while its box stays up; shown again after
// the box has gone, it is, with the click. Available alone with no banner is also what a hover without Alt shows, so
// it's only taken once it has shown for ALT_WAIT (time to press Alt).
const LIVE_HOLD = 10000, ALT_WAIT = 3000;
function livePending(mine) {
  const { watch } = mine, { prices, full, pair, found, since } = watch.pending;
  watch.pending = null;
  const id = [...pair].sort().join("|"), was = (watch.applied ??= {})[id];
  const hold = (why) => {
    // Still waiting, so a frame that doesn't change is taken once the time is up (it isn't read again).
    watch.pending = { prices, full, pair, found, since, held: true };
    debug?.note(watch, `live: ${why}, held`);
  };
  if (found.empty === "competing" && Date.now() - since < ALT_WAIT) return hold("Available alone, waiting for Alt");
  if (was && Date.now() - was.at < LIVE_HOLD && !(was.oneList && !found.empty)) {
    return hold(`imported ${((Date.now() - was.at) / 1000).toFixed(1)} s ago`);
  }
  if (was?.full === full && !was.gone) { debug?.note(watch, "live: confirmed, already filled in"); return; } // this very hover
  watch.applied[id] = { prices, full, at: Date.now(), oneList: !!found.empty };
  useRead(pair, found);
  const fresh = was?.prices !== prices || was.gone;
  if (fresh) scanSound();
  debug?.note(watch, `live: imported ${nameOf(pair[0])} / ${nameOf(pair[1])}${!fresh ? " (stock only, quietly)" : was?.prices === prices ? " (shown again)" : ""}`);
  watch.imported = pair;
  // The box the game showed no trades for, kept as it was.
  watch.unread = found.empty && (found.empty === "available" ? rowKey(pair[1], pair[0]) : rowKey(...pair));
  render(); // the page behind the dialog shows it
  drawPreview(watch.video); // the panel was drawn again: its preview too, not only at the next look
}
// The latest pair's box with no trades, as the latest pair block names it: "available" or "competing", else null.
const unreadSide = (w) => (w.unread ? (w.unread === rowKey(...lineOf(...w.imported).reverse()) ? "available" : "competing") : null);
// Before anything's imported: whether the game's Currency Exchange window is in sight (its buttons, in the last
// WINDOW_KEPT), as nothing's read without it.
const liveStatus = (w) => (w.imported ? `Imported prices for ${w.imported.map(icon).join(" and ")}${unreadSide(w) ? ` (no ${unreadSide(w)} trades)` : ""}.`
  : w.lost ? CANT_SEE : "Waiting for price info.");
const CANT_SEE = "Can't see the Currency Exchange window.";
// The preview's stand-in: a screen, muted.
const PREVIEW_ICON = `<svg viewBox="0 0 48 40" aria-hidden="true"><rect x="3" y="3" width="42" height="27" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M17 37h14M24 30v7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
// The header's import: its name, and its steps behind the help button in its window's title bar.
const IMPORT_NAME = "Import Market Ratios";
// Where the browser can't share a window there's no way to read the game: the window says so instead.
const NO_SHARING = "Failed to share a window from this browser.";
const HELP_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.6 7.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="14.6" r="1.1" fill="currentColor"/></svg>`;
const helpButton = () => `<button class="help" data-panel-help title="How it works" aria-label="How it works" aria-pressed="${panelHelp}">${HELP_ICON}</button>`;
const importSteps = () => `<ol class="import-steps">
      <li>Start <b>${GAME_WINDOW}</b>.</li>
      <li>Click the <b>record button</b> (the red dot). Your browser asks which window to share: pick <b>${GAME_WINDOW}</b>.</li>
      <li>In the game, ${game.id === "poe1" ? "talk to Faustus and open" : "open"} the <b>Currency Exchange</b>. Choose one currency under <b>I Want</b> and one under <b>I Have</b>.</li>
      <li>Hover over <b>Market Ratio</b> and hold <b>Alt</b>.</li>
      <li>When you hear a click, that pair is saved. Repeat steps <b>3</b> to <b>5</b> for each pair.</li></ol>`;
// Import Market Ratios' panel: the status line, the latest pair read and the preview. The steps only show when the
// title bar's help button is on.
function livePanel() {
  if (!CAN_WATCH) return statusLine(NO_SHARING, "error");
  const status = live.error ? statusLine(esc(live.error), "error")
    : live.watch ? watchStatus(live.watch)
    : live.note ? statusLine(`${esc(live.note)}${live.warn ? WARN_SIGN : ""}`, "", !live.warn) : "";
  // The latest pair read, under the status line: its two prices as the boxes show them (the currencies by their icons,
  // no tags), so the page behind needn't be seen.
  const pair = live.watch?.imported, line = pair && lineOf(...pair);
  const shown = (key, flip) => (key === live.watch.unread ? `<td class="r-none muted" colspan="5">no trades</td><td class="r-tags"></td>`
    : ratioCells(line[0], line[1], key, flip, ""));
  const last = !line ? "" : `<div class="live-last">
    <table><tr><th>Available Trades</th>${shown(rowKey(line[1], line[0]), true)}</tr>
      <tr><th>Competing Trades</th>${shown(rowKey(line[0], line[1]), false)}</tr></table></div>`;
  const help = panelHelp ? importSteps() : "";
  // The preview's place is kept from the start: a stand-in the size it'll be (16:9, as wide as the panel) until the
  // shared window shows there.
  return `${help}<div class="live-box">${status}${last}<div class="live-preview-slot"><div class="live-image live-preview preview-wait" role="img" aria-label="Preview">${PREVIEW_ICON}</div></div></div>`;
}

// A read's prices into the pair's boxes and its order book (SPEC.md §3.2a).
function useRead(pair, found) {
  for (const f of liveFills(pair, found)) {
    store.setRatio(league(), f.key, f.value, f.digits, f.stock);
    store.setList(league(), f.key, f.list.levels, f.list.rest);
  }
  // The box the game showed empty is saved as read with no trades. "No available trades" the game says in words, but
  // Available alone is also what a hover without Alt shows, so a Competing price still in use (read in the last
  // SCAN_FOR, Alt let go since) stays.
  const [want, have] = pair;
  const none = found.empty === "available" ? rowKey(have, want) : found.empty === "competing" ? rowKey(want, have) : null;
  if (none && !(found.empty === "competing" && ratioOf(none)?.value)) store.setEmpty(league(), none);
  resortOnClose = true; // the routes behind re-sort when the dialog closes
  markNext = true;
}

// A warning sign (a triangle with "!"), after a status that needs a look.
const WARN_SIGN = `<svg class="warn-sign" viewBox="0 0 20 20" role="img" aria-label="Warning"><path d="M10 2.5 18.5 17h-17z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 7.5v4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14.4" r="1.1" fill="currentColor"/></svg>`;

// An error icon (a circle with "!"), before an error.
const ERROR_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 5.5v5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="10" cy="14.6" r="1.3" fill="currentColor"/></svg>`;
// The import window's status line (`html`: escaped already). An error is red, after the error icon.
// A `quiet` one is there for screen readers only: the window shows its status only when something's wrong.
const statusLine = (html, kind = "", quiet = false) => `<p class="live-status${kind ? ` live-status-${kind}` : ""}${quiet ? " quiet" : ""}" role="status">${
  kind === "error" ? ERROR_ICON : ""}<span>${html}</span></p>`;
// While it watches: shown, as an error, only when the game's window can't be seen.
const watchStatus = (w) => {
  const lost = !w.imported && w.lost;
  return statusLine(`<span class="live-watch-status">${liveStatus(w)}</span>`, lost ? "error" : "", !lost);
};

// The shared window's preview is shown at most PREVIEW_W wide, never enlarged.
const PREVIEW_W = 560, previewScale = (w) => Math.min(1, PREVIEW_W / w);
// Re-render after the browser has moved focus (e.g. Tab out of the Starting Amount), then put it back.
function renderKeepingFocus() {
  setTimeout(() => {
    const startBox = document.activeElement?.id === "start-amount";
    render();
    if (startBox) $("#start-amount")?.focus();
  });
}

// What fills orders on one side of a pair per hour (calc.js perHour): SIDE_SHARE of what the pair traded.
function paceOf(name, x, other) {
  const traded = perHourOf(rates.leagues[name], x, other);
  return traded == null ? null : traded * SIDE_SHARE;
}

// Every load and league switch: the league's volumes, stock, lists of orders and queues for the calculation.
function selectLeague(name) {
  store.state.league = name;
  store.save();
  setNoOrders(rates.leagues[name]?.noOrders);
  setPerHour((x, other) => paceOf(name, x, other));
  setStock((offered, other) => stockOn(rates.leagues[name], offered, other));
  setBooks((key) => bookFor(name, key));
  setAhead((key) => store.leagueState(name).ratios[key]?.stock ?? null);
  setUndercut((key) => undercutFor(name, key));
  setBought((key) => boughtFor(name, key));
  setReadEmpty((key) => !!store.leagueState(name).ratios[key]?.empty);
  setUsual((recv, give) => usualPrice(rates.leagues[name], give, recv));
  // A pair's estimate: its latest traded hour, when that's one of the last ESTIMATE_HOURS (SPEC.md §3.2c).
  setEstimate((recv, give) => latestPrice(rates.leagues[name], give, recv, rates.nextChangeId - ESTIMATE_HOURS * 3600));
  setTyped((key) => typedFor(key));
}
const ESTIMATE_HOURS = 4;
// How fast orders are posted ahead of a row's best price (SPEC.md §3.6), in what they offer per hour, measured from its
// reads of the last hour; null when it isn't measured.
const undercutFor = (name, key) => undercutRate(store.readsOf(name, key), Date.now());
// How fast a row's orders are bought (SPEC.md §3.6), in what they offer per hour, measured from its reads of the last
// hour; null when it isn't measured.
const boughtFor = (name, key) => boughtRate(store.readsOf(name, key), Date.now());
// A row's orders as last read from the game (SPEC.md §3.2a): only while they're under BOOK_FOR old and their best
// price is still the row's ratio (cleared, or the price read otherwise since, they no longer count).
const BOOK_FOR = 60 * 60 * 1000;
// Asked for every Instant step of every route of every item: the list first (almost always none), then
// just this row's ratio (not ratioValues, a copy of every ratio, which made Trade Recommendations take seconds).
function listFor(name, key) {
  const list = store.listOf(name, key);
  if (!list || Date.now() - list.at > BOOK_FOR) return null;
  const value = store.leagueState(name).ratios[key]?.value;
  if (!value) return null;
  const [best] = list.levels;
  return best.ratio[0] === value[0] && best.ratio[1] === value[1] ? list : null;
}
// An Instant step's order book: the levels, then the "worse than" row's stock counted at the last price.
function bookFor(name, key) {
  const list = listFor(name, key);
  return list && (list.rest == null ? list.levels : [...list.levels, { ratio: list.levels.at(-1).ratio, stock: list.rest }]);
}

main.addEventListener("change", (e) => {
  const input = e.target;
  if (input.id === "start-amount") {
    const n = Math.floor(Number(input.value));
    store.state.start[baseId()] = n > 0 ? n : 1;
    store.save();
    routeOrder.clear(); // the amounts change, so the item page's routes re-sort too
    renderKeepingFocus();
    return;
  }
  if (input.dataset.listingStep) {
    const [id, i] = input.dataset.listingStep.split("|"), [slot, k] = stepSlot(listingOf(id), Number(i));
    // Manual starts at the price last typed into it, else the price the step was using. Estimate is kept as Competitive:
    // it's an Estimate step while its pair has no scan, and Competitive once it has.
    const typed = slot[k]?.typed, method = input.value === ESTIMATE ? SLOW : input.value;
    slot[k] = method === MANUAL ? { method: MANUAL, ratio: typed ?? input.dataset.ratio.split(":").map(Number), typed }
      : typed ? { method, typed } : method;
    store.save();
    render();
    return;
  }
  if (input.dataset.step) {
    const [, , itemSlug, modeArg] = location.hash.split("/");
    const item = itemOf(decodeURIComponent(itemSlug));
    const [routeId, key] = input.dataset.step.split(/\|(.*)/s);
    const routes = methodsFor(item.id, modeArg ?? DEFAULT_MODE);
    (routes[routeId] ??= {})[key] = input.value;
    render();
    return;
  }
  if (input.dataset.manualRatio) {
    endRatio(true);
    return;
  }
});

// The Cancelled box (SPEC.md §4.6): Enter, or a click outside it, takes what's typed (nothing typed: it just closes);
// its × or Esc closes it, the step as it was.
function endCancel(take) {
  if (!cancelling) return;
  const [id, i] = cancelling.split("|"), box = $("#cancel-left");
  if (take && box?.value !== "" && !cancelStep(listingOf(id), Number(i), box?.value)) {
    box?.setAttribute("aria-invalid", "true"); // more than it had: the box stays, saying so
    return;
  }
  cancelling = null;
  render();
}
// A Manual step's number box: Enter, or leaving it, takes what's typed (rounded as the game shows ratios; blank or 0, which
// no price is, keeps the ratio as it was); Esc leaves the ratio as it was.
function endRatio(take) {
  if (!editingRatio) return;
  const [id, i, side] = editingRatio.split("|"), [slot, k] = stepSlot(listingOf(id), Number(i));
  const v = roundHalfUp(Number($("#manual-ratio")?.value), 2);
  editingRatio = null;
  if (take && v > 0 && slot[k]?.ratio) {
    const ratio = [...slot[k].ratio];
    ratio[Number(side)] = v;
    slot[k] = { method: MANUAL, ratio, typed: ratio };
    store.save();
  }
  render();
}
// A number box in the price window on My Listings (SPEC.md §4.6): as a Manual step's, what's typed becomes that row's typed
// price (only when it changes the price).
function endTyped(take) {
  if (!editingTyped) return;
  const [key, side] = editingTyped.split("|"), [x, y] = key.split(">");
  const v = roundHalfUp(Number($("#typed-ratio")?.value), 2), was = typedFor(key) ?? ratioOf(key)?.value ?? estimateRatio(x, y);
  editingTyped = null;
  if (take && v > 0 && was && was[Number(side)] !== v) {
    const value = [...was];
    value[Number(side)] = v;
    store.setTyped(league(), key, value);
  }
  render();
}
main.addEventListener("keydown", (e) => {
  if (!["manual-ratio", "typed-ratio"].includes(e.target.id) || !["Enter", "Escape"].includes(e.key)) return;
  e.preventDefault(); // nor does Esc close the price window
  e.stopPropagation(); // not the import window's Esc
  (e.target.id === "manual-ratio" ? endRatio : endTyped)(e.key === "Enter");
}, true);
main.addEventListener("focusout", (e) => {
  if (!e.target.isConnected) return; // not the box a redraw takes away
  if (e.target.id === "manual-ratio") endRatio(true);
  if (e.target.id === "typed-ratio") endTyped(true);
});
main.addEventListener("submit", (e) => {
  if (!e.target.matches("[data-cancel-form]")) return;
  e.preventDefault();
  endCancel(true);
});
main.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !cancelling) return;
  e.stopPropagation(); // not the import window's Esc
  endCancel(false);
}, true);
document.addEventListener("pointerdown", (e) => {
  if (cancelling && !e.target.closest("#cancel-box, [data-listing-cancel]")) endCancel(true);
}, true);
window.addEventListener("resize", () => placeCancelBox());
window.addEventListener("scroll", () => placeCancelBox(), true);

main.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "search") {
    query = t.value;
    pageNo = 1;
    render();
    const box = $("#search");
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
});

main.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-pick-route]")?.dataset.pickRoute;
  if (pick) {
    const [item, route] = pick.split(/\|(.*)/s);
    pickedRoute = { item, route };
  }
  const reset = e.target.closest("[data-reset-steps]");
  if (reset) {
    resetMethods(reset.dataset.resetSteps);
    if (reset.classList.contains("active")) render(); // the same tab: no address change to redraw it
  }
  if (e.target.closest("[data-import]")) {
    e.preventDefault();
    $("#live-import").click(); // as the header's button: shows the import window, or hides it again
    return;
  }
  if (e.target.closest("[data-panel-help]")) {
    panelHelp = !panelHelp;
    render();
    return;
  }
  if (e.target.closest("[data-live-watch]")) {
    startWatch();
    return;
  }
  if (e.target.closest("[data-live-tab]")) {
    hideWindow(!windowHidden);
    render();
    return;
  }
  // A different start currency: every result changes, so the item page's routes re-sort too.
  const base = e.target.closest("[data-base]")?.dataset.base;
  if (base) {
    if (base === store.state.base) return;
    store.state.base = base;
    store.save();
    routeOrder.clear();
    render();
    return;
  }
  const addRoute = e.target.closest("[data-add-listing]")?.dataset.addListing;
  if (addRoute) {
    const [, , itemSlug, modeArg] = location.hash.split("/");
    addListing(itemOf(decodeURIComponent(itemSlug)), modeArg ?? DEFAULT_MODE, addRoute);
    render();
    return;
  }
  const cancel = e.target.closest("[data-listing-cancel]")?.dataset.listingCancel;
  if (cancel) {
    const [id, i] = cancel.split("|"), l = listingOf(id), st = l.steps[Number(i)];
    if (st.state === "waiting") { // a repost waiting to start: the cancel undone
      uncancel(l, Number(i) - 1);
      Object.assign(l.steps[Number(i) - 1], { state: "progress" });
      delete l.steps[Number(i) - 1].doneAt;
      store.save();
    } else {
      cancelling = cancelling === cancel ? null : cancel;
    }
    render();
    $("#cancel-left")?.focus();
    return;
  }
  if (e.target.closest("[data-cancel-close]")) {
    endCancel(false);
    return;
  }
  const play = e.target.closest("[data-listing-play]")?.dataset.listingPlay;
  if (play) {
    const [id, i] = play.split("|");
    playStep(listingOf(id), Number(i));
    render();
    return;
  }
  const yes = e.target.closest("[data-listing-yes]")?.dataset.listingYes;
  if (yes) {
    const [id, i] = yes.split("|"), l = listingOf(id), r = listingResult(l), at = !r.missing && orderSeenAt(l, Number(i), r.rows[Number(i)]);
    if (at) playStep(l, Number(i), at);
    render();
    return;
  }
  const no = e.target.closest("[data-listing-no]")?.dataset.listingNo;
  if (no) {
    const [id, i] = no.split("|");
    listingOf(id).steps[Number(i)].noHint = true;
    store.save();
    render();
    return;
  }
  const check = e.target.closest("[data-listing-check]")?.dataset.listingCheck;
  if (check) {
    const [id, i] = check.split("|");
    checkStep(listingOf(id), Number(i));
    render();
    return;
  }
  const complete = e.target.closest("[data-listing-complete]")?.dataset.listingComplete;
  if (complete) {
    const l = listingOf(complete);
    Object.assign(l, { completed: true, completedAt: Date.now() });
    store.save();
    pendingDelete = null;
    render();
    return;
  }
  const active = e.target.closest("[data-listing-active]")?.dataset.listingActive;
  if (active) {
    const l = listingOf(active);
    l.completed = false;
    delete l.completedAt;
    store.save();
    pendingDelete = null;
    render();
    return;
  }
  const del = e.target.closest("[data-listing-delete]")?.dataset.listingDelete;
  if (del) {
    pendingDelete = del;
    render();
    return;
  }
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    // Flash the amount once it's on the clipboard; a highlight, so nothing shifts.
    navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
      copy.classList.add("copied");
      setTimeout(() => copy.classList.remove("copied"), 800);
    }, () => {});
    return;
  }
  const typedEdit = e.target.closest("[data-typed-edit]")?.dataset.typedEdit;
  if (typedEdit) {
    editingTyped = typedEdit;
    render();
    $("#typed-ratio")?.select();
    return;
  }
  const typedReset = e.target.closest("[data-typed-reset]")?.dataset.typedReset;
  if (typedReset) {
    store.clearTyped(league(), typedReset);
    render();
    return;
  }
  const manualEdit = e.target.closest("[data-manual-edit]")?.dataset.manualEdit;
  if (manualEdit) {
    editingRatio = manualEdit;
    render();
    $("#manual-ratio")?.select();
    return;
  }
  const manualReset = e.target.closest("[data-manual-reset]")?.dataset.manualReset;
  if (manualReset) {
    const [id, i] = manualReset.split("|"), l = listingOf(id), [slot, k] = stepSlot(l, Number(i));
    const path = pathOf(l), n = legOf(l, Number(i)), back = resetRatio(path[n + 1], path[n]);
    if (back) slot[k] = { method: MANUAL, ratio: [...back] };
    store.save();
    render();
    return;
  }
  const pair = e.target.closest("[data-pair]")?.dataset.pair;
  if (pair) {
    editLines = pair.split(",").map((p) => p.split("|"));
    render();
    return;
  }
  const page = e.target.closest("[data-page]")?.dataset.page;
  if (page) {
    pageNo = Number(page);
    render(); // the page stays where it is
    return;
  }
  const sortKey = e.target.closest("[data-sort]")?.dataset.sort;
  if (sortKey) {
    sort = sort.key === sortKey ? { key: sortKey, desc: !sort.desc } : { key: sortKey, desc: SORTS[sortKey].desc };
    render();
    return;
  }
  const volumeKey = e.target.closest("[data-volume-sort]")?.dataset.volumeSort;
  if (volumeKey) {
    // A new column starts as the default does for names (Z to A), most first for counts.
    volumeSort = volumeSort.key === volumeKey ? { key: volumeKey, desc: !volumeSort.desc } : { key: volumeKey, desc: true };
    pageNo = 1;
    render();
    return;
  }
  // The button clicked, wherever in it: on its icon, the click lands on the drawing inside it.
  const id = e.target.closest("button")?.id ?? e.target.id;
  if (id === "dialog-close") {
    $("#ratio-dialog").close(); // the close listener clears editLines and re-renders
    return;
  }
  if (id === "live-stop") {
    stopLive();
    render();
    return;
  }
  if (id === "listing-delete-yes" || id === "listing-delete-cancel") {
    if (id === "listing-delete-yes") {
      store.state.listings = listings().filter((l) => l.id !== pendingDelete);
      store.save();
    }
    pendingDelete = null;
    render();
    return;
  }
  if (id === "remove-completed" || id === "remove-completed-cancel") {
    pendingRemoveCompleted = id === "remove-completed"; // the button is only enabled with something to remove
    render();
    return;
  }
  if (id === "remove-completed-yes") {
    store.state.listings = listings().filter((l) => !(l.completed && l.league === league()));
    store.save();
    pendingRemoveCompleted = false;
    render();
    return;
  }
});

// Import Market Ratios, in the header: it shows its window, always on every page (hidden to its strip until shown),
// over whatever page is open, which updates behind it as each pair is read (what changed lights up, markChanges). It
// keeps watching the game while the page behind is used and through every move to another of the site's pages, until
// its stop button (or the browser's) stops the share.
// The docked window sits just below the header, which is pinned to the top and can wrap to more lines.
function placeUnderHeader() {
  document.documentElement.style.setProperty("--below-header", `${$("header").offsetHeight}px`);
}
placeUnderHeader();
// The nav shows each page's icon and name, or only the icons (names on hover) when the names would wrap the header: its
// parts no longer on one line.
function fitNav() {
  const header = $("header");
  header.classList.remove("compact");
  const [first, ...rest] = [...header.children].filter((el) => !el.hidden).map((el) => el.getBoundingClientRect());
  const compact = rest.some((r) => r.top >= first.bottom);
  header.classList.toggle("compact", compact);
  for (const a of document.querySelectorAll("nav a")) a.title = compact ? a.textContent.trim() : "";
}
window.addEventListener("resize", () => {
  fitNav();
  placeUnderHeader(); // the header's height may have changed
});

// It shows its window, or hides it again (its share button asks which window to share).
let panelHelp = false; // the import window shows its steps (its title bar's help button)
$("#live-import").addEventListener("click", () => {
  hideWindow(!windowHidden);
  render();
});

$("#league").addEventListener("change", (e) => {
  selectLeague(e.target.value);
  pendingRemoveCompleted = false;
  render();
});

// Opening or closing a Trade Recommendations table draws or drops its rows; an item page's route folds are remembered. (toggle doesn't bubble, so it's caught on the way down.)
main.addEventListener("toggle", (e) => {
  const fold = e.target.dataset?.routeFold;
  if (fold) {
    routeFold.set(fold, e.target.open);
    return;
  }
  const route = e.target.dataset?.routeOpen;
  if (route) {
    if (e.target.open) routeOpen.add(route); else routeOpen.delete(route);
    return;
  }
  const key = e.target.dataset?.section;
  if (!key || e.target.open === sectionOpen(key)) return;
  sectionState.set(key, e.target.open);
  render();
}, true);

window.addEventListener("hashchange", (e) => {
  pendingRemoveCompleted = false;
  pendingDelete = null;
  cancelling = null;
  editingRatio = null;
  endDialog();
  resortOnClose = false;
  routeOrder.clear();
  routeOpen.clear();
  routeFold.clear();
  // A picked route lasts while on its item's page (either mode).
  const [, page, slug] = new URL(e.newURL).hash.split("/");
  if (page !== "item" || itemOf(decodeURIComponent(slug ?? ""))?.id !== pickedRoute.item) pickedRoute = {};
  // The search box survives switching tabs on the same page (Trade Recommendations: the trading modes); any other move clears it. The list changes either way, so it's back to page 1.
  const pageOf = (url) => new URL(url).hash.split("/")[1];
  if (!["trade-recommendations", "trade-volumes", "imported-ratios"].includes(pageOf(e.newURL)) || pageOf(e.oldURL) !== pageOf(e.newURL)) query = "";
  if (pageOf(e.newURL) !== "trade-recommendations") sectionState.clear();
  pageNo = 1;
  lit.clear();
  render();
  window.scrollTo(0, 0);
});

// Catalog, gold fees and rates, loaded once. A failed load is retried the next time a page needs it.
let dataLoad = null;
function loadData() {
  dataLoad ??= (async () => {
    const [catalog, gold] = await Promise.all([loadCatalog(game.files), loadGold(game.files)]);
    setCatalog(catalog);
    setGold(gold);
    rates = await loadRates(game.files);
    selectLeague(listedLeagues(rates).includes(league()) ? league() : defaultLeague(rates));
    renderHeader();
  })().catch((err) => {
    dataLoad = null;
    throw err;
  });
  return dataLoad;
}

render();
