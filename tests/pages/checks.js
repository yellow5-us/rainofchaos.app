// Page checks: what a test round looks at on each page of the app, run by pages.html (run.js) against the app in an
// iframe (`w`, its window), with the fixture rates (rates.json here, `tools/serve.py --fixtures`) and a seeded state
// (seeds.js). Each check is { game, seed, hash, rates?(json), run(t, seed, page) }: `rates` patches the fixture rates
// before the page loads; t.ok(cond, name, detail) and t.eq(got, want, name) record results.
import { addRead, allReads, clearReads, HISTORY_FOR } from "../../html/js/history.js";
import { AT, findWindow } from "../../html/js/snip.js";
import { ALCH, ANNUL, C, CHROM, D, E, LEAGUE, SHARD, STALE_KEY, STORAGE, SULPHUR, VIVID } from "./seeds.js";

const NAMES = {
  [C]: "Chaos Orb", [D]: "Divine Orb", [E]: "Exalted Orb", [CHROM]: "Chromatic Orb", [VIVID]: "Vivid Crystallised Lifeforce",
  [SULPHUR]: "Dead Man's Sulphur", [ALCH]: "Orb of Alchemy", [SHARD]: "Alchemy Shard",
};
const ID_OF = Object.fromEntries(Object.entries(NAMES).map(([id, n]) => [n, id]));

// The app's window, set by run.js for each check (before the app runs). Its PoE1 catalog gets Alchemy Shard, which the
// one-list captures show and data/catalog.json doesn't list; a check's `rates(json)`, when it has one, changes the
// rates it's served (`patches.rates`, set by run.js).
let w = null;
export const patches = { rates: null };
export const within = (win) => {
  w = win;
  const fetch = win.fetch.bind(win);
  const json = (data) => new win.Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  win.fetch = async (url, options) => {
    const res = await fetch(url, options);
    if (/^\/(poe2\/)?rates\.json$/.test(String(url)) && patches.rates) return json(patches.rates(await res.json()));
    if (String(url) !== "/data/catalog.json") return res;
    const catalog = await res.json();
    return json({ ...catalog, [SHARD]: { icon: catalog[ALCH].icon, name: NAMES[SHARD] } });
  };
};

// ---------- helpers ----------

// The PoE1 fixture with Chaos ↔ Divine's numbers changed (a is Chaos, b Divine).
const pairWith = (json, change) => {
  const pairs = json.leagues[LEAGUE.poe1].pairs, key = [C, D].sort().join("|");
  return { ...json, leagues: { ...json.leagues, [LEAGUE.poe1]: { ...json.leagues[LEAGUE.poe1], pairs: { ...pairs, [key]: { ...pairs[key], ...change } } } } };
};

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const $ = (sel, root = w.document) => root.querySelector(sel);
const $$ = (sel, root = w.document) => [...root.querySelectorAll(sel)];
// An element's text with each currency icon as its name, spaces squeezed: "Imported prices for Chaos Orb and Divine Orb."
function text(el) {
  if (!el) return "";
  const copy = el.cloneNode(true);
  for (const icon of copy.querySelectorAll(".icon")) icon.replaceWith(` ${icon.title} `);
  return copy.textContent.replace(/\s+/g, " ").replace(/ ([.,:)])/g, "$1").trim();
}
const titles = (el) => $$(".icon", el).map((i) => i.title);
const numbers = (s) => (s.match(/[\d,]+(\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
const scanDate = (at) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const atOf = (seed, key) => seed.leagues[seed.league].ratios[key].verifiedAt;
const saved = (key) => JSON.parse(w.localStorage.getItem(key));

// Polls fn (sync or async) until it gives something truthy, or `ms` is up (then its last value).
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { /* not there yet */ }
    if (v || Date.now() > end) return v;
    await sleep(20);
  }
}
// Downloads the page starts (a link's click with `download`), each { name, text: a promise of its contents }.
function catchDownloads() {
  const files = [];
  w.HTMLAnchorElement.prototype.click = function () {
    if (this.download) files.push({ name: this.download, text: fetch(this.href).then((r) => r.text()) });
  };
  return files;
}
// The read history's records for a league (js/history.js; this page is PoE1's, as the checks' app is).
const historyOf = async (league) => ((await allReads()) ?? []).filter((r) => r.league === league);
// The page's read history module (the app's own copy, in its window): its pruning on load settles `pruned`.
const pagePruned = () => w.eval(`import(${JSON.stringify(new URL("js/history.js", w.document.baseURI).href)})`).then((m) => m.pruned);
// The page drawn: home at once, every other page once the rates are in.
const ready = () => waitFor(() => $("#main").children.length && !/Loading rates/.test($("#main").textContent), 10000);
// The app has drawn the page at the new address (its own hashchange listener runs first).
const moved = () => new Promise((ok) => w.addEventListener("hashchange", () => setTimeout(ok), { once: true }));
// To another page by its address.
async function go(hash) {
  const drawn = moved();
  w.location.hash = hash;
  await drawn;
  await ready();
}
// A click that may go to another page (a link to #/...): waits for the page drawn either way.
async function click(el) {
  const href = el.getAttribute("href");
  const drawn = href?.startsWith("#/") && href !== w.location.hash && moved();
  el.click();
  await drawn;
  await ready();
}
const tabs = () => $$("#main .tabs a").map((a) => a.textContent.trim());
const activeTab = () => $("#main .tabs a.active")?.textContent.trim();
// Trade Recommendations' trading modes, and the one picked.
const modes = () => $$(".mode-toggle a").map((a) => a.textContent);
const activeMode = () => $(".mode-toggle a.active")?.textContent;
const fixture = (game) => fetch(game === "poe2" ? "/poe2/rates.json" : "/rates.json").then((r) => r.json());
const dialog = () => $("#ratio-dialog[open]");
// The import window, shown (it's always on the page, hidden to its strip until shown).
const liveDialog = () => $("#live-dialog[open]:not(.collapsed)");
// The page's own price rows, not the import window's (always on the page, hidden to its strip until shown).
const pageRows = () => $$("#main table.ratios tbody tr:not(.group)").filter((el) => !el.closest("#live-dialog"));
// Trade Recommendations: every section opened (each opening draws the page again, its rows in it), then its rows by section.
async function openSections() {
  for (let d; (d = $("details[data-section]:not([open])"));) {
    const key = d.dataset.section;
    $("summary", d).click();
    if (!await waitFor(() => $(`details[data-section="${key}"][open] > :not(summary)`))) break;
  }
  return Object.fromEntries($$("details[data-section]").map((d) => [d.dataset.section, $$("tbody tr", d).map((r) => r.dataset.row)]));
}
// A Trade Recommendations row: one route of an item, by the route's id (PoE1 Chaos start: after:Divine, before:Divine, direct).
const tradeRow = (id, route = `after:${D}`) => $(`table.summary tr[data-row="${id}|${route}"]`);
// A Trade Recommendations row's cells by column.
const COL = { item: 0, age: 1, profit: 2, fill: 3, perMinute: 4, gold: 5, route: 6 };
// An item page's volume as { hub name: count }.
const volumeParts = (cell) => Object.fromEntries(cell.innerHTML.split(" + ").map((part) => {
  const span = document.createElement("span");
  span.innerHTML = part;
  return [titles(span)[0], numbers(span.textContent)[0]];
}));
const routes = () => $$("#main details.other");
const stepRowsOf = (box) => $$("table.steps tbody tr", box).filter((tr) => $("select.method", tr));
// Which ratio a step read: want>have competing (slow) or an estimate (no dropdown), have>want instant (fast), as calc.js reads it.
function stepKey(tr) {
  const [recv, give] = titles($("button.ratio-link[data-pair]", tr)).map((n) => ID_OF[n]);
  return ($("select.method", tr)?.value ?? "slow") === "slow" ? `${recv}>${give}` : `${give}>${recv}`;
}
// A step's Ratio cell (an "extra" row's cells span the amounts).
const ratioCell = (tr) => $("button.ratio-link[data-pair]", tr).closest("td");
const cellTags = (td) => $$(".tag", td).map((t) => t.textContent.trim());

// The import window's screen sharing: run.js puts `media.get` in place of the app's getDisplayMedia. By default it's
// refused, as a cancelled prompt is.
const refuse = () => Promise.reject(new w.DOMException("Refused by the page checks", "NotAllowedError"));
export const media = { refuse, get: refuse };
// A shared window showing a still image: a canvas stream of it, drawn again every tenth of a second. Its show(src)
// changes the image, as the game changing on screen.
async function streamOf(src) {
  const c = w.document.createElement("canvas"), g = c.getContext("2d");
  let img = null;
  const show = async (next) => {
    const m = new w.Image();
    m.src = next;
    await m.decode();
    [c.width, c.height, img] = [m.width, m.height, m];
    g.drawImage(img, 0, 0);
  };
  await show(src);
  const stream = Object.assign(c.captureStream(10), { show });
  w.setInterval(() => g.drawImage(img, 0, 0), 100);
  return stream;
}
// The app's sound, recorded rather than played: an AudioContext stand-in (current time 0) whose buffer sources note
// when they're started. Returns those start times.
function recordSound() {
  const starts = [];
  w.AudioContext = w.webkitAudioContext = class {
    sampleRate = 48000;
    currentTime = 0;
    destination = {};
    resume() { return w.Promise.resolve(); }
    createBuffer(channels, n) { const data = new Float32Array(n); return { getChannelData: () => data }; }
    createBufferSource() { return { connect() {}, start: (at) => starts.push(at) }; }
  };
  return starts;
}
// The clicks a sound is made of, as their gaps in seconds after the first.
const gaps = (starts) => starts.map((at) => Math.round((at - starts[0]) * 1000) / 1000);
// Opens the import window from the header, shares `src` (or refuses), and waits for the status line to say `until`.
async function importFrom(src, until, ms = 20000) {
  let stream = null;
  media.get = src ? async () => (stream = await streamOf(src)) : refuse;
  await click($("#live-import"));
  const share = $("[data-live-watch]").title;
  $("[data-live-watch]").click();
  await waitFor(() => until.test(text($(".live-status"))), ms);
  return { status: text($(".live-status")), stream: () => stream, share };
}
// A capture as the game shows it on a hover without Alt, as a data URL: Available's header and rows moved up into the
// place they have with no banners, and the banners and Competing painted over in the panel's colour (taken between the
// lists' rows). The same look as a pair with no Competing trades at all.
async function withoutAlt(src) {
  const m = new Image();
  m.src = src;
  await m.decode();
  const c = Object.assign(document.createElement("canvas"), { width: m.width, height: m.height }), g = c.getContext("2d");
  g.drawImage(m, 0, 0);
  const win = findWindow(g.getImageData(0, 0, c.width, c.height));
  const span = win.right - win.left, mid = (win.left + win.right) / 2, P = AT.pitch * span;
  const first = win.y + AT.available * span, up = (AT.available - AT.bare) * span;
  const [r, gr, b] = g.getImageData(Math.round(mid - 0.15 * span), Math.round(first + 6.4 * P), 1, 1).data;
  const [x, w, y0, y1] = [mid - 0.2 * span, 0.4 * span, first - 1.6 * P, first + 5.5 * P];
  const rows = g.getImageData(Math.round(x), Math.round(y0), Math.round(w), Math.round(y1 - y0));
  g.fillStyle = `rgb(${r}, ${gr}, ${b})`;
  g.fillRect(x, y0 - up - 0.5 * P, w, win.y + AT.competing * span + 5.6 * P - (y0 - up - 0.5 * P));
  g.putImageData(rows, Math.round(x), Math.round(y0 - up));
  return c.toDataURL();
}
// A capture with a cursor-sized magenta arrow over Competing's first stock, as a data URL: Competing can't be read, and
// the arrow is too small for a look to count as a change when it moves away.
async function cursorOver(src) {
  const m = new Image();
  m.src = src;
  await m.decode();
  const c = Object.assign(document.createElement("canvas"), { width: m.width, height: m.height }), g = c.getContext("2d");
  g.drawImage(m, 0, 0);
  const win = findWindow(g.getImageData(0, 0, c.width, c.height));
  const span = win.right - win.left, x = (win.left + win.right) / 2 + 0.01 * span, y = win.y + (AT.competing - 0.4 * AT.pitch) * span;
  g.fillStyle = "rgb(200, 40, 200)";
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + 0.06 * span, y + 0.03 * span);
  g.lineTo(x + 0.04 * span, y + 0.07 * span);
  g.closePath();
  g.fill();
  return c.toDataURL();
}
// The import window's latest pair: { row heading: its cell's text }.
const latest = () => Object.fromEntries($$(".live-last tr").map((tr) => [text(tr.cells[0]), $$("td", tr).map(text).filter(Boolean).join(" ")]));
// A capture with one list, where the game shows the other has no trades: the list read fills its price, and the other
// box is saved as read with no trades.
async function oneList(t, seed, src, pair) {
  await ready();
  const was = seed.leagues[seed.league].ratios;
  const r = await importFrom(src, /Imported prices/);
  t.eq(r.status, `Imported prices for ${pair} (no competing trades).`, "imports the pair, saying which side has no trades");
  const { ratios } = saved(STORAGE.poe1).leagues[LEAGUE.poe1];
  t.eq(ratios[`${C}>${SHARD}`].value, [1, 1], "the list read fills its price");
  t.ok(ratios[`${C}>${SHARD}`].verifiedAt > was[`${C}>${SHARD}`].verifiedAt, "and it's read now");
  const none = ratios[`${SHARD}>${C}`];
  t.eq([none.value, none.empty], [null, true], "the side with no trades is saved with none");
  t.ok(none.verifiedAt > was[`${SHARD}>${C}`].verifiedAt, "read now too");
  const shown = latest();
  t.eq(shown["Competing Trades"], "no trades", "latest pair: Competing Trades has no trades");
  t.ok(/^Alchemy Shard 1 : 1 Chaos Orb$/.test(shown["Available Trades"]), "latest pair: Available Trades shows the price read, no tag", shown["Available Trades"]);
  t.ok(!$(".live-last .dialog-title") && !$(".live-last .tag"), "latest pair: no title over it (the lines name the currencies), no tags");
}

// The import window: docked at the top right just below the header, not modal.
function docked(t) {
  const d = liveDialog();
  if (!t.ok(d, "Import Market Ratios window opens")) return;
  const r = d.getBoundingClientRect(), right = w.document.documentElement.clientWidth - r.right;
  const below = r.top - $("header").getBoundingClientRect().bottom;
  t.ok(!d.matches(":modal"), "import window isn't modal");
  t.eq(w.getComputedStyle(d).position, "fixed", "import window is docked (position)");
  t.ok(Math.abs(right - 16) <= 2 && Math.abs(below - 4) <= 2, "import window sits 0.25rem below the header, 1rem from the right",
    `right gap ${right}, gap below the header ${below}`);
  t.eq(text($(".dialog-head h2", d)), "Import Market Ratios", "import window title");
}

// ---------- checks ----------

const NAV = ["Home", "Trade Recommendations", "My Listings", "Market Ratios", "Trade Volumes"];
const navLabel = (a) => a.textContent.trim().replace(/ \(\d+\)$/, ""); // My Listings (N)
const HOME_CARDS = ["Your data", "Get the prices: Import Market Ratios", "If importing doesn't work", "Find a trade", "Support"];

export const CHECKS = {
  nav: { game: "poe1", seed: "fresh", hash: "#/home", async run(t) {
    await ready();
    t.eq($$("nav a").map(navLabel), NAV, "nav order");
    t.eq($$("nav a").map((a) => !!$("svg", a)), NAV.map(() => true), "each nav link has its icon");
    const header = $("header"), compact = () => header.classList.contains("compact");
    const width = (css) => {
      header.style.width = css;
      w.dispatchEvent(new w.Event("resize"));
    };
    width("40rem");
    t.eq([compact(), $$("nav a span").every((s) => w.getComputedStyle(s).display === "none"), $$("nav a").map((a) => a.title)], [true, true, NAV],
      "names that would wrap the header: only the icons, names on hover");
    width("200rem");
    t.eq([compact(), $("nav a span").offsetWidth > 0, $("nav a").title], [false, true, ""], "room for the names: icons and names, no hovers");
    width("");
    t.eq($$("header button").map((b) => b.textContent.trim()), ["Import Market Ratios"], "header has one button, Import Market Ratios");
    await waitFor(() => !$(".league").hidden);
    t.eq($("#league").value, LEAGUE.poe1, "league dropdown shows the fixture's league");
    for (const label of NAV) {
      await click($$("nav a").find((a) => navLabel(a) === label));
      t.eq($$("nav a.active").map(navLabel), [label], `${label}: active nav link`);
      t.ok(!$("#main .load-error") && $("#main").textContent.trim(), `${label}: page drawn`);
    }
    await go(`#/item/${CHROM}/competitive`);
    t.eq($$("nav a.active").map(navLabel), ["Trade Recommendations"], "item page: Trade Recommendations active");
  } },

  // The header stays at the top of a scrolled page, and the import window just below it.
  pinnedHeader: { game: "poe1", seed: "fresh", hash: "#/trade-volumes", async run(t) {
    await ready();
    $("#main").style.paddingBottom = "300vh";
    w.scrollTo(0, w.innerHeight);
    t.ok(w.scrollY > 0, "page scrolled", `scrollY ${w.scrollY}`);
    t.ok(Math.abs($("header").getBoundingClientRect().top) <= 1, "header pinned to the top", `header top ${$("header").getBoundingClientRect().top}`);
    await click($("#live-import"));
    docked(t);
  } },

  home: { game: "poe1", seed: "empty", hash: "#/home", async run(t) {
    await ready();
    t.eq($$(".disclaimer").map(text), ["This product isn't affiliated with or endorsed by Grinding Gear Games in any way."], "disclaimer, and no other notice");
    t.eq([w.getComputedStyle(w.document.body).backgroundColor, w.getComputedStyle(w.document.documentElement).colorScheme],
      ["rgb(21, 21, 20)", "dark"], "dark colours, whatever the system's setting");
    t.eq($$("#main .guide h2").map((h) => h.textContent.trim()), HOME_CARDS, "cards in order, Your data first");
    t.eq($$("#main .guide a[href^='#/']").map((a) => [text(a), a.getAttribute("href")]),
      [["Trade Recommendations", "#/trade-recommendations/estimated"], ["My Listings", "#/my-listings"], ["Trade Volumes", "#/trade-volumes"],
        ["Trade Recommendations", "#/trade-recommendations"], ["My Listings", "#/my-listings"]], "the pages it names link to them, Estimated Trading's in its card");
    t.eq($$("#main .guide [data-import]").length, 3, "Import Market Ratios in its text: three links to the import window");
    await click($("#main .guide [data-import]"));
    t.eq([w.location.hash, !!liveDialog()], ["#/home", true], "a click opens it");
    await click($("#main .guide [data-import]"));
    t.ok(!liveDialog() && $("#live-dialog.collapsed"), "another hides it again, as the header's button does");
    t.eq(text($("#main .guide > :first-child")), "This site helps guide your Currency Exchange usage to make profits.", "first card, above the disclaimer");
    const kofi = (a) => [a?.getAttribute("href"), a?.target, a?.rel];
    t.eq(kofi($("header a.support")), ["https://ko-fi.com/prinny5", "_blank", "noopener"], "header Support link opens Ko-fi in a new tab");
    t.eq(text($("header a.support")), "Support", "header Support link's text");
    t.eq(kofi($("#main .guide section:last-child a")), kofi($("header a.support")), "Support card links to Ko-fi too");
  } },

  homePoe2: { game: "poe2", seed: "empty", hash: "#/home", async run(t) {
    await ready();
    t.eq($$(".disclaimer").map(text), ["This product isn't affiliated with or endorsed by Grinding Gear Games in any way.",
      "Reading prices from Path of Exile 2 isn't fully tested yet."], "the disclaimer, then the note that reading PoE2 isn't fully tested");
  } },

  tradesEmpty: { game: "poe1", seed: "empty", hash: "#/trade-recommendations", async run(t) {
    await ready();
    t.eq(tabs(), [], "no tabs");
    t.eq(modes(), ["Competitive Trading", "Instant Trading", "Estimated Trading"], "mode selector");
    t.eq(activeMode(), "Competitive Trading", "Competitive is the default");
    t.eq(text($("#main > p.muted")), `No trades have been scanned for ${LEAGUE.poe1} in the last 4 hours. Use Import Market Ratios at the top right to read them from the game.`, "empty message");
    await click($("#main [data-import]"));
    docked(t);
  } },

  trades: { game: "poe1", seed: "fresh", hash: "#/trade-recommendations", async run(t, seed) {
    await ready();
    t.eq(activeMode(), "Competitive Trading", "Competitive is the default");
    t.eq($$("details[data-section]").map((d) => [text($("h2", d)), d.open]),
      [["Profitable (8)", true], ["Unprofitable (5)", false]], "sections, only Profitable open; nothing Untradeable");
    t.eq($$("table.summary thead th").map((th) => th.textContent.trim()),
      ["Item", "", "Profit", "Fill Time", "/ min ▼", "Gold Cost", "Route"], "columns, sorted by profit per minute; the tag column unheaded");
    t.eq(titles($("table.summary thead th:nth-child(5)")), ["Chaos Orb"], "the per-minute header names the start currency by its icon");
    const byMinute = $$('details[data-section="profitable"] tbody tr').map((tr) => numbers(tr.cells[COL.perMinute].textContent)[0]);
    t.eq(byMinute, [...byMinute].sort((a, b) => b - a), "sorts by profit per minute, most first");
    await click($('button[data-sort="profit"]'));
    const sections = await openSections();
    const [after, before] = [`|after:${D}`, `|before:${D}`];
    t.eq(sections.profitable, [CHROM + after, SULPHUR + after, `${SULPHUR}|direct`, VIVID + after, `${CHROM}|direct`, SULPHUR + before, `${VIVID}|direct`, `${D}|direct`],
      "Profitable: every route its own row, best first; Divine Orb has only its direct route");
    t.eq(sections.unprofitable, [CHROM + before, VIVID + before, ALCH + after, `${ALCH}|direct`, ALCH + before],
      "Unprofitable: Chromatic's and Vivid's losing routes, and all of Alchemy's");
    t.eq([sections.untradeable, text(tradeRow(SULPHUR, "direct").cells[COL.fill])], [undefined, "—"],
      "Sulphur's pair had no recent trades: its routes are priced all the same, fill time unknown");
    const cell = (id, col, route) => tradeRow(id, route).cells[COL[col]];
    t.eq(titles(cell(CHROM, "route")), ["Chaos Orb", "Chromatic Orb", "Divine Orb", "Chaos Orb"], "Chaos → Chromatic → Divine → Chaos");
    t.eq(titles(cell(CHROM, "route", "direct")), ["Chaos Orb", "Chromatic Orb", "Chaos Orb"], "Chaos → Chromatic → Chaos");
    t.eq([cell(CHROM, "profit"), cell(CHROM, "profit", "direct")].map((td) => titles(td)), [["Chaos Orb", "Chromatic Orb"], ["Chaos Orb"]],
      "a Chaos start's profit is in chaos, then what's left over");
    t.eq(text(cell(CHROM, "profit")), "Chaos Orb +6,340 Chromatic Orb 17", "Chaos → Chromatic → Divine → Chaos: +6,340c, 17 Chromatic kept, icons first");
    t.eq([cell(VIVID, "fill").children.length, cellTags(cell(VIVID, "fill"))], [0, []], "Vivid, slow: just its fill time, no sign or tag");
    t.ok(!tradeRow(VIVID).classList.contains("losing"), "Vivid isn't greyed");
    t.eq([text(cell(SULPHUR, "fill")), cellTags(cell(SULPHUR, "fill"))], ["—", []], "Sulphur: fill time unknown, no tag");
    t.eq(cellTags(cell(CHROM, "fill")), [], "Chromatic: no fill-time tag");
    // The scan age tag, right after the item: green, the oldest price's pair and time on hover.
    const tag = (id, route) => $(".tag", cell(id, "age", route));
    const scan = (id, route) => [tag(id, route)?.textContent, tag(id, route)?.title, tag(id, route)?.classList.contains("verified")];
    t.eq(scan(CHROM), ["5m", `Chaos Orb:Chromatic Orb at ${scanDate(atOf(seed, `${C}>${CHROM}`))}`, true], "tag: Chromatic, hubs first");
    t.eq(scan(VIVID), ["6m", `Divine Orb:Vivid Crystallised Lifeforce at ${scanDate(atOf(seed, `${VIVID}>${D}`))}`, true], "tag: Vivid, hub before item");
    t.eq(scan(D, "direct")[1].split(" at ")[0], "Chaos Orb:Divine Orb", "tag: Divine Orb, hubs in the game's order");
    const lefts = $$("table.summary").map((tb) => $$("td.age .tag", tb).map((x) => Math.round(x.getBoundingClientRect().left)));
    t.ok(lefts.every((l) => l.length > 1 && l.every((x) => Math.abs(x - l[0]) <= 1)), "tags line up on the left within each table");
    // Per minute: profit over the fill time in minutes, in the profit's currency (the header's icon); a dash for a route whose fill time is unknown.
    const perMinute = (id, route) => numbers(cell(id, "perMinute", route).textContent)[0];
    const fillMinutes = (id, route) => numbers(cell(id, "fill", route).textContent)[0] * (/h/.test(cell(id, "fill", route).textContent) ? 60 : 1);
    const profitOf = (id, route) => numbers(cell(id, "profit", route).textContent)[0];
    for (const [id, route] of [[CHROM], [CHROM, "direct"], [VIVID]]) {
      const want = profitOf(id, route) / fillMinutes(id, route), got = perMinute(id, route);
      t.ok(Math.abs(got - want) / want < 0.2, `${NAMES[id]} ${route ?? "via Divine"}: ${got} a minute is about ${profitOf(id, route)} / ${fillMinutes(id, route)} min`);
    }
    t.eq(titles(cell(CHROM, "perMinute")), [], "no icon in the cells");
    t.ok($$("table.summary td:nth-child(5)").every((td) => td.textContent === "—" || /^[+-]?[\d,]+\.\d\d$/.test(td.textContent.trim())),
      "every per minute to two decimals");
    t.eq(text(cell(SULPHUR, "perMinute")), "—", "fill time unknown: a dash");
    t.ok(/^Gold [\d,]+$/.test(text(cell(CHROM, "gold"))), "Gold Cost: gold's icon, then the amount", text(cell(CHROM, "gold")));
    // Instant Trading: every route is instant, counted as a minute, so a minute's profit is the whole profit.
    await go("#/trade-recommendations/available");
    await openSections();
    t.eq(text(cell(CHROM, "fill")), "instant", "Instant: instant fill");
    t.eq(numbers(cell(CHROM, "perMinute", "direct").textContent), numbers(cell(CHROM, "profit", "direct").textContent),
      "Instant: per minute is the profit");
  } },

  // Opening an item from one of its rows highlights that route while it's profitable; a losing row's opens on the best.
  pickedRoute: { game: "poe1", seed: "fresh", hash: "#/trade-recommendations", async run(t) {
    await ready();
    const top = () => $("#main details.other.top")?.dataset.row ?? null;
    await click($("a", tradeRow(CHROM, "direct")));
    t.eq([top(), routes().map((r) => r.dataset.row)], ["direct", [`after:${D}`, "direct", `before:${D}`]],
      "a profitable route that isn't the best: it has the border, the order unchanged");
    await click($('#main .tabs a[href$="/available"]'));
    t.eq(top(), `after:${D}`, "Instant, where the picked route loses: the best one has the border");
    await click($$("#main .tabs a").find((a) => a.textContent === "Competitive Trading"));
    t.eq(top(), "direct", "back on Competitive the pick is still there");
    await go("#/trade-recommendations");
    await openSections();
    await click($("a", tradeRow(CHROM, `before:${D}`)));
    t.eq(top(), `after:${D}`, "an unprofitable route: the best one keeps the border");
    await go("#/trade-volumes");
    await go(`#/item/${CHROM}/competitive`);
    t.eq(top(), `after:${D}`, "opened another way: the best one");
  } },

  // A scan over 4 hours old isn't used: Chromatic's routes through Chaos ↔ Chromatic leave Competitive and Instant for
  // Estimated Trading, that step at the pair's estimate (the fixture's latest hour: 70,000 Chromatic for 20,000 Chaos).
  tradesEstimated: { game: "poe1", seed: "stale", hash: "#/trade-recommendations", async run(t) {
    await ready();
    const listed = Object.values(await openSections()).flat();
    t.ok(listed.length && !listed.some((k) => k.startsWith(`${CHROM}|`)), "Competitive: none of Chromatic's routes", listed.join(", "));
    await click($$(".mode-toggle a").find((a) => a.textContent === "Estimated Trading"));
    t.eq([w.location.hash, activeMode()], ["#/trade-recommendations/estimated", "Estimated Trading"], "Estimated Trading");
    const estimated = Object.values(await openSections()).flat();
    t.eq(estimated.filter((k) => !k.startsWith("CurrencyRerollSocketLinks|")).sort(), [`after:${D}`, "direct", `before:${D}`].map((r) => `${CHROM}|${r}`).sort(),
      "lists Chromatic's routes, and Orb of Fusing's (never scanned)");
    const tag = $(".tag", tradeRow(CHROM, "direct").cells[COL.age]);
    t.eq([tag?.textContent, tag?.classList.contains("estimate"), tag?.title],
      ["estimated", true, "Some prices are the average of the last hour's trades, not a scan"], "tag: estimated");
    t.ok(/^[+-]/.test(text(tradeRow(CHROM, "direct").cells[COL.profit]).replace("Chaos Orb ", "")), "priced", text(tradeRow(CHROM, "direct").cells[COL.profit]));
    await go(`#/item/${CHROM}/estimated`);
    t.eq(tabs(), ["Competitive Trading", "Instant Trading", "Estimated Trading"], "item page: three tabs");
    t.eq($("#main h1 .tag")?.textContent, "estimated", "heading: the estimated tag");
    for (const box of routes()) if (!box.open) { $("summary", box).click(); await waitFor(() => box.open); }
    const steps = routes().flatMap((box) => $$("table.steps tbody tr", box));
    const est = steps.filter((tr) => $(".tag.estimate", ratioCell(tr)));
    t.ok(est.length && est.every((tr) => stepKey(tr) === `${CHROM}>${C}` || stepKey(tr) === `${C}>${CHROM}`),
      "estimate tags only on Chaos ↔ Chromatic steps", est.map(stepKey).join(", "));
    t.ok(est.every((tr) => $("select", tr)?.value === "estimate" && $$("option", $("select", tr)).map((o) => o.textContent).join() === "Estimated,Manual"),
      "their Type: Estimate, or Manual");
    t.ok(steps.filter((tr) => !est.includes(tr)).every((tr) => $("select.method", tr)?.value === "slow"), "scanned steps: the dropdown, Competitive");
    const direct = routes().find((r) => r.dataset.row === "direct");
    t.ok(/1 Chromatic Orb: 3\.5 Chaos Orb|3\.5 Chaos Orb/.test(text($("table.steps tbody tr", direct))), "Chaos → Chromatic at 1 : 3.5",
      text($("table.steps tbody tr", direct)));
    await go("#/trade-recommendations/estimated");
    await click($("a", tradeRow(CHROM, "direct")));
    t.eq(w.location.hash, `#/item/${CHROM}/estimated`, "a row opens its item on Estimated Trading");
  } },

  // Each route goes by its own prices: starting from Divine, Divine → Chromatic → Divine stays on Competitive, and only the
  // routes through Chaos are estimated.
  tradesRouteEstimated: { game: "poe1", seed: "staleFromDivine", hash: "#/trade-recommendations/estimated", async run(t) {
    await ready();
    const sections = await openSections(), estimated = Object.values(sections).flat();
    t.eq(estimated.filter((k) => k.startsWith(`${CHROM}|`)).sort(), [`after:${C}`, `before:${C}`].map((r) => `${CHROM}|${r}`).sort(),
      "Estimated: Chromatic's routes through Chaos only");
    t.ok(sections.untradeable?.includes("CurrencyRerollSocketLinks|direct"), "Orb of Fusing has no Divine market: Untradeable");
    t.eq(text($(".tag", tradeRow("CurrencyRerollSocketLinks", "direct").cells[COL.profit])), "no estimated price", "tagged no estimated price");
    await go("#/trade-recommendations");
    const scanned = Object.values(await openSections()).flat();
    t.ok(scanned.includes(`${CHROM}|direct`) && !scanned.includes(`${CHROM}|after:${C}`), "Competitive: Divine → Chromatic → Divine", scanned.join(", "));
    const tag = $(".tag", tradeRow(CHROM, "direct").cells[COL.age]);
    t.ok(tag?.classList.contains("verified") && /^Chromatic Orb:Divine Orb at |^Divine Orb:Chromatic Orb at /.test(tag?.title ?? ""),
      "its tag: its own oldest price, Chromatic ↔ Divine, green", tag?.title);
  } },

  item: { game: "poe1", seed: "fresh", hash: `#/item/${CHROM}/competitive`, async run(t, seed) {
    await ready();
    t.eq([$("#main .back a")?.textContent, $("#main .back a")?.getAttribute("href")], ["← Back to Trade Recommendations", "#/trade-recommendations"], "back link: to Trade Recommendations in the page's mode");
    const tag = $("#main h1 .tag.verified");
    t.eq([tag?.textContent, tag?.title], ["5m", `Chaos Orb:Chromatic Orb at ${scanDate(atOf(seed, `${C}>${CHROM}`))}`], "verified tag and its title");
    t.eq(tabs(), ["Competitive Trading", "Instant Trading", "Estimated Trading"], "mode tabs");
    t.eq(activeTab(), "Competitive Trading", "Competitive tab open");
    t.eq(routes().map((r) => r.open), [true, true, false], "profitable routes start open, the rest folded");
    t.eq(routes().map((r) => r.classList.contains("top")), [true, false, false], "only the best route is highlighted");
    t.eq($$("#main tr.bad").length, 0, "no red steps");
    t.eq(routes().map((r) => $$("table.steps tbody tr", r).length), [3, 2, 3], "only the trades: no sales or conversions");
    // Each route's line ends with its profit per minute, "+N[icon] / min", and the routes are in that order, most first.
    const rates = routes().map((r) => {
      const m = $("summary h3 > span", r).textContent.match(/([+-]?)([\d,.]+)\s*\/ min/);
      return m ? Number(m[1] + m[2].replace(/,/g, "")) : null;
    });
    t.ok(rates.every((x) => x != null), "every route's line has its profit per minute", rates.join(", "));
    t.eq(rates, [...rates].sort((a, b) => b - a), "routes in order of profit per minute, most first");
    t.ok($$("table.steps td.gold", routes()[0]).every((td) => /^Gold [\d,]+$/.test(text(td))), "steps' Gold Cost: gold's icon, then the amount");
    const line = $("summary h3 > span", routes()[0]);
    t.eq(titles($(":scope > span:not(.sep)", line)), ["Chaos Orb"], "per minute in the profit's currency");
    t.ok(/^Chaos Orb \+\S+ .*·\s*~\d+ min·\s*Chaos Orb \+[\d,]+\.\d\d \/ min·\s*Gold [\d,]+$/.test(text(line)), "profit, then fill time, per minute to two decimals, gold (its icon)", text(line));
    t.eq($$("p.muted", routes()[0]).map(text), [], "no line under the steps: what's left over is in the profit");
    t.eq($$("#main table.steps .tag.estimate").map((x) => x.textContent), [], "no estimate tags");
    t.ok($$("#main table.steps tbody tr").filter((tr) => $("select.method", tr)).every((tr) => $(".tag.verified[data-scan-at]", ratioCell(tr))),
      "every step's Ratio has its scan's age, green");
    $("table.steps tbody button.ratio-link[data-pair]", routes()[0]).click();
    const d = await waitFor(dialog);
    if (t.ok(d && !d.classList.contains("live"), "price window opens")) {
      t.ok(d.matches(":modal"), "price window is modal");
      t.eq($$("button", d).map((b) => b.textContent), ["×", "1", "3.69", "1", "3.40"], "price window: × and each price's two numbers, to type over");
      t.eq($$("input, select, textarea", d).length, 0, "no box until a number is clicked");
      t.eq($$("tr.cols th", d).map((th) => th.textContent), ["Available Trades", "Competing Trades"], "price window columns");
      t.eq(w.getComputedStyle(d, "::backdrop").backgroundColor, "rgba(0, 0, 0, 0.7)", "price window backdrop");
      $("#dialog-close").click();
      t.ok(await waitFor(() => !dialog()), "× closes it");
    }
  } },

  // My Listings (SPEC.md §4.6): added from an item page, any number of times; a step's button starts it, marking the one
  // before done, and clicked again steps back; Completed moves one to the Completed tab and Delete asks first.
  listings: { game: "poe1", seed: "fresh", hash: `#/item/${CHROM}/competitive`, async run(t, seed, page) {
    await ready();
    const add = () => $("[data-add-listing]", routes()[0]);
    t.ok(add() && !$(".count-pill", routes()[0]), "Add to My Listings under the route, no count yet");
    await click(add());
    await click(add());
    t.eq(text($(".count-pill", routes()[0])), "2", "two clicks, two active listings of the route");
    t.eq(text($('nav a[href="#/my-listings"]')), "My Listings (2)", "nav counts them");
    const routeLine = text($("summary h3", routes()[0]));
    await click($(".count-pill", routes()[0]));
    t.eq(tabs(), ["Active (2)", "Completed (0)"], "Active and Completed tabs");
    const box = () => $$("#main div.listing > section")[0];
    t.eq(text($("h3", box())), routeLine, "the listing's line is its route's line on the item page");
    t.ok($$("#main div.listing > section").every((sec) => !sec.classList.contains("losing")), "listings are never dimmed");
    const meta = $$(".listing-meta > span", box().parentElement).map(text);
    const bold = $$(".listing-meta b", box().parentElement).map(text);
    t.ok(/^Start Chaos Orb 10,000\s*Projected Chaos Orb \+[\d,]+/.test(meta[0]) && bold.includes("Start") && bold.includes("Chaos Orb 10,000")
      && bold.includes("Projected") && /^\d{4}-\d\d-\d\d @ \d\d:\d\d[ap]m$/.test(meta[1])
      && !/Projected .*Profit/.test(meta[0]), "above the box: Start and its amount, then Projected (bold, no colons; no Profit till completed), and just the date it was added", meta.join(" | "));
    const states = (i) => $$("table.steps tbody tr", box())[i];
    const chk = (i) => $("[data-listing-check]", states(i));
    const play = (i) => $("[data-listing-play]", states(i));
    const fillOf = (i) => text($$("td", states(i))[4]);
    const look = (b) => (b.classList.contains("on") ? "on" : b.disabled ? "off" : "open");
    const checks = () => $$("tbody [data-listing-check]", box()).map(look);
    const plays = () => $$("tbody [data-listing-play]", box()).map(look);
    t.eq([plays(), checks(), !!$("thead .step-check", box())], [["open", "off", "off"], ["off", "off", "off"], false],
      "a play button and a check on every step, grey; only step 1's play to click; none in the header");
    const looks = (b) => [w.getComputedStyle(b).color, w.getComputedStyle(b).opacity];
    t.eq(looks(chk(1)), looks(play(0)), "a button that can't be clicked yet isn't greyed out: its icon as dark as one that can");
    t.ok($$("thead th", box()).every((th) => w.getComputedStyle(th).verticalAlign === "bottom"), "the header's text on its bottom line");
    t.ok($("select.method", states(0)), "a waiting step's Type is a dropdown");
    const tradeAs = async (i, m) => {
      const sel = $("select.method", states(i));
      sel.value = m;
      sel.dispatchEvent(new w.Event("change", { bubbles: true }));
      await sleep(50);
    };
    await tradeAs(0, "fast");
    t.eq([$("select.method", states(0))?.value, fillOf(0)], ["fast", "instant"], "a waiting step can change how it's traded");
    await tradeAs(0, "slow");
    const amountOf = (i, col) => $$("td", states(i))[col];
    t.ok(!$("button.step-edit", box()) && !$("input", box()) && !!$(".copy", amountOf(0, 1)) && !!$(".copy", amountOf(0, 2)),
      "no pencil, nothing to type (each step's Have comes from the step before it); amounts copy");
    const cancelOf = (i) => $("[data-listing-cancel]", states(i));
    const cancels = () => $$("tbody [data-listing-cancel]", box()).map(look);
    t.eq($$("button", $(".step-buttons", states(0))).map((b) => Object.keys(b.dataset)[0]), ["listingPlay", "listingCancel", "listingCheck"],
      "three buttons a step, in the order they happen: play, cancel, check");
    t.eq(cancels(), ["off", "off", "off"], "cancel only for a started step");
    await click(play(0));
    t.eq([plays(), cancels(), checks(), $("select.method", states(0)), text($$("td", states(0))[6])],
      [["on", "off", "off"], ["open", "off", "off"], ["open", "off", "off"], null, "Competitive"],
      "step 1's play: green, started (click again to put it back), its cancel and check to click; frozen: Type as text");
    t.ok(/min|instant/.test(fillOf(0)), "started: its fill time", fillOf(0));
    await click(chk(0));
    t.eq([plays(), checks(), fillOf(0)], [["on", "open", "off"], ["on", "off", "off"], "< 1 min"],
      "step 1's check: done (how long it took); step 2 waits for its own play button");
    // Step 1's time runs from its play button, unless it was marked done within a minute of it (play clicked late): then
    // from when the listing was added. Added 40 minutes earlier, played and done at once: 40 minutes; played 30 minutes
    // before it was done: 30 minutes.
    const restore = async (change) => {
      const stored = JSON.parse(w.localStorage.getItem(STORAGE.poe1));
      for (const l of stored.listings) change(l);
      w.localStorage.setItem(STORAGE.poe1, JSON.stringify(stored));
      await page.open("/poe1#/my-listings", "/poe1");
      await ready();
    };
    await restore((l) => { l.added -= 40 * 60000; });
    t.eq(fillOf(0), "40 min", "play clicked as it was done: timed from when the listing was added");
    await restore((l) => { if (l.steps[0].at) l.steps[0].at -= 30 * 60000; });
    t.eq(fillOf(0), "30 min", "played 30 minutes before: timed from its play button");
    t.eq(titles($("h3 b", box())), ["Chaos Orb", "Chromatic Orb"], "the profit keeps what step 2 doesn't spend of step 1's Chromatic, as the item page's does");
    await click(play(1));
    t.eq([plays(), checks(), !!$("select.method", states(1)), !!$("select.method", states(2))], [["on", "on", "off"], ["on", "open", "off"], false, true],
      "step 2's play: started and frozen; step 3 still has its dropdown");
    const bg = (el) => w.getComputedStyle(el).backgroundColor;
    t.ok(bg(play(0)) !== bg(chk(0)) && bg(play(0)) === bg(play(1)), "a done check is another colour (blue) from a started play button (green)", `${bg(play(0))} / ${bg(chk(0))}`);
    const kept = saved(STORAGE.poe1).listings.find((l) => l.steps[1].state === "progress").steps;
    t.ok(kept[0].doneAt >= kept[0].at && ["pace", "undercut", "ahead", "queue", "fillAtStart"].every((k) => k in kept[1]),
      "kept: when step 1 was done, and what step 2's fill time was worked out from", JSON.stringify(kept[1]));
    const startedAt = () => saved(STORAGE.poe1).listings.find((l) => l.steps[0].state !== "waiting")?.steps[0].at;
    const at0 = startedAt();
    t.ok(chk(0).disabled, "step 1's check can't be undone while step 2 is started");
    await click(play(1));
    t.eq([plays(), checks()], [["on", "open", "off"], ["on", "off", "off"]], "step 2's green play clicked: back to waiting");
    await click(chk(0));
    t.eq(startedAt(), at0, "put back to started, step 1 keeps when it was started: its time counts on from there");
    t.eq([plays(), checks()], [["on", "off", "off"], ["open", "off", "off"]], "step 1's green check clicked: back to started");
    // A started step's wait counts what's ahead of its order in its row's latest list: the stock at better prices (undercuts)
    // and, at its own price, what was there when it was posted, less the order itself; not just the stock at the best price.
    // With 5,000 queued at its price, a 10 undercut at the top doesn't make the wait shorter (the best price's stock alone
    // would be 10).
    const withList = async (undercut, others = 5000, { queued = true, before = false } = {}) => {
      const stored = JSON.parse(w.localStorage.getItem(STORAGE.poe1)), l = stored.listings.find((x) => x.steps[0].state === "progress");
      const f = l.steps[0].fixed, key = `${f.recv}>${f.give}`;
      l.steps[0].queue = others + (queued ? f.given : 0);
      const levels = [...(undercut ? [{ ratio: [f.ratio[0] * 0.98, f.ratio[1]], stock: undercut }] : []), { ratio: f.ratio, stock: others + (before ? 0 : f.given) }];
      (stored.leagues[LEAGUE.poe1].lists ??= {})[key] = { levels, rest: null, at: before ? l.steps[0].at - 60000 : Date.now() };
      w.localStorage.setItem(STORAGE.poe1, JSON.stringify(stored));
      await page.open("/poe1#/my-listings", "/poe1");
      await ready();
      return numbers(fillOf(0))[0] * (/h/.test(fillOf(0)) ? 60 : 1);
    };
    const [queued, topped] = [await withList(0), await withList(10)];
    t.ok(topped >= queued && queued > 5, "started: the queue at its price counts, and a small undercut on top adds to it", `${queued} → ${topped} min`);
    // The others at its price count the same whether the queue kept when it was started holds the order or not (play pressed
    // before a scan showed it), and with the latest list read before it was started (the order not in it yet).
    const given = JSON.parse(w.localStorage.getItem(STORAGE.poe1)).listings.find((x) => x.steps[0].state === "progress").steps[0].fixed.given;
    const ways = [await withList(0, given), await withList(0, given, { queued: false }), await withList(0, given, { queued: false, before: true })];
    t.ok(ways[0] > (await withList(0, 0)) && ways.every((m) => m === ways[0]),
      "the others queued at its price count with or without the order in the queue, and in a list read before it", `${ways.join(", ")} min`);
    // Step 1 cancelled partway: its cancel opens the Cancelled box, floating beside it, for how much of its Have is left.
    // Enter (or a click outside) takes it: step 1 done for what traded, and a step after it trading the rest the same way.
    const cancelBox = () => $("#cancel-box"), leftBox = () => $("#cancel-left");
    const enter = async (v) => {
      leftBox().value = v;
      leftBox().form.requestSubmit();
      await sleep(50);
    };
    const rowCount = () => $$("table.steps tbody tr", box()).length;
    const [want1, have1] = [1, 2].map((col) => numbers(text(amountOf(0, col)))[0]);
    const profitOf = () => numbers(text($("h3 b", box())))[0];
    const profit0 = profitOf();
    const columns = () => [1, 2, 3].map((col) => Math.round(amountOf(0, col).getBoundingClientRect().left));
    const columns0 = columns();
    t.eq([...cancelOf(0).querySelector("svg").children].map((e) => e.tagName), ["rect"], "the cancel's icon is a stop square");
    await click(cancelOf(0));
    const by = cancelOf(0).getBoundingClientRect(), cb = cancelBox()?.getBoundingClientRect();
    t.ok(cb && w.getComputedStyle(cancelBox()).position === "fixed" && cb.left >= by.right && cb.top < by.bottom && cb.bottom > by.top,
      "the cancel opens the Cancelled box, floating just right of it, level with its row", JSON.stringify([by.right, cb?.left]));
    t.eq([text($("h4", cancelBox())), !!$("[data-cancel-close]", cancelBox()), text($("label", cancelBox())), titles($("form", cancelBox())), w.document.activeElement === leftBox()],
      ["Cancelled", true, "Remaining", ["Chaos Orb"], true], "headed Cancelled, with its ×; then [Chaos][box] Remaining, the box ready to type in");
    t.eq(columns(), columns0, "opening it moves nothing");
    await enter(String(have1 + 1));
    t.eq([!!cancelBox(), leftBox()?.getAttribute("aria-invalid")], [true, "true"], "more than it had: not taken, the box stays");
    leftBox().dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(50);
    t.eq([!!cancelBox(), plays()[0], rowCount()], [false, "on", 3], "Esc closes it: step 1 still started");
    await click(cancelOf(0));
    await click($("[data-cancel-close]", cancelBox()));
    t.eq([!!cancelBox(), rowCount()], [false, 3], "so does its ×");
    const left = Math.floor(have1 / 4), sold = have1 - left, got1 = Math.round((want1 * sold) / have1);
    await click(cancelOf(0));
    await enter(String(left));
    t.eq([!!cancelBox(), rowCount(), plays(), checks()], [false, 4, ["on", "open", "off", "off"], ["on", "off", "off", "off"]],
      "Enter takes it: step 1 done, a step inserted after it waiting for its own play button");
    t.eq([numbers(text(amountOf(0, 1)))[0], numbers(text(amountOf(0, 2)))[0], numbers(text($(".filled", amountOf(0, 2))))[0], w.getComputedStyle($(".filled", amountOf(0, 2))).whiteSpace],
      [want1, have1, sold, "nowrap"], "step 1 as posted, with how much of it filled after its Have, on one line");
    const leftHave = numbers(text(amountOf(1, 2)))[0];
    t.ok(leftHave <= left && leftHave > left * 0.99 && titles(amountOf(1, 2)).join() === "Chaos Orb" && titles(amountOf(1, 1)).join() === "Chromatic Orb" && !!$("select.method", states(1)),
      "the inserted step: what was left (in whole lots), for the same thing again, at the latest price", `${leftHave} of ${left}`);
    const both = got1 + numbers(text(amountOf(1, 1)))[0], next = numbers(text(amountOf(2, 2)))[0];
    t.ok(next <= both && next > both * 0.95, "step 3 trades what both bought", `${next} of ${both}`);
    t.ok(profitOf() !== profit0, "the profit counts what step 1 traded and the rest at the latest price", `${profit0} → ${profitOf()}`);
    t.eq(cancels(), ["off", "open", "off", "off"], "the inserted step's cancel, while it waits, undoes the cancel");
    await click(cancelOf(1));
    t.eq([rowCount(), plays(), !!$(".filled", box()), numbers(text(amountOf(0, 2)))[0], profitOf()], [3, ["on", "off", "off"], false, have1, profit0],
      "undone: step 1 started again, with its whole order");
    await click(cancelOf(0));
    leftBox().value = String(left);
    w.document.body.dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true }));
    await sleep(50);
    t.eq([!!cancelBox(), rowCount()], [false, 4], "a click outside the box takes what's typed too");
    t.eq(saved(STORAGE.poe1).listings.find((l) => l.steps.length === 4).steps.map((st) => [st.state, !!st.repost]),
      [["done", false], ["waiting", true], ["waiting", false], ["waiting", false]], "saved: the inserted step after the one it continues");
    t.eq($$(".listing-foot button", box()).map((b) => [b.textContent, b.className]), [["Delete", "danger"], ["Mark As Completed", "complete"]],
      "Delete, then Mark As Completed (green) on the right");
    const toLast = async () => {
      for (let i = 0; i < rowCount(); i++) {
        if (look(play(i)) === "open" && !play(i).classList.contains("on")) await click(play(i));
        if (look(chk(i)) === "open") await click(chk(i));
      }
    };
    t.ok($("[data-listing-complete]", box()).disabled, "Mark As Completed disabled until every step is done");
    await toLast();
    t.eq([checks(), $("[data-listing-complete]", box()).disabled], [["on", "on", "on", "on"], false], "every step done, the inserted one too: Mark As Completed enabled");
    await click($("[data-listing-complete]", box()));
    t.eq(tabs(), ["Active (1)", "Completed (1)"], "completed");
    await click($$("#main .tabs a")[1]);
    t.eq([$$(".listing-foot button", box()).map((b) => b.textContent), $$(".step-check", box()).length], [["Delete", "Mark As Active"], 0],
      "a completed listing: no step buttons, Delete then Mark As Active");
    const head = text($(".listing-meta > span", box().parentElement));
    t.ok(/Projected Chaos Orb [+-][\d,]+.*\s*Profit Chaos Orb [+-][\d,]+/.test(head), "completed: Profit after Projected", head);
    const span = text($(".listing-meta > span:last-child", box().parentElement));
    t.ok(/^\d{4}-\d\d-\d\d @ \d\d:\d\d[ap]m - \d{4}-\d\d-\d\d @ \d\d:\d\d[ap]m$/.test(span), "completed: when it was added, then when it was completed", span);
    const times = $(".listing-times", box().parentElement), dash = $(".range-dash", times);
    t.ok(Number(w.getComputedStyle(times).fontWeight) >= 600 && parseFloat(w.getComputedStyle(dash).marginLeft) > 0, "the times bold, the dash between them spaced out");
    await click($("[data-listing-active]", box()));
    t.eq(tabs(), ["Active (2)", "Completed (0)"], "Mark As Active puts it back on Active");
    await click($$("#main .tabs a")[0]);
    await click($("[data-listing-complete]", $$("#main div.listing > section").find((sec) => !$("[data-listing-complete]", sec)?.disabled)));
    await click($$("#main .tabs a")[1]);
    await click($("[data-listing-delete]", box()));
    t.eq(text($("#main .confirm")).startsWith("This deletes the listing. Are you sure?"), true, "Delete asks first");
    t.eq($$("#main .confirm button").map((b) => b.textContent), ["Yes", "Cancel"], "Delete's answers: Yes or Cancel");
    await click($("#listing-delete-yes"));
    t.eq([tabs(), text($("#main p.muted"))], [["Active (1)", "Completed (0)"], `No completed listings for ${LEAGUE.poe1}.`], "deleted");
    const clear = $("#remove-completed");
    t.ok(clear?.disabled && clear.textContent === "Clear All" && !!clear.closest(".clear-all") && !$(".page-head #remove-completed"),
      "Completed: Clear All under the tabs, disabled with none completed");
    await click($$("#main .tabs a")[0]);
    t.ok(!$("#remove-completed"), "no Clear All on Active");
    await toLast();
    await click($("[data-listing-complete]", box()));
    await click($$("#main .tabs a")[1]);
    t.eq(Math.round($("#remove-completed").getBoundingClientRect().left), Math.round($("#main .tabs").getBoundingClientRect().left), "aligned left with the page");
    await click($("#remove-completed"));
    t.ok(text($("#main .confirm")).startsWith(`This removes 1 completed listing for ${LEAGUE.poe1}. Are you sure?`), "Clear All asks first");
    t.eq($$("#main .confirm button").map((b) => b.textContent), ["Yes", "Cancel"], "its answers: Yes or Cancel");
    await click($("#remove-completed-yes"));
    t.eq(tabs(), ["Active (0)", "Completed (0)"], "completed listings removed");
  } },

  // An order seen without its play button (SPEC.md §4.6): a scan of the next step's list where the stock at its price rose by
  // 95% to 105% of its order puts "Similar order detected. Was it yours?" under it. Yes starts it from that scan; No hides it
  // for good.
  // A listing's Manual step (SPEC.md §4.6): last of a waiting step's Types; it keeps the price it had and opens no dialog;
  // each number is a box once clicked, Enter takes what's typed and Esc doesn't; in the scan tag's place, reset goes back to
  // the Competing price (greyed out at it); a newer scan and a reload leave it alone; started, its ratio is the usual button
  // again.
  // A listing's step whose price isn't scanned is an Estimate step: Estimate or Manual only, Manual starting from the
  // estimate, its reset back to the estimate; once scanned it's back to Competitive.
  listingEstimate: { game: "poe1", seed: "stale", hash: `#/item/${CHROM}/estimated`, async run(t, seed, page) {
    await ready();
    const direct = () => routes().find((r) => r.dataset.row === "direct");
    if (!direct().open) { $("summary", direct()).click(); await waitFor(() => direct().open); }
    await click($("[data-add-listing]", direct()));
    await go("#/my-listings");
    const row = () => $$("#main table.steps tbody tr")[0], cell = () => $$("td", row())[3];
    t.eq([$$("option", $("select.method", row())).map((o) => o.textContent), $("select.method", row()).value, cellTags(cell())],
      [["Estimated", "Manual"], "estimate", ["estimated"]], "Chaos → Chromatic: an Estimated step, Estimated or Manual");
    t.eq([$$(".step-buttons button", row()).length, text($(".estimate-note", row())), $(".estimate-note", row())?.title],
      [0, "Cannot trade", "Set its Type to Manual and type the price the game shows first"], "an Estimate step: no buttons, a warning instead");
    t.eq($$("option", $("select.method", $$("#main table.steps tbody tr")[1])).map((o) => o.textContent), ["Competitive", "Instant", "Manual"],
      "Chromatic → Chaos, scanned: its usual Types");
    const sel = $("select.method", row());
    sel.value = "manual";
    sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    await waitFor(() => $(".manual-edit", cell()));
    t.eq($$(".manual-edit", cell()).map(text), ["1", "3.5"], "Manual starts from the estimate, 1 : 3.5");
    t.ok(!$("[data-listing-play]", row()).disabled, "Manual: its play button is on");
    await click($$(".manual-edit", cell())[1]);
    $("#manual-ratio").value = "3.4";
    $("#manual-ratio").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(50);
    t.eq([$("[data-manual-reset]", cell())?.title, $("[data-manual-reset]", cell())?.disabled], ["Back to the estimated price", false], "reset: back to the estimated price");
    await click($("[data-manual-reset]", cell()));
    t.eq($$(".manual-edit", cell()).map(text), ["1", "3.5"], "reset takes it back");
    t.eq($$("option", $("select.method", row())).map((o) => o.textContent), ["Estimated", "Manual"], "Manual with no Competing price scanned: Estimated or Manual");
    const back = $("select.method", row());
    back.value = "estimate";
    back.dispatchEvent(new w.Event("change", { bubbles: true }));
    await waitFor(() => !$(".manual-edit", cell()));
    t.eq([$("select.method", row()).value, cellTags(cell())], ["estimate", ["estimated"]], "back to Estimated");
    t.eq(saved(STORAGE.poe1).listings[0].methods[0], "slow", "kept as Competitive, for when it's scanned");
    // Scanned again: the step is back to the Type it was given, Competitive.
    const l = saved(STORAGE.poe1).listings[0];
    l.methods[0] = "slow";
    const state = saved(STORAGE.poe1);
    state.listings = [l];
    state.leagues[LEAGUE.poe1].ratios[`${CHROM}>${C}`] = { value: [1, 3.4], digits: [0, 2], verifiedAt: Date.now() };
    w.localStorage.setItem(STORAGE.poe1, JSON.stringify(state));
    await page.open("/poe1#/my-listings", "/poe1");
    await ready();
    t.eq([$("select.method", row())?.value, cellTags(cell())[0]?.endsWith("m")], ["slow", true], "scanned: Competitive, with its scan's age");
  } },

  // One Manual price per direction: set on an item page's Manual step, it's the price of every Manual step on that direction,
  // on My Listings too, and the price window and Market Ratios' Manual tab show it; typed in the price window, it changes them
  // all; reset sets it back to the estimate.
  manualShared: { game: "poe1", seed: "stale", hash: `#/item/${CHROM}/estimated`, async run(t) {
    await ready();
    const direct = () => routes().find((r) => r.dataset.row === "direct");
    const open = async () => { if (!direct().open) { $("summary", direct()).click(); await waitFor(() => direct().open); } };
    await open();
    await click($("[data-add-listing]", direct()));
    // Chaos → Chromatic, an Estimate step at 1 : 3.5: set to Manual on the item page, then typed.
    const sel = $("select.method", $("table.steps tbody tr", direct()));
    sel.value = "manual";
    sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    await waitFor(() => $(".manual-edit", direct()));
    const cell = () => $$("td", $("table.steps tbody tr", direct()))[3];
    t.eq($$(".manual-edit", cell()).map(text), ["1", "3.5"], "item page: Manual starts from the estimate");
    await click($$(".manual-edit", cell())[1]);
    $("#manual-ratio").value = "3.6";
    $("#manual-ratio").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(50);
    t.eq($$(".manual-edit", cell()).map(text), ["1", "3.6"], "typed: 1 : 3.6");
    await go("#/my-listings");
    const row = () => $$("#main table.steps tbody tr")[0];
    const lsel = $("select.method", row());
    lsel.value = "manual";
    lsel.dispatchEvent(new w.Event("change", { bubbles: true }));
    await waitFor(() => $(".manual-edit", row()));
    t.eq($$(".manual-edit", row()).map(text), ["1", "3.6"], "My Listings: a Manual step on the same direction has the same price");
    await click($("button.ratio-link[data-pair]", $$("#main table.steps tbody tr")[1]));
    const dlg = () => $("#ratio-dialog");
    const line = () => $("tbody.dialog-pair tr:last-child", dlg());
    t.eq([$$(".manual-edit", line()).map(text), $$("td.r-tags", line())[1].textContent.replace(/\s+/g, " ").trim()],
      [["1", "3.69", "1", "3.6"], "manual reset"], "the price window: the Manual price, tagged manual, with reset");
    await click($$(".manual-edit", line())[3]);
    $("#manual-ratio").value = "3.55";
    $("#manual-ratio").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(50);
    $("#dialog-close").click();
    await waitFor(() => !dlg());
    t.eq($$(".manual-edit", row()).map(text), ["1", "3.55"], "typed in the window: the listing's step follows");
    await go("#/market-ratios/manual");
    t.eq([activeTab(), $$("tbody[data-row]").map((b) => b.dataset.row)], ["Manual (1)", [CHROM]], "Market Ratios' Manual tab lists it");
    t.ok(!$("#main table.ratios .manual-edit, #main table.ratios [data-manual-reset]"), "not editable there");
    await go(`#/item/${CHROM}/estimated`);
    await open();
    t.eq($$(".manual-edit", cell()).map(text), ["1", "3.55"], "and the item page's");
    await click($("[data-manual-reset]", cell()));
    t.eq($$(".manual-edit", cell()).map(text), ["1", "3.5"], "reset: back to the estimate");
  } },

  listingManual: { game: "poe1", seed: "fresh", hash: `#/item/${CHROM}/competitive`, async run(t, seed, page) {
    await ready();
    await click($("[data-add-listing]", routes()[0]));
    await go("#/my-listings");
    const row = (i) => $$("#main table.steps tbody tr")[i];
    const cell = () => $$("td", row(0))[3];
    const shown = () => $$(".manual-edit", cell()).map(text);
    const reset = () => $("[data-manual-reset]", cell());
    const want = () => numbers(text($$("td", row(0))[1]))[0];
    const sel = $("select.method", row(0));
    t.eq($$("option", sel).map((o) => o.textContent), ["Competitive", "Instant", "Manual"], "a waiting step's Types, Manual last");
    const scanned = want();
    sel.value = "manual";
    sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    await waitFor(() => $(".manual-edit", cell()));
    t.eq([shown(), cellTags(cell()), !!$("[data-pair]", cell()), want()], [["1", "3.4"], [], false, scanned],
      "Manual keeps 1 : 3.4, both numbers to change, no scan tag, no dialog");
    t.ok(reset()?.disabled, "reset off at the Competing price");
    const typeIn = async (side, value, key = "Enter") => {
      await click($$(".manual-edit", cell())[side]);
      const box = $("#manual-ratio");
      box.value = value;
      box.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true }));
      await sleep(50);
    };
    await typeIn(1, "3.35");
    t.eq([shown(), want() > scanned, reset()?.disabled], [["1", "3.35"], true, false], "Enter takes 3.35: more Chromatic for the Chaos; reset on");
    await typeIn(0, "2", "Escape");
    t.eq(shown(), ["1", "3.35"], "Esc keeps it");
    await typeIn(0, "0.9");
    t.eq(shown(), ["0.9", "3.35"], "either number, any number");
    for (const type of ["slow", "fast", "manual"]) {
      const select = $("select.method", row(0));
      select.value = type;
      select.dispatchEvent(new w.Event("change", { bubbles: true }));
      await sleep(50);
    }
    t.eq(shown(), ["0.9", "3.35"], "Competitive, Instant, then Manual again: the price typed before");
    await click(reset());
    t.eq([shown(), want()], [["1", "3.4"], scanned], "reset: back to the Competing price");
    await typeIn(1, "3.35");
    const stored = JSON.parse(w.localStorage.getItem(STORAGE.poe1));
    stored.leagues[stored.league].ratios[`${CHROM}>${C}`].value = [1, 3.6];
    w.localStorage.setItem(STORAGE.poe1, JSON.stringify(stored));
    await page.open("/poe1#/my-listings", "/poe1");
    await ready();
    t.eq(shown(), ["1", "3.35"], "a newer scan and a reload leave it as typed");
    await click(reset());
    t.eq(shown(), ["1", "3.6"], "reset: the newer Competing price");
    await click($("[data-listing-play]", row(0)));
    t.eq([!!$(".manual-edit", cell()), !!$("button.ratio-link[data-pair]", cell()), text($$("td", row(0))[6])], [false, true, "Manual"],
      "started: the usual ratio button, its Type plain text");
  } },

  listingOrderSeen: { game: "poe1", seed: "fresh", hash: `#/item/${CHROM}/competitive`, async run(t, seed, page) {
    await ready();
    await click($("[data-add-listing]", routes()[0]));
    await click($(".count-pill", routes()[0]));
    const box = () => $$("#main div.listing > section")[0], hint = () => $(".hint-row", box());
    const play = () => $("[data-listing-play]", box());
    await click(play());
    const step = saved(STORAGE.poe1).listings[0].steps[0].fixed;
    await click(play());
    const key = `${step.recv}>${step.give}`, now = Date.now();
    // Two scans a minute apart, the stock at its price up by `rise` of its order, the listing added before them.
    const scans = async (rise, change = () => {}) => {
      const stored = JSON.parse(w.localStorage.getItem(STORAGE.poe1)), l = stored.listings[0];
      l.added = now - 10 * 60000;
      change(l.steps[0]);
      stored.leagues[LEAGUE.poe1].reads = { [key]: [{ at: now - 120000, levels: [{ ratio: step.ratio, stock: 100 }] },
        { at: now - 60000, levels: [{ ratio: step.ratio, stock: 100 + Math.round(rise * step.given) }] }] };
      w.localStorage.setItem(STORAGE.poe1, JSON.stringify(stored));
      await page.open("/poe1#/my-listings", "/poe1");
      await ready();
    };
    await scans(0.9);
    t.ok(!hint(), "the stock at its price up by 90% of the order: no hint");
    await scans(1.04);
    t.eq([text($(".hint-line span", box())), $$(".hint-line button", box()).map((b) => b.textContent)],
      ["Similar order detected. Was it yours?", ["Yes", "No"]], "up by 104%: the hint under the step, Yes and No");
    t.ok(hint()?.previousElementSibling === $$("table.steps tbody tr", box())[0], "right under its step");
    await click($("[data-listing-no]", box()));
    t.ok(!hint() && saved(STORAGE.poe1).listings[0].steps[0].noHint === true, "No hides it, and keeps it hidden");
    await scans(1);
    t.ok(!hint(), "after No, another scan like it shows nothing");
    await scans(1, (st) => delete st.noHint);
    await click($("[data-listing-yes]", box()));
    const st = saved(STORAGE.poe1).listings[0].steps[0];
    t.eq([st.state, st.at, !!hint()], ["progress", now - 60000, false], "Yes: started, from the scan that saw the order");
  } },

  // The ratio dialog: at least 43rem, whatever little it holds.
  dialogWidth: { game: "poe1", seed: "fresh", hash: `#/item/${CHROM}/competitive`, async run(t) {
    await ready();
    $("table.steps tbody button.ratio-link[data-pair]", routes()[0]).click();
    const d = await waitFor(dialog);
    const width = d.getBoundingClientRect().width;
    t.ok(width >= 680 && width <= 740, "at least 43rem wide", `${width}px`);
  } },

  itemLosing: { game: "poe1", seed: "fresh", hash: `#/item/${ALCH}/competitive`, async run(t) {
    await ready();
    t.ok(routes().length, "routes listed");
    t.eq(routes().map((r) => [r.open, r.classList.contains("losing")]), routes().map(() => [false, true]), "losing routes start folded, greyed");
    t.eq($$("#main details.top").length, 0, "nothing highlighted");
  } },

  itemSlow: { game: "poe1", seed: "fresh", hash: `#/item/${VIVID}/competitive`, async run(t) {
    await ready();
    const [best] = routes();
    t.ok(best?.open && best.classList.contains("top"), "best route open and highlighted");
    t.eq(cellTags($("summary", best)), [], "route line: no tag however long it takes");
    const steps = routes().flatMap(stepRowsOf).filter((tr) => tr.cells[4]);
    t.eq(steps.filter((tr) => tr.cells[4].children.length).map((tr) => tr.cells[4].innerHTML), [], "steps' fill times: no sign or tag");
    t.eq($$("#main tr.bad").length, 0, "slow steps aren't red");
  } },

  // Chromatic is quick on its own, but with a big queue posted at each of its Competing prices every route is slow.
  itemQueued: { game: "poe1", seed: "queued", hash: `#/item/${CHROM}/competitive`, async run(t) {
    await ready();
    t.ok(routes().length, "routes listed");
    t.eq(routes().map((r) => cellTags($("summary", r))), routes().map(() => []), "slow, and no route line says so");
  } },

  // A step's Type on an item page: Competitive or Instant, in the tabs' order; clicking a tab (the open one too) puts every
  // step back to the tab's type.
  itemTypes: { game: "poe1", seed: "fresh", hash: `#/item/${CHROM}/competitive`, async run(t) {
    await ready();
    const sel = () => $("select.method", stepRowsOf(routes()[0])[0]);
    t.eq($$("option", sel()).map((o) => o.textContent), ["Competitive", "Instant", "Manual"], "the selector: Competitive and Instant, in the tabs' order, then Manual");
    const methods = () => [...new Set($$("select.method").map((s) => s.value))].sort();
    const tab = (name) => $$("#main .tabs a").find((a) => a.textContent === name);
    const toInstant = async () => {
      sel().value = "fast";
      sel().dispatchEvent(new w.Event("change", { bubbles: true }));
      await waitFor(() => methods().length === 2);
    };
    await toInstant();
    t.eq(methods(), ["fast", "slow"], "one step switched to Instant");
    await click(tab("Competitive Trading"));
    t.eq(methods(), ["slow"], "clicking the open tab puts it back");
    await toInstant();
    await click(tab("Instant Trading"));
    t.eq(methods(), ["fast"], "clicking a tab puts every step to its type");
  } },

  // A pair with no recent trades: its Competing steps' fill time is unknown, and the route is tradeable all the same.
  itemNoRecentTrades: { game: "poe1", seed: "fresh", hash: `#/item/${SULPHUR}/competitive`, async run(t) {
    await ready();
    t.eq(routes().map((r) => r.open), routes().map(() => true), "its routes open, as tradeable ones are");
    const [first] = routes();
    t.ok(/·\s*—\s*·/.test(text($("summary", first))) && cellTags($("summary", first)).length === 0, "route line: fill time unknown, no tag", text($("summary", first)));
    t.eq(stepRowsOf(first).filter((tr) => tr.classList.contains("bad")).length, 0, "no step shaded red");
  } },

  // A scan over 4 hours old is forgotten: its routes are "not scanned" on Competitive, and it's gone from the saved state.
  itemStale: { game: "poe1", seed: "stale", hash: `#/item/${CHROM}/competitive`, async run(t) {
    await ready();
    t.eq($("#main h1 .tag"), null, "heading: no tag, a price isn't scanned");
    const unread = routes().filter((r) => /Not read from the game yet:/.test(r.textContent)).map((r) => r.dataset.row);
    t.eq(unread.sort(), [`after:${D}`, "direct"], "the routes buying Chromatic with Chaos: not scanned");
    t.ok(!(STALE_KEY in saved(STORAGE.poe1).leagues[LEAGUE.poe1].ratios), "the old scan is dropped");
  } },

  itemGap: { game: "poe1", seed: "gap", hash: `#/item/${CHROM}/competitive`, async run(t) {
    await ready();
    t.ok(routes().length && routes().every((r) => !r.open && r.classList.contains("losing")), "routes folded, greyed");
    t.ok(routes().every((r) => /Not read from the game yet:/.test(r.textContent)), "each route says what isn't read");
    t.eq($("#main h1 .tag"), null, "heading has no tag");
    $("summary", routes()[0]).click();
    await waitFor(() => routes()[0].open);
    await click($("[data-import]", routes()[0]));
    docked(t);
  } },

  volumes: { game: "poe1", seed: "fresh", hash: "#/trade-volumes", async run(t) {
    await volumesCheck(t, "poe1", [C, D]);
    // The hub columns are the item pages' volumes.
    const page = Object.fromEntries($$("table.volumes tbody tr").map((tr) => [titles(tr.cells[0])[0], tr]));
    const heads = $$("table.volumes thead th:not(.age)").map((th) => titles(th)[0] ?? th.textContent.trim());
    for (const id of [CHROM, D]) {
      const row = page[NAMES[id]];
      const want = Object.fromEntries(heads.slice(2).map((h, i) => [h, numbers($$("td.num", row)[i + 1].textContent)[0]]).filter(([, n]) => n != null));
      await go(`#/item/${id}/competitive`);
      t.eq(volumeParts($("#main .item-volume")), want, `${NAMES[id]}: its page's volume equals Trade Volumes' hub columns`);
    }
  } },

  // Beside each hub count, its pair's age: the older of its two prices scanned, none for a pair not scanned.
  volumesAge: { game: "poe1", seed: "stale", hash: "#/trade-volumes", async run(t) {
    await ready();
    const heads = $$("table.volumes thead th:not(.age)").slice(2).map((th) => titles(th)[0] ?? th.textContent.trim());
    const got = Object.fromEntries($$("table.volumes tbody tr").map((tr) => [titles(tr.cells[0])[0],
      Object.fromEntries($$("td.age", tr).map((td, i) => [heads[i], td.textContent.trim()]))]));
    const want = (c, d) => ({ "Chaos Orb": c, "Divine Orb": d });
    t.eq(got[NAMES[C]], want("", "2m"), "Chaos: blank in its own column, Chaos ↔ Divine's age in Divine's");
    t.eq(got[NAMES[CHROM]], want("5m", "2m"), "Chromatic: its 5-hour price gone, the other way's");
    t.eq(got[NAMES[VIVID]], want("2m", "6m"), "Vivid: the older of its Divine pair's two prices");
    const unscanned = Object.entries(got).filter(([name]) => ![C, D, CHROM, VIVID, SULPHUR, ALCH].some((id) => NAMES[id] === name));
    t.ok(unscanned.length && unscanned.every(([, ages]) => Object.values(ages).every((a) => a === "")), "no tag for a pair never scanned",
      JSON.stringify(unscanned));
    // Each hub's header ends where its counts do (icon first, the number last), with each tag just after its count.
    const right = (el) => Math.round(el.getBoundingClientRect().right);
    const contentRight = (td) => { const r = w.document.createRange(); r.selectNodeContents(td); return right(r); };
    // The end of a header's name, before any sort arrow.
    const ends = $$("table.volumes thead th:not(.age)").slice(2).map((th) => {
      const label = [...$("button", th).childNodes].filter((n) => n.nodeType === 3).pop(), r = w.document.createRange();
      r.setStart(label, 0);
      r.setEnd(label, label.textContent.replace(/ [▼▲]$/, "").length);
      return right(r);
    });
    const counts = $$("table.volumes tbody tr").flatMap((tr) => $$("td.num", tr).slice(1).map((td, i) => [i, td]))
      .filter(([, td]) => td.textContent.trim()).map(([i, td]) => [i, contentRight(td)]);
    t.ok(counts.length && counts.every(([i, x]) => Math.abs(x - ends[i]) <= 1), "hub headers line up with their counts",
      JSON.stringify({ ends, counts }));
    const tags = $$("table.volumes td.age .tag").map((tag) => [tag.getBoundingClientRect().left, contentRight(tag.closest("td").previousElementSibling)]);
    t.ok(tags.length && tags.every(([left, count]) => left > count && left - count < 12), "each age tag just after its count",
      JSON.stringify(tags));
  } },

  volumesPoe2: { game: "poe2", seed: "poe2", hash: "#/trade-volumes", async run(t) {
    await volumesCheck(t, "poe2", [E, D]);
  } },

  ratios: { game: "poe1", seed: "fresh", hash: "#/market-ratios", async run(t, seed) {
    await ready();
    t.eq([tabs(), activeTab(), $("#main .clear-all")], [["Competitive (5)", "Instant (5)", "Estimated (5)", "Manual (0)"], "Competitive (5)", null],
      "tabs: Competitive, the default, Instant, Estimated (every currency traded in the last 4 hours, scanned or not) and Manual; no Clear All");
    t.eq(text($("tbody[data-row] .group-head")), "Chaos ↔ Divine", "Chaos ↔ Divine first");
    t.eq($$("tbody[data-row] .group-head").length, 5, "every currency scanned");
    const times = new Set(Object.values(seed.leagues[seed.league].ratios).map((r) => r.verifiedAt));
    const tags = $$("#main .tag.verified");
    t.eq(tags.length, 9, "a green tag per scanned Competing price");
    t.eq(tags.filter((x) => !times.has(Number(x.dataset.scanAt)) || x.title !== `Scanned ${scanDate(Number(x.dataset.scanAt))}`)
      .map((x) => x.title), [], "tags' titles: Scanned <date>");
    await click($$("#main .tabs a").find((a) => a.textContent.startsWith("Estimated")));
    t.eq(w.location.hash, "#/market-ratios/estimated", "Estimated's address");
    const listed = $$("tbody[data-row]").map((b) => b.dataset.row);
    t.eq([listed[0], listed.length, listed.includes(CHROM), listed.includes("CurrencyRerollSocketLinks"), listed.includes(SULPHUR)],
      ["hubs", 5, true, true, false], "Estimated: Chaos ↔ Divine first, every currency with an estimate, scanned or not (not Sulphur, no recent trades)");
    t.eq($$(`#main tbody[data-row='${CHROM}'] tr:not(.group) td.r-tags`).map((td) => td.textContent.trim()).slice(0, 2), ["estimated", "estimated"],
      "a scanned currency shows its estimated prices here");
    // Last hour in the fixture, in Divine at 375 : 1 (375,000 Chaos for 1,000 Divine): Chromatic 70,000c + 1,250 div (1,437),
    // Alchemy 12,000c + 100 div (132), Vivid 3,600c + 18 div (28), Orb of Fusing 6,000c (16).
    t.eq(listed, ["hubs", CHROM, ALCH, VIVID, "CurrencyRerollSocketLinks"], "after Chaos ↔ Divine, the most traded first, in Divine");
    const lines = (id) => $$(`#main tbody[data-row='${id}'] tr:not(.group)`).length;
    t.eq(lines("CurrencyRerollSocketLinks"), 1, "Orb of Fusing: only its Chaos line, the Divine one has no estimate");
    t.ok(!$$("#main td.r-none").length, "no line without an estimated price");
    const est = $$("#main table.ratios tbody[data-row='CurrencyRerollSocketLinks'] tr:not(.group) td.r-tags").map((td) => td.textContent.trim());
    t.eq(est.slice(0, 2), ["estimated", "estimated"], "its Chaos line at the estimated price, both ways");
    t.ok(!$("#main table.ratios .manual-edit, #main table.ratios input"), "nothing to edit");
    await click($$("#main .tabs a").find((a) => a.textContent.startsWith("Manual")));
    t.eq(text($("#main > p.muted")), `No manual prices for ${LEAGUE.poe1}. Set a step's Type to Manual, or type into a price's window, to add one.`, "Manual: empty message");
  } },

  // Each price is six cells (icon, number, colon, number, icon, tags), so every row's parts line up: the colons in one
  // column, each number against its side of the colon and each icon against its number.
  ratioCells: { game: "poe1", seed: "fresh", hash: "#/market-ratios", async run(t) {
    await ready();
    const rows = pageRows();
    t.eq(rows.map((tr) => [...tr.cells].map((td) => td.className.replace(/ ?muted/, "")).join(" ")).filter((x, i, all) => all.indexOf(x) === i),
      [["r-icon r-end", "r-num r-end", "r-colon", "r-num", "r-icon", "r-tags", "num wait", "vol"].join(" ")],
      "every row (Competitive): icon, number, colon, number, icon, tags, then Wait and the volume");
    const box = (el) => el.getBoundingClientRect();
    const ink = (td) => { const r = w.document.createRange(); r.selectNodeContents(td); return r.getBoundingClientRect(); };
    for (const col of [0]) {
      const at = (i) => rows.map((tr) => tr.cells[col + i]);
      const same = (xs) => Math.max(...xs) - Math.min(...xs) <= 1;
      t.ok(same(at(2).map((td) => (box(td).left + box(td).right) / 2)), `column ${col / 6 + 1}: colons line up`);
      t.ok(same(at(1).map((td) => ink(td).right)), `column ${col / 6 + 1}: left numbers end together`);
      t.ok(same(at(3).map((td) => ink(td).left)), `column ${col / 6 + 1}: right numbers start together`);
      const gaps = rows.map((tr) => [ink(tr.cells[col + 2]).left - ink(tr.cells[col + 1]).right, ink(tr.cells[col + 3]).left - ink(tr.cells[col + 2]).right,
        Math.min(...rows.map((r) => ink(r.cells[col + 1]).left)) - box($(".icon", tr.cells[col])).right,
        box($(".icon", tr.cells[col + 4])).left - Math.max(...rows.map((r) => ink(r.cells[col + 3]).right))]);
      t.eq(gaps.flat().filter((g) => g < 0 || g > 8).map(Math.round), [], `column ${col / 6 + 1}: numbers close to the colon, icons close to the longest number`);
    }
  } },

  // Competitive: the Competing price and Wait, the Competing queue's fill time at the pair's pace (only where its stock was
  // read); Instant: the Available price alone.
  ratioStats: { game: "poe1", seed: "stocked", hash: "#/market-ratios", async run(t) {
    await ready();
    const heads = () => $$("#main table.ratios thead th").filter((el) => !el.closest("#live-dialog")).map((th) => th.textContent);
    t.eq(heads(), ["Competing Trades", "Wait", "Traded last hour"], "Competitive: headers");
    const wait = (n) => pageRows()[n].querySelector(".wait").textContent;
    t.eq(wait(0), "~1.0 h", "Chaos ↔ Divine: 250 div queued at 250 an hour (a quarter of the 1,000 traded)");
    t.eq(wait(1), "", "Chromatic vs Chaos: no stock read, no wait");
    await go("#/market-ratios/available");
    t.eq([activeTab(), heads()], ["Instant (5)", ["Available Trades", "Traded last hour"]], "Instant: the Available price alone");
    t.eq(text($$("td", pageRows()[0]).find((td) => td.classList.contains("r-num"))), "370", "Chaos ↔ Divine: 370 : 1");
  } },

  // Undercutting (SPEC.md §3.6): 250 div an hour posted ahead of Chaos:Divine's best price, read from its lists, drains its
  // queue at the floor, half the pace.
  undercut: { game: "poe1", seed: "undercut", hash: "#/market-ratios", async run(t) {
    await ready();
    t.eq(pageRows()[0].querySelector(".wait").textContent, "~2.0 h", "Wait: 250 div queued at 250 an hour less 250 undercutting, no less than 125");
    await go(`#/item/${CHROM}/competitive`);
    const titled = $$("#main table.steps td.num[title]").map((td) => td.title);
    t.ok(titled.length > 0, "a step's fill time says it counts the undercutting");
    t.eq([...new Set(titled)], ["Counts orders posted ahead of yours: about 250 Divine Orb an hour"], "its hover");
  } },

  // Measured buying (SPEC.md §3.6): 150 div an hour of Chaos:Divine's orders bought, read from its lists, paces its queue in
  // place of the pair's 250.
  bought: { game: "poe1", seed: "bought", hash: "#/market-ratios", async run(t) {
    await ready();
    t.eq(pageRows()[0].querySelector(".wait").textContent, "~1.7 h", "Wait: 250 div queued at 150 an hour");
    await go(`#/item/${CHROM}/competitive`);
    const titled = $$("#main table.steps td.num[title]").map((td) => td.title);
    t.ok(titled.length > 0, "a step's fill time says it's paced by the scans");
    t.eq([...new Set(titled)], ["Paced by your scans: about 150 Divine Orb bought an hour"], "its hover");
  } },

  ratiosEmpty: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    t.eq(tabs(), ["Competitive (0)", "Instant (0)", "Estimated (5)", "Manual (0)"], "tabs");
    t.eq(text($("#main > p.muted")), `No Competing Trades have been scanned for ${LEAGUE.poe1} in the last 4 hours. Use Import Market Ratios at the top right to read them from the game.`, "empty message");
  } },

  importWindow: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    t.ok($("#live-dialog[open].collapsed") && !liveDialog(), "on load, the import window is on the page, hidden to its strip");
    await click($("#live-import"));
    docked(t);
    t.eq($$("button", liveDialog()).map((b) => b.title || b.textContent), ["Hide the import window", "How it works", "Share Path of Exile Screen"],
      "the strip's arrow, help, and the record button (no stop button before sharing)");
    const record = $("[data-live-watch]");
    t.ok(record.closest(".head-actions") && $(".record-dot", record) && !record.textContent.trim() && !$(".dialog-foot", liveDialog())
      && record.getBoundingClientRect().width === $("button.help", liveDialog()).getBoundingClientRect().width,
      "the record button: a red dot in a circle, after help in the title bar, the help button's size; no footer");
    // The help circle's outer edge (centre 10, radius plus half its line, of 20 units) on the title's baseline.
    const helpCircle = $("button.help circle", liveDialog()), helpSvg = $("button.help svg", liveDialog()).getBoundingClientRect();
    const title = $("h2", liveDialog()), base = Object.assign(w.document.createElement("span"), { style: "display: inline-block; width: 0; height: 0" });
    title.append(base);
    const edge = (10 + parseFloat(helpCircle.getAttribute("r")) + parseFloat(helpCircle.getAttribute("stroke-width")) / 2) / 20;
    const [baseline, bottom] = [base.getBoundingClientRect().bottom, helpSvg.top + edge * helpSvg.height];
    base.remove();
    t.ok(Math.abs(bottom - baseline) <= 1, "the help circle's bottom on the title's baseline", `${bottom} / ${baseline}`);
    const light = $("[data-live-tab] .rec-light", liveDialog());
    t.ok(light && !light.classList.contains("on") && !light.classList.contains("lost"), "not sharing yet: the strip's light is dim");
    t.ok($(".preview-wait", liveDialog()), "preview stand-in");
    $("[data-panel-help]").click();
    await waitFor(() => $(".import-steps"));
    t.eq([$$(".import-steps li").length, $("[data-panel-help]").getAttribute("aria-pressed")], [5, "true"], "help shows the 5 steps");
    $("[data-panel-help]").click();
    await waitFor(() => !$(".import-steps"));
    t.ok(!$(".import-steps"), "help again hides them");
    await click($$("nav a").find((a) => a.textContent === "Trade Volumes"));
    t.eq([!!liveDialog(), w.location.hash], [true, "#/trade-volumes"], "a nav link goes to its page and leaves it open");
    await click($("#live-import"));
    t.ok(!liveDialog() && $("#live-dialog.collapsed"), "Import Market Ratios again hides it to its strip");
  } },

  // Frames are read in a worker (js/reader.js): a read of the largest test frame (about 0.4 s) doesn't hold up the page.
  // Left out on CI (.github/workflows/tests.yml), where the runners' pauses don't come from the page.
  importOffPage: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    let last = performance.now(), longest = 0;
    const tick = w.setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; }, 10);
    const r = await importFrom("/tests/snips/size-full.png", /Imported prices/);
    w.clearInterval(tick);
    t.ok(/Imported prices/.test(r.status), "the frame imports", r.status);
    t.ok(longest < 150, "the page never waits on the read (longest pause under 150 ms)", `${Math.round(longest)} ms`);
  } },

  // The reader and its helper (js/reader.js) split a frame between them: the lists and names as one read gives them, the
  // `?debug` nearest names for both boxes, and a second read of the same frame confirmed from its crops. Name boxes
  // read before read as they did, and other names in them as themselves.
  readerHelper: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    const catalog = await (await fetch("/data/catalog.json")).json();
    const worker = new Worker(new URL("../../html/js/reader.js", import.meta.url), { type: "module" });
    const answer = () => new Promise((done) => { worker.onmessage = ({ data }) => done(data); });
    try {
      let got = answer();
      worker.postMessage({ names: [...new Set(Object.values(catalog).map((c) => c.name))] });
      t.ok((await got).ready, "it starts");
      const img = new Image();
      img.src = "/tests/snips/size-full.png";
      await img.decode();
      const read = async (msg, from = img) => { const a = answer(), bitmap = await createImageBitmap(from); worker.postMessage({ id: 1, bitmap, style: "poe1", last: null, ...msg }, [bitmap]); return a; };
      const r = await read({ crops: null, debug: true });
      t.eq([r.found.available?.length, r.found.competing?.length, r.names], [5, 5, ["Chaos Orb", "Divine Orb"]], "both lists and both names");
      t.ok(r.ranks?.length === 2 && r.ranks.every((s) => /^Chaos Orb|^Divine Orb/.test(s)), "nearest names for both boxes", JSON.stringify(r.ranks));
      t.ok(r.crops, "the reading keeps its crops");
      t.ok((await read({ crops: r.crops, debug: false })).same, "the same frame again is confirmed from them");
      const again = await read({ crops: null, debug: false });
      t.eq([again.found.available?.map((x) => x.text), again.names], [r.found.available?.map((x) => x.text), r.names], "and a read after that reads as the first");
      const other = new Image();
      other.src = "/tests/snips/sulphur-millions-window.png";
      await other.decode();
      t.eq((await read({ crops: null, debug: false }, other)).names, ["Divine Orb", "Dead Man's Sulphur"], "another pair reads as its own names");
      t.eq((await read({ crops: null, debug: true })).ranks, r.ranks, "and the first again as before, nearest names too");
    } finally {
      worker.terminate();
    }
  } },

  // Each list read is saved as its row's orders, with the price it gives: the row's stock and its list's first stock
  // are one reading, whichever list (a pair's Available, or the reverse pair's Competing) read the row last.
  importLists: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    const r = await importFrom("/tests/snips/size-full.png", /Imported prices/);
    t.ok(/Imported prices/.test(r.status), "the frame imports", r.status);
    const lg = saved(STORAGE.poe1).leagues[LEAGUE.poe1];
    for (const key of [`${D}>${C}`, `${C}>${D}`]) {
      const list = lg.lists?.[key], ratio = lg.ratios[key];
      t.eq([list?.levels[0].ratio, list?.levels[0].stock, list?.levels.length], [ratio.value, ratio.stock, 5], `${key}: its list starts at its price and stock`);
      t.ok(Math.abs(list.at - ratio.verifiedAt) < 1000, `${key}: read with it`);
    }
  } },

  importCancel: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    const r = await importFrom(null, /Sharing was cancelled/);
    t.eq(r.status, "Sharing was cancelled.", "refused share: status");
    t.ok($("[data-live-watch]", $("#live-dialog")) && !liveDialog(), "the record button is back, the window hidden to its strip");
  } },

  // The import window stays shown, sharing or not, through clicks on the page, other pages and a price window over it,
  // until its arrow (or Import Market Ratios) hides it; Esc doesn't; its stop button stops the share and hides it.
  importStays: { game: "poe1", seed: "fresh", hash: "#/trade-recommendations", async run(t) {
    await ready();
    await click($("#live-import"));
    $("#main").click();
    $("#start-amount").focus();
    $("#start-amount").click();
    await sleep(300);
    t.eq([!!liveDialog(), w.document.activeElement?.id], [true, "start-amount"], "not sharing: clicks on the page leave it open, the box keeps the focus");
    const r = await importFrom("/tests/snips/size-5.png", /Imported prices/);
    const sharing = () => r.stream()?.getVideoTracks().every((x) => x.readyState === "live");
    t.ok(!liveDialog(), "sharing hides it to its strip");
    await click($("#live-import"));
    t.eq([!!liveDialog(), $$("#live-dialog").length, text($(".live-status"))], [true, 1, "Imported prices for Chaos Orb and Divine Orb."], "Import Market Ratios shows it, as it was");
    for (const label of ["Trade Volumes", "Market Ratios"]) {
      await click($$("nav a").find((a) => a.textContent === label));
      await sleep(300);
      t.ok(liveDialog() && sharing(), `${label}: still shown and sharing`);
    }
    await go(`#/item/${CHROM}/competitive`);
    docked(t);
    $("table.steps tbody button.ratio-link[data-pair]", routes()[0]).click();
    const d = await waitFor(dialog);
    t.ok(d?.matches(":modal") && liveDialog(), "a price window opens over it, modal");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(200);
    t.ok(liveDialog(), "Esc with a price window open doesn't close the import window");
    $("#dialog-close").click();
    await waitFor(() => !dialog());
    t.ok(!dialog() && liveDialog() && sharing(), "the price window closes, the import window stays and still shares");
    const hidden = () => $("#live-dialog").classList.contains("collapsed");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(200);
    t.ok(!hidden() && sharing(), "Esc leaves it as it is (Esc cancels other things)");
    $("#live-stop rect").dispatchEvent(new w.MouseEvent("click", { bubbles: true })); // as a real click on its icon lands
    t.ok(await waitFor(() => hidden()), "its stop button, clicked on its icon, hides it");
    t.ok(await waitFor(() => !sharing()), "and stops sharing");
  } },

  // A step in progress: its Ratio has the age of its pair's latest scan, as every step's has; a scan of the pair after it was
  // posted brings it back to "<1m", and its wait in Fill Time has no tag.
  listingRead: { game: "poe1", seed: "fresh", hash: `#/item/${D}/competitive`, async run(t) {
    await ready();
    await click($("[data-add-listing]", routes()[0]));
    await go("#/my-listings");
    const row = () => $$("#main div.listing table.steps tbody tr")[0], cell = (i) => $$("td", row())[i];
    await click($("[data-listing-play]"));
    const scanAt = () => Number($(".tag[data-scan-at]", cell(3))?.dataset.scanAt);
    const before = scanAt();
    t.ok(before > 0 && cellTags(cell(4)).length === 0, "the age of its pair's scan beside its Ratio, none in Fill Time");
    const [ratioThen, wantThen] = [text($("button.ratio-link", cell(3))), numbers(text(cell(1)))[0]];
    await sleep(1100); // the read is after the post
    await importFrom("/tests/snips/size-5.png", /Imported prices/);
    t.eq([cellTags(cell(3)), cellTags(cell(4)), scanAt() > before], [["<1m"], [], true], "a scan of its pair: that scan's age beside its Ratio");
    t.eq([text($("button.ratio-link", cell(3))), numbers(text(cell(1)))[0]], [ratioThen, wantThen], "its ratio and Want stay as posted: scans don't change them");
    $("#live-stop").click();
    await waitFor(() => !liveDialog());
  } },
  importPoe1: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    const r = await importFrom("/tests/snips/size-5.png", /Imported prices/);
    t.eq(r.status, "Imported prices for Chaos Orb and Divine Orb.", "reads the shared window");
    const win = () => $("#live-dialog");
    t.ok($(".live-status", win()).getBoundingClientRect().height <= 1, "the status not shown: nothing's wrong");
    // Watching hides the window to its strip at the right edge (it read all the same), its light pulsing; the strip's
    // arrow shows it, with the preview, and hides it again.
    const tab = () => $("[data-live-tab]", win()), light = () => $(".rec-light", tab());
    const edge = w.document.documentElement.clientWidth, shown = () => win().querySelector(".live-window").getBoundingClientRect();
    await waitFor(() => shown().left >= edge - 2);
    t.ok(shown().left >= edge - 2 && Math.abs(tab().getBoundingClientRect().right - edge) <= 2 && tab().getAttribute("aria-expanded") === "false",
      "watching: hidden to its strip, against the right edge", `${shown().left} / ${edge}`);
    t.eq([light().classList.contains("on"), w.getComputedStyle(light()).animationName], [true, "rec-pulse"], "its light pulses");
    t.eq(text(tab()), "‹", "the strip's arrow points left, to show it");
    tab().click();
    await waitFor(() => shown().right <= edge - 10);
    const slot = $(".live-preview-slot", win());
    t.ok(shown().right <= edge - 10 && $("video", slot) && slot.getBoundingClientRect().height > 50, "the arrow shows it, with the preview");
    t.eq(text(tab()), "›", "its arrow points right now, to hide it");
    tab().click();
    t.ok(await waitFor(() => shown().left >= edge - 2), "and hides it again");
    $("#live-import").click();
    t.ok(await waitFor(() => shown().right <= edge - 10), "Import Market Ratios shows it too");
    // While it shares: help, then the stop button, its icon the help button's size, grey like it (red under the mouse).
    t.eq($$(".head-actions button", win()).map((b) => b.title), ["How it works", "Stop"], "help, then the stop button");
    const [helpIcon, stopIcon] = [$("button.help svg", win()), $("#live-stop svg")];
    t.ok(helpIcon.getBoundingClientRect().width === stopIcon.getBoundingClientRect().width
      && w.getComputedStyle($("#live-stop")).color === w.getComputedStyle($("button.help", win())).color
      && parseFloat($("#live-stop circle").getAttribute("stroke-width")) > parseFloat($("button.help circle", win()).getAttribute("stroke-width")),
      "the stop button: a square in a circle, the help button's size and grey, its line thicker");
    const ratios = saved(STORAGE.poe1).leagues[LEAGUE.poe1].ratios;
    t.eq(Object.keys(ratios).sort(), [`${C}>${D}`, `${D}>${C}`].sort(), "both ways saved");
    t.eq([ratios[`${D}>${C}`].stock, ratios[`${C}>${D}`].stock], [4784, 111], "each with the stock at its best price");
    t.eq($$("#main tbody[data-row] .group-head").map(text), ["Chaos ↔ Divine"], "page behind shows it");
    $("#live-stop").click();
    t.ok(await waitFor(() => !liveDialog() && win().classList.contains("collapsed")), "the stop button hides the window to its strip");
    t.ok(await waitFor(() => r.stream()?.getVideoTracks().every((x) => x.readyState === "ended")), "and stops sharing");
    t.ok(!$("#live-stop") && $("[data-live-watch]", win()), "no stop button now, the record button back");
  } },

  importPoe2: { game: "poe2", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    const r = await importFrom("/tests/snips/poe2-exalted-2152x1243.png", /Imported prices/);
    t.eq(r.share, "Share Path of Exile 2 Screen", "PoE2's share button");
    t.eq(r.status, "Imported prices for Exalted Orb and Chaos Orb.", "reads the shared PoE2 window");
    const ratios = saved("rainofchaos:poe2:v1").leagues[LEAGUE.poe2].ratios;
    t.eq(Object.keys(ratios).sort(), [`${E}>${C}`, `${C}>${E}`].sort(), "both ways saved");
  } },

  // Chaos:Vivid read with no competing trades: Vivid is still listed, its routes that sell Vivid for Chaos are Untradeable
  // for it, and the rest are priced.
  tradesNoCompeting: { game: "poe1", seed: "noCompeting", hash: "#/trade-recommendations", async run(t) {
    await ready();
    const sections = await openSections();
    t.ok(Object.values(sections).flat().some((k) => k.startsWith(`${VIVID}|`)), "Vivid still listed");
    const vivid = (list) => list.filter((k) => k.startsWith(VIVID));
    t.eq(vivid(sections.untradeable ?? []), [], "nobody else selling Vivid for Chaos: its routes are priced all the same");
    await go(`#/item/${VIVID}/competitive`);
    const direct = routes().find((r) => r.dataset.row === "direct");
    const sell = $$("table.steps tbody tr", direct).find((tr) => /\b1 Chaos Orb: 8\.33 Vivid/.test(text(tr)));
    t.ok(sell && !$(".tag.warn", sell), "selling it posts the only order, at the pair's usual price (0.12 Chaos a Vivid), with nothing wrong",
      text($("table.steps", direct)));
    t.ok(!/no competing trades/.test(text(direct)), "and no tag saying nobody else is posting");
    await go("#/market-ratios/available");
    t.eq($$("#main td.r-none").map(text), ["no trades"], "Market Ratios' Instant tab shows the box as no trades");
  } },

  // One list read: Available alone with no banners (no Competing trades), or Competing moved up under the game's "no
  // available trades" message. Seen from Alchemy Shard ↔ Chaos, both leave Competing Trades unread.
  importNoCompeting: { game: "poe1", seed: "shard", hash: "#/market-ratios", async run(t, seed) {
    await oneList(t, seed, "/tests/snips/size-small-no-competing.png", "Alchemy Shard and Chaos Orb");
    t.ok(saved(STORAGE.poe1).leagues[LEAGUE.poe1].lists?.[`${C}>${SHARD}`], "Available's list saved");
  } },

  importNoAvailable: { game: "poe1", seed: "shard", hash: "#/market-ratios", async run(t, seed) {
    await oneList(t, seed, "/tests/snips/size-small-no-available.png", "Chaos Orb and Alchemy Shard");
  } },

  // Available alone with no banners is also a hover without Alt: it isn't imported until it has shown for 3 seconds, so
  // holding Alt in that time imports both lists at once.
  importOneListWaits: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    const r = await importFrom(await withoutAlt("/tests/snips/size-5.png"), /Waiting for price info/);
    await sleep(1500);
    t.eq([text($(".live-status")), saved(STORAGE.poe1).leagues?.[LEAGUE.poe1]?.ratios ?? {}], ["Waiting for price info.", {}], "Available alone: not imported at once");
    await r.stream().show("/tests/snips/size-5.png");
    t.ok(await waitFor(() => /Imported prices/.test(text($(".live-status"))), 20000), "Alt held: imported");
    t.eq(text($(".live-status")), "Imported prices for Chaos Orb and Divine Orb.", "with both lists");
    t.eq(Object.keys(saved(STORAGE.poe1).leagues[LEAGUE.poe1].ratios).sort(), [`${C}>${D}`, `${D}>${C}`].sort(), "both ways saved");
  } },

  // Alt held with the cursor over Competing, then moved off it: the window looks the same but for the cursor, and it's
  // read again and imported.
  importCursorMoves: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    const r = await importFrom(await cursorOver("/tests/snips/size-5.png"), /Waiting for price info/);
    await sleep(1500);
    t.eq([text($(".live-status")), saved(STORAGE.poe1).leagues?.[LEAGUE.poe1]?.ratios ?? {}], ["Waiting for price info.", {}], "cursor over Competing: not imported");
    await r.stream().show("/tests/snips/size-5.png");
    t.ok(await waitFor(() => /Imported prices/.test(text($(".live-status"))), 5000), "cursor moved off: imported");
    t.eq(text($(".live-status")), "Imported prices for Chaos Orb and Divine Orb.", "with both lists");
  } },

  // Both prices scanned (still in use), then the pair left showing without Alt (Alt let go): Available is read again,
  // and Competing's price stays.
  importAltLetGo: { game: "poe1", seed: "gap", hash: "#/market-ratios", async run(t, seed) {
    await ready();
    const r = await importFrom(await withoutAlt("/tests/snips/size-5.png"), /Imported prices/);
    t.eq(r.status, "Imported prices for Chaos Orb and Divine Orb (no competing trades).", "Available alone, left showing: imported");
    const { ratios } = saved(STORAGE.poe1).leagues[LEAGUE.poe1], was = seed.leagues[seed.league].ratios;
    t.eq(ratios[`${C}>${D}`], was[`${C}>${D}`], "Competing's price kept as it was");
    t.ok(ratios[`${D}>${C}`].verifiedAt > was[`${D}>${C}`].verifiedAt, "Available's read again");
  } },
  // The same with both read over 4 hours ago (no longer used): the Competing price is saved as none.
  importAltOld: { game: "poe1", seed: "gapOld", hash: "#/market-ratios", async run(t) {
    await ready();
    await importFrom(await withoutAlt("/tests/snips/size-5.png"), /Imported prices/);
    const none = saved(STORAGE.poe1).leagues[LEAGUE.poe1].ratios[`${C}>${D}`];
    t.eq([none.value, none.empty], [null, true], "Competing saved with no trades");
  } },

  // Left showing, Available alone is imported; Alt held then imports both lists at once, not 10 seconds later.
  importOneListThenAlt: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    const r = await importFrom(await withoutAlt("/tests/snips/size-5.png"), /Imported prices/);
    t.eq(r.status, "Imported prices for Chaos Orb and Divine Orb (no competing trades).", "Available alone, left showing: imported");
    const one = saved(STORAGE.poe1).leagues[LEAGUE.poe1].ratios;
    t.eq([Object.keys(one).sort(), one[`${C}>${D}`].empty], [[`${C}>${D}`, `${D}>${C}`].sort(), true], "Available's side saved, Competing's as none");
    const at = Date.now();
    await r.stream().show("/tests/snips/size-5.png");
    t.ok(await waitFor(() => text($(".live-status")) === "Imported prices for Chaos Orb and Divine Orb.", 20000), "then both lists: imported");
    t.ok(Date.now() - at < 5000, "without waiting out the 10 seconds", `${Date.now() - at} ms`);
    t.eq(Object.keys(saved(STORAGE.poe1).leagues[LEAGUE.poe1].ratios).sort(), [`${C}>${D}`, `${D}>${C}`].sort(), "both ways saved");
  } },

  // The same prices left showing aren't imported again; shown again after the box has gone (another hover), they are.
  importShownAgain: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    const r = await importFrom("/tests/snips/size-5.png", /Imported prices/);
    const at = () => saved(STORAGE.poe1).leagues[LEAGUE.poe1].ratios[`${D}>${C}`].verifiedAt, first = at();
    await sleep(11500);
    t.eq(at(), first, "left showing past the 10 seconds: not imported again");
    await r.stream().show("/tests/snips/ratio-field-window.png");
    await sleep(1500);
    await r.stream().show("/tests/snips/size-5.png");
    t.ok(await waitFor(() => at() > first, 5000), "shown again after the box went: imported again");
  } },

  // Lists without the game's window (no title-bar buttons in sight) aren't read: the status says it can't see the window,
  // and nothing's imported until it shows.
  importNoWindow: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    const r = await importFrom("/tests/snips/moved-window.png", /Can't see/);
    t.eq(r.status, "Can't see the Currency Exchange window.", "status");
    await sleep(3000);
    t.eq([text($(".live-status")), saved(STORAGE.poe1).leagues?.[LEAGUE.poe1]?.ratios ?? {}], ["Can't see the Currency Exchange window.", {}], "nothing imported");
    t.ok($(".live-status-error", $("#live-dialog"))?.getBoundingClientRect().height > 1, "that status shown, as an error");
    t.ok($("[data-live-tab] .rec-light", $("#live-dialog"))?.classList.contains("lost"), "and the strip's light stays solid red, not pulsing");
    await r.stream().show("/tests/snips/size-5.png");
    t.ok(await waitFor(() => /Imported prices/.test(text($(".live-status"))), 20000), "the window shown: imported");
  } },

  // Chaos ↔ Divine's latest hour thin and far off (1,600 chaos a div, against the capture's 368 and the recent hours' and
  // days' 375): the reading is within 3x of those, so it's imported.
  importThinHour: { game: "poe1", seed: "empty", hash: "#/market-ratios",
    rates: (json) => pairWith(json, { volA: 1600000, volB: 1000 }), async run(t) {
    await ready();
    const r = await importFrom("/tests/snips/size-5.png", /Imported prices/);
    t.eq(r.status, "Imported prices for Chaos Orb and Divine Orb.", "imported");
  } },
  // Every window far off (1,600 chaos a div in the latest hour, the recent hours and the days): not imported.
  importAllFar: { game: "poe1", seed: "empty", hash: "#/market-ratios",
    rates: (json) => pairWith(json, { volA: 1600000, volB: 1000, recentA: 6400000, recentB: 4000, dayA: 38400000, dayB: 24000 }), async run(t) {
    await ready();
    await importFrom("/tests/snips/size-5.png", /Waiting for price info/);
    await sleep(4000);
    t.eq([text($(".live-status")), saved(STORAGE.poe1).leagues?.[LEAGUE.poe1]?.ratios ?? {}], ["Waiting for price info.", {}], "not imported");
  } },

  // One list's price over 3x off the pair's last price (no hourly average here): not imported.
  importOneListFar: { game: "poe1", seed: "shardFar", hash: "#/market-ratios", async run(t, seed) {
    await ready();
    await importFrom("/tests/snips/size-small-no-available.png", /Waiting for price info/);
    await sleep(4000);
    t.eq([text($(".live-status")), saved(STORAGE.poe1).leagues[LEAGUE.poe1].ratios], ["Waiting for price info.", seed.leagues[seed.league].ratios], "not imported");
  } },

  // Gold fees come from the game's data (SPEC.md §1): shown, never edited.
  gold: { game: "poe1", seed: "fresh", hash: `#/item/${CHROM}/competitive`, async run(t) {
    await ready();
    const steps = $("table.steps", routes()[0]);
    t.ok($$("td.gold", steps).length && !$("td.gold button", steps), "steps' gold amounts are plain text");
    t.eq([...$$("thead th", steps)].find((th) => text(th) === "Gold Cost")?.querySelector("button") ?? null, null, "the Gold Cost header opens nothing");
    t.ok(!$("[data-gold-edit], input[data-gold]"), "no gold fee editor anywhere");
  } },

  tradesPoe2: { game: "poe2", seed: "poe2", hash: "#/trade-recommendations", async run(t) {
    await ready();
    t.eq($$(".base-toggle button").map((b) => [b.title, b.classList.contains("active")]),
      [["Exalted", true], ["Divine", false]], "start with Exalted or Divine, not Chaos");
    const sections = await openSections();
    t.eq(Object.values(sections).flat().sort(), [
      `${ANNUL}|after:${D}`, `${ANNUL}|before:${D}`, `${ANNUL}|direct`, `${C}|after:${D}`, `${C}|before:${D}`, `${C}|direct`, `${D}|direct`,
    ].sort(), "hubs Exalted and Divine: Annulment's and Chaos Orb's three routes, Divine Orb's direct one");
    // Exalted → Chaos → Divine → Exalted keeps 10 Chaos, an item here: the profit lists the hubs first, the item last.
    const cell = tradeRow(C, `after:${D}`).cells[COL.profit];
    t.eq([titles(cell), numbers(cell.textContent)], [["Exalted Orb", "Chaos Orb"], [604, 10]], "profit: the hubs first, then the item");
  } },

  poe2SavedChaos: { game: "poe2", seed: "poe2Chaos", hash: "#/trade-recommendations", async run(t) {
    await ready();
    t.eq($$(".base-toggle button").map((b) => [b.title, b.classList.contains("active")]),
      [["Exalted", true], ["Divine", false]], "a saved Chaos start falls back to Exalted");
  } },

  clipboard: { game: "poe1", seed: "fresh", hash: `#/item/${CHROM}/competitive`, async run(t) {
    await ready();
    const written = [];
    const spy = (s) => { written.push(s); return w.Promise.resolve(); };
    if (w.navigator.clipboard) w.navigator.clipboard.writeText = spy;
    else Object.defineProperty(w.navigator, "clipboard", { value: { writeText: spy } });
    const amount = $("table.steps tbody b.copy", routes()[0]);
    t.eq(amount?.textContent.trim(), "2,941", "best route's first Want amount");
    amount.click();
    t.ok(await waitFor(() => amount.classList.contains("copied")), "a copy flashes its highlight");
    t.eq(written, ["2941"], "copies the whole number, no separators");
    t.ok(await waitFor(() => !amount.classList.contains("copied"), 2000), "the highlight goes again");
  } },

  scanSound: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t) {
    await ready();
    const starts = recordSound();
    const r = await importFrom("/tests/snips/size-3.png", /Imported prices/);
    t.eq(r.status, "Imported prices for Chaos Orb and Divine Orb.", "imports the pair");
    t.eq(gaps(starts), [0, 0.09], "new prices: a double click, 90 ms apart");
    // Another frame of the pair with the same best prices but other stock: filled in once the 10 s hold is up, quietly.
    const book = () => JSON.stringify(saved(STORAGE.poe1).leagues[LEAGUE.poe1].lists[`${D}>${C}`].levels);
    const before = book();
    await r.stream().show("/tests/snips/size-2.png");
    t.ok(await waitFor(() => book() !== before, 20000), "same prices, new stock: filled in");
    t.eq(gaps(starts), [0, 0.09], "same prices, new stock: no sound");
  } },

  gameSwitch: { game: "poe1", seed: "empty", hash: "#/trade-recommendations", async run(t, seed, page) {
    await ready();
    for (const [from, to] of [["poe1", "poe2"], ["poe2", "poe1"]]) {
      const select = $("#game");
      select.value = to;
      select.dispatchEvent(new w.Event("change"));
      await page.follow(`/${to}`);
      await ready();
      t.eq([w.location.pathname, w.location.hash, $("#game").value], [`/${to}`, "#/home", to], `${from} to ${to}: that game's home page`);
      t.eq(w.localStorage.getItem("rainofchaos:game"), to, `${from} to ${to}: remembered for /`);
    }
  } },

  rootRedirect: { game: "poe1", seed: "empty", hash: "#/home", async run(t, seed, page) {
    for (const [last, to] of [["poe2", "poe2"], ["poe1", "poe1"], [null, "poe1"]]) {
      if (last) w.localStorage.setItem("rainofchaos:game", last);
      else w.localStorage.removeItem("rainofchaos:game");
      await page.open("/", `/${to}`);
      await waitFor(() => w.location.hash === "#/home");
      t.eq([w.location.pathname, w.location.hash], [`/${to}`, "#/home"], `/ with ${last ?? "no game"} last: ${to}'s home page`);
    }
  } },

  // ?debug: nothing on screen; the log downloads when watching stops.
  importDebug: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t, seed, page) {
    await page.open("/poe1?debug#/market-ratios", "/poe1");
    await ready();
    const files = catchDownloads();
    const r = await importFrom("/tests/snips/size-5.png", /Imported prices/);
    // A second read, once the video has been timed: its line says what the video was doing. A new frame is read within
    // a second (looks are 0.1 s apart); the log, below, shows it was.
    await r.stream().show("/tests/snips/size-2.png");
    await sleep(2000);
    // No hover box: the window's ratio field reads as an unread row, which isn't trouble.
    await r.stream().show("/tests/snips/ratio-field-window.png");
    await sleep(2000);
    t.ok(!$(".live-debug") && !$("[data-live-save-frame]"), "nothing of debug's on screen: no reads count, no Save frame");
    $("#live-stop").click();
    const log = await waitFor(() => files.find((f) => f.name.startsWith("rainofchaos-debug-")));
    const text = log ? await log.text : "";
    t.ok(/reads \(newest last\):\n.*live: imported Chaos Orb \/ Divine Orb/s.test(text), "the log downloads when watching stops", text.slice(0, 200));
    t.ok((text.split("reads (newest last):\n")[1] ?? "").trim().split("\n").length >= 2, "with the second read", text.slice(text.indexOf("reads (newest last)")));
    t.ok(/each minute of watching \(from 0\):\n0: \d+ reads, median \d+ ms \(draw \d+, copy \d+, grey \d+, find \d+\)/.test(text),
      "it sums up each minute's reads and their parts", text.slice(0, 600));
    t.ok(/\n0: [^\n]*; \d+ looks, at most \d+ ms apart; video at most \d+ ms without a new frame; biggest change not read \d+\.\d%\n/.test(text),
      "and its looks: the longest waits and the biggest change too small to read", text.slice(0, 800));
    t.ok(/\nwaits of a second or more \(newest last\): /.test(text), "waits of a second or more get their own list", text.slice(0, 1000));
    t.ok(/reads \(newest last\):\n[^\n]*\(\d+ ms: draw \d+, copy \d+, grey \d+, find \d+\)/.test(text), "each read gives its parts' times",
      text.slice(text.indexOf("reads (newest last)"), text.indexOf("reads (newest last)") + 300));
    t.ok(/; video \d+\.\d fps, newest frame \d+ ms old[^\n]*\n?$/.test(text.trim()),
      "the newest read says what the video was doing", text.slice(text.indexOf("reads (newest last)")));
    t.ok(/\nframes saved: [^\n]*-last\.png/.test(text) && !/\nframes saved: [^\n]*-trouble\.png/.test(text),
      "a frame with no hover box isn't saved as trouble", (text.match(/\nframes saved: [^\n]*/) ?? [""])[0]);
    const served = await (await fetch("/version.json", { cache: "no-store" })).json();
    t.eq(text.split("\n")[1], `version ${served.version} (${served.commit})`, "its second line names the site's version and commit");
  } },

  // The read history (SPEC.md §7): each list read is added to it, and ?debug saves it as JSON when watching ends, with the
  // site's version, how long it's kept and the undercutting's constants.
  readHistory: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t, seed, page) {
    await clearReads(LEAGUE.poe1);
    await page.open("/poe1?debug#/market-ratios", "/poe1");
    await ready();
    const files = catchDownloads();
    await importFrom("/tests/snips/size-5.png", /Imported prices/);
    const { lists } = saved(STORAGE.poe1).leagues[LEAGUE.poe1];
    const keys = Object.keys(lists).sort();
    const reads = await waitFor(async () => { const r = await historyOf(LEAGUE.poe1); return keys.every((k) => r.some((x) => x.key === k)) && r; });
    t.ok(reads && keys.length === 2, "each row's list read is in the history", JSON.stringify(reads));
    for (const key of keys) {
      const last = (reads || []).filter((r) => r.key === key).at(-1);
      t.eq(last && [last.at, last.levels, last.rest], [lists[key].at, lists[key].levels, lists[key].rest], `${key}: its newest record is the list saved`);
    }
    t.ok(!$("[data-live-download-reads]"), "no Download reads button");
    $("#live-stop").click(); // watching ends: the reads download with the log
    const file = await waitFor(() => files.find((f) => /^rainofchaos-reads-\d+\.json$/.test(f.name)));
    const log = files.find((f) => f.name.startsWith("rainofchaos-debug-"));
    t.ok(file && log && file.name.match(/\d+/)[0] === log.name.match(/\d+/)[0], "the reads download when watching ends, stamped as the log", files.map((f) => f.name).join(", "));
    const data = file ? JSON.parse(await file.text) : {};
    const served = await (await fetch("/version.json", { cache: "no-store" })).json();
    t.eq([data.game, data.version], ["poe1", served], "the reads: the game and the site's version");
    t.eq([data.constants?.READS_FOR, data.constants?.HISTORY_FOR, data.constants?.UNDERCUT_FLOOR, data.constants?.SIDE_SHARE], [3600000, HISTORY_FOR, 0.5, 0.25],
      "how long it's kept and the fill time's constants");
    t.eq(data.listings, saved(STORAGE.poe1).listings ?? [], "the listings");
    t.eq(data.reads?.filter((r) => r.league === LEAGUE.poe1), reads || [], "and every record");
  } },

  // Records older than HISTORY_FOR go when the page is opened.
  readHistoryPruned: { game: "poe1", seed: "empty", hash: "#/home", async run(t, seed, page) {
    await pagePruned(); // the page's own pruning, as it loaded, is done before the records go in
    await clearReads(LEAGUE.poe1);
    const now = Date.now(), levels = [{ ratio: [380, 1], stock: 5 }];
    await addRead(LEAGUE.poe1, `${C}>${D}`, levels, null, now - HISTORY_FOR - 60000);
    await addRead(LEAGUE.poe1, `${C}>${D}`, levels, null, now - HISTORY_FOR + 60000);
    t.eq((await historyOf(LEAGUE.poe1)).length, 2, "both records added");
    await page.open("/poe1#/home", "/poe1");
    await waitFor(async () => (await historyOf(LEAGUE.poe1)).length === 1);
    t.eq((await historyOf(LEAGUE.poe1)).map((r) => r.at), [now - HISTORY_FOR + 60000], "the older one is gone on load, the other kept");
  } },

  // A scan over 4 hours old is forgotten when the page is drawn; its read history stays.
  readHistoryKept: { game: "poe1", seed: "stale", hash: "#/home", async run(t, seed) {
    await ready();
    await clearReads(LEAGUE.poe1);
    await addRead(LEAGUE.poe1, STALE_KEY, [{ ratio: [1, 3.4], stock: 5 }], null, Date.now() - 5 * 3600000);
    await go("#/market-ratios");
    const left = Object.keys(saved(STORAGE.poe1).leagues[LEAGUE.poe1].ratios);
    t.eq([left.includes(STALE_KEY), left.length], [false, Object.keys(seed.leagues[LEAGUE.poe1].ratios).length - 1], "only the old price is gone");
    t.eq((await historyOf(LEAGUE.poe1)).length, 1, "and the read history is kept");
    await clearReads(LEAGUE.poe1);
  } },

  dockedTopLevel: { game: "poe1", seed: "empty", hash: "#/market-ratios", async run(t, seed, page) {
    await page.popup("/poe1#/market-ratios", "/poe1");
    await ready();
    t.ok(w.top === w, "app in a top-level window");
    await click($("#live-import"));
    docked(t);
  } },
};

// Trade Volumes: its columns (each hub's "[icon] / hr"), sorted by Currency / hr, most first; each total is the currency's own
// count, and each hub column how many of that hub traded with it, as in the fixture, with no icon.
async function volumesCheck(t, game, hubs) {
  await ready();
  t.eq($$("table.volumes thead th").map((th) => th.textContent.trim()),
    ["Currency", "Currency / hr ▼", ...hubs.flatMap(() => ["/ hr", ""])], "columns (each hub's scan ages unheaded), sorted by Currency / hr");
  const hubHeads = $$("table.volumes thead th:not(.age)").slice(2);
  t.eq(hubHeads.map((th) => titles(th)), hubs.map((h) => [NAMES[h]]), "each hub's column headed by its icon");
  t.ok(hubHeads.every((th, i) => $$("table.volumes tbody tr").every((tr) => !$(".icon", tr.querySelectorAll("td.num")[i + 1]))),
    "no icons in the hubs' counts");
  const pairs = Object.values((await fixture(game)).leagues[LEAGUE[game]].pairs);
  const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];
  const count = (id, other) => pairs.reduce((n, p) => n + (p.a === id && p.b === other ? p.volA : p.b === id && p.a === other ? p.volB : 0), 0);
  const want = ids.map((id) => [id, hubs.reduce((n, h) => n + count(id, h), 0), ...hubs.map((h) => (h === id ? null : count(h, id)))])
    .sort((x, y) => y[1] - x[1]);
  const got = $$("table.volumes tbody tr").map((tr) => [$("a", tr).getAttribute("href").split("/")[2],
    ...[...tr.cells].slice(1).filter((td) => !td.classList.contains("age")).map((td) => numbers(td.textContent)[0] ?? null)]);
  t.eq(got, want, "rows: totals and hub counts from the fixture, most first");
}
