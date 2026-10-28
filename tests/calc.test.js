// Runs in the browser (tests/index.html) or headless with macOS's JavaScriptCore:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/calc.test.js
import { allResults, leg, lot, MANUAL, MAX_ORDER, roundHalfUp, routesFor, runRoute, setAhead, setBooks, setBought, setNoOrders, setPerHour, setReadEmpty, setStock, setUndercut, setUsual, SLOW, FAST, stepKey } from "../html/js/calc.js";
import { CHAOS, DIVINE, EXALTED, rowKey, setCurrencies, setGold } from "../html/js/items.js";
import { boughtRate, undercutRate } from "../html/js/undercut.js";

// Gold fees as in data/gold.json for the fixture currencies.
setGold({ [CHAOS]: 15, [DIVINE]: 250, HarvestSeedGreen: 0.125, CurrencyRerollSocketColours: 20, CurrencyDeepwater: 0.001 });

// jsc has print(); browsers use console.log (window.print would open the print dialog).
const log = !globalThis.document && typeof globalThis.print === "function" ? globalThis.print : console.log;
let failed = 0;
function eq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

// --- lots (SPEC.md §2.2) ---
eq(roundHalfUp(3.125, 2), 3.13, "round half up 3.125");
eq(roundHalfUp(2.675, 2), 2.68, "round half up 2.675");
eq(lot([2.75, 1]), [11, 4], "lot 2.75:1");
eq(lot([1, 2.75]), [4, 11], "lot 1:2.75");
eq(lot([1, 8.27]), [11, 91], "lot 1:8.27");
eq(lot([3.13, 1]), [25, 8], "lot 3.13:1");
eq(lot([380, 1]), [380, 1], "lot 380:1");
eq(lot([1, 90.1]), [10, 901], "lot 1:90.1");
eq(lot([0, 1]), null, "lot rejects zero");

// --- fixtures, Starting Divine 25 (SPEC.md §8) ---
const ROUTES = routesFor(DIVINE); // R1 Div → Item → Chaos → Div, R2 Div → Chaos → Item → Div, R3 Div → Item → Div
const VIVID = "HarvestSeedGreen", CHROM = "CurrencyRerollSocketColours", SULPH = "CurrencyDeepwater";
const r = (a, b, v) => [rowKey(a, b), v];
const ratios = Object.fromEntries([
  r(CHAOS, DIVINE, [380, 1]), r(DIVINE, CHAOS, [1, 370]),
  r(VIVID, CHAOS, [8.5, 1]), r(CHAOS, VIVID, [1, 8.27]), r(VIVID, DIVINE, [2889, 1]), r(DIVINE, VIVID, [1, 2810]),
  r(CHROM, CHAOS, [1, 3.4]), r(CHAOS, CHROM, [3.69, 1]), r(CHROM, DIVINE, [99, 1]), r(DIVINE, CHROM, [1, 68]),
  r(SULPH, CHAOS, [113, 1]), r(CHAOS, SULPH, [1, 90.1]), r(SULPH, DIVINE, [35000, 1]), r(DIVINE, SULPH, [1, 33333]),
]);
// Each route's profit: the div gained, then what's left over, kept as it is ({ currency: amount }).
const shown = (res) => [res.gain, Object.fromEntries(res.leftovers)];
const expected = {
  [CHROM]: { slow: [[-1, { [CHAOS]: 258 }], [16, { [CHROM]: 6 }], [11, { [CHROM]: 27 }]],
    fast: [[-10, { [CHAOS]: 80 }], [0, { [CHROM]: 30 }], [-8, { [CHROM]: 17 }]] },
  [VIVID]: { slow: [[-2, { [VIVID]: 4, [CHAOS]: 220 }], [3, { [VIVID]: 2070 }], [0, { [VIVID]: 1975 }]],
    fast: [[-4, { [VIVID]: 6, [CHAOS]: 284 }], [1, { [VIVID]: 1408 }], [-1, { [VIVID]: 914 }]] },
  [SULPH]: { slow: [[1, { [SULPH]: 38, [CHAOS]: 91 }], [7, { [SULPH]: 6844 }], [1, { [SULPH]: 8342 }]],
    fast: [[-6, { [SULPH]: 63, [CHAOS]: 154 }], [-2, { [SULPH]: 28425 }], [-2, { [SULPH]: 28325 }]] },
};
for (const [item, byMethod] of Object.entries(expected)) {
  for (const method of [SLOW, FAST]) {
    eq(ROUTES.map((route) => shown(runRoute(ratios, item, route, method, 25))), byMethod[method], `${item} ${method}`);
  }
}

// --- step details: Chromatic Slow R2 ---
const r2 = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25);
// 558 lots of 5 chrom : 17c leave 14c, which buys 4 more at 3.405c each (14c, rounded up); 41 lots of 1 div : 68 chrom
// leave 6 chrom, not enough for 1 div: kept, worth 6 × 3.685 = 22c (0.059 div at 370c) when ranking.
eq(r2.steps.map((s) => [s.received, s.given, s.extra]), [[9500, 25, 0], [2794, 9500, 0], [41, 2788, 6]],
  "chromatic slow R2 steps: what's left after whole lots still trades");
eq([r2.gain, r2.leftovers, r2.value.toFixed(4)], [16, [[CHROM, 6]], (16 + 22 / 370).toFixed(4)],
  "chromatic slow R2: +16 div, 6 chrom kept, worth what they'd sell for");
eq(r2.gainRank, 16, "chromatic slow R2's gain alone in div: what's kept doesn't count");
eq(r2.steps[1].orders, [{ lots: 562, received: 2794, given: 9500 }], "the top-up joins the lots' order: one order to place");
eq(r2.steps.slice(0, 3).map((s) => s.gold), [142500, 55880, 10250], "chromatic slow R2 gold per trade");

eq(r2.steps.slice(0, 3).map((s) => s.ratio), [[380, 1], [1, 3.4], [1, 68]], "slow steps carry the entered ratio, want:have");
const f2 = runRoute(ratios, CHROM, ROUTES[1], FAST, 25);
eq(f2.steps.slice(0, 3).map((s) => s.ratio), [[370, 1], [1, 3.69], [1, 99]], "fast steps read the other row, flipped to want:have");

// --- what's left after whole lots still trades (SPEC.md §3.2) ---
// 1 div : 2118.33 Vivid shows only from 3 div : 6,355 (lot), so 53,375 Vivid made 8 lots, 24 div. The rest buys whole div
// at 2118.335 each, paid rounded up: 25 div for 52,959 Vivid in one order (shown as 2118.36), 416 Vivid left.
{
  const own = Object.fromEntries([r(VIVID, DIVINE, [2135, 1]), r(DIVINE, VIVID, [1, 2118.33])]);
  const t = leg(own, SLOW, DIVINE, VIVID, 53375);
  eq([t.orders, t.extra], [[{ lots: 9, received: 25, given: 52959 }], 416], "25 div for 52,959 Vivid, not 24 div from whole lots");
  eq(leg(own, SLOW, VIVID, DIVINE, 25).received, 53375, "a whole-number price needs no top-up");
}

// --- what's left over is kept, not traded; best result first ---
const r3 = runRoute(ratios, CHROM, ROUTES[2], SLOW, 25);
eq([r3.steps.map((s) => s.received), r3.leftovers], [[2475, 36], [[CHROM, 27]]], "chromatic slow R3: only the trades, 27 chrom kept");
const all = allResults(ratios, CHROM, 25, SLOW);
eq(all.map((r) => [r.route.id, r.gain]), [[`before:${CHAOS}`, 16], ["direct", 11], [`after:${CHAOS}`, -1]], "one result per route, best first");

const ROUTES_C = routesFor(CHAOS); // Chaos mode: R1 / R2 / R3 in the same order as Div mode
// --- Chaos mode: start in chaos, end in chaos; profit in chaos (SPEC.md §3, §8), Starting chaos 10,000 ---
// Chromatic Slow R2 −121c and R3 +859c were worked by hand (27 div for 9,990c, 2,673 chrom, 205 lots of 48c : 13
// chrom = 9,840c and the last 8 chrom for 8 × 3.685 = 29c; and 2,941 chrom for 10,000c, sold for 10,848c + 11c).
// R1 buys the same 2,941 chrom, 43 div for 2,924 of them, sold for 16,340c: +6,340c, 17 chrom kept.
eq(ROUTES_C.map((r) => [CHAOS, ...r.path(CHROM)]), [[CHAOS, CHROM, DIVINE, CHAOS], [CHAOS, DIVINE, CHROM, CHAOS], [CHAOS, CHROM, CHAOS]],
  "chaos mode: three routes ending in chaos");
const expectedChaos = {
  [CHROM]: { slow: [[6340, { [CHROM]: 17 }], [-121, {}], [859, {}]], fast: [[-9, { [CHROM]: 35 }], [-3869, {}], [-792, {}]] },
  [VIVID]: { slow: [[1400, { [VIVID]: 700 }], [-562, { [VIVID]: 7 }], [274, { [VIVID]: 6 }]],
    fast: [[360, { [VIVID]: 1835 }], [-1285, { [VIVID]: 2 }], [-268, { [VIVID]: 5 }]] },
  [SULPH]: { slow: [[2540, { [SULPH]: 30011 }], [498, { [SULPH]: 31 }], [2541, { [SULPH]: 55 }]],
    fast: [[-750, { [SULPH]: 26000 }], [-2211, { [SULPH]: 61 }], [-2027, { [SULPH]: 51 }]] },
};
for (const [item, byMethod] of Object.entries(expectedChaos)) {
  for (const method of [SLOW, FAST]) {
    eq(ROUTES_C.map((route) => shown(runRoute(ratios, item, route, method, 10000, {}, CHAOS))), byMethod[method],
      `chaos mode: ${item} ${method}`);
  }
}
const c2 = runRoute(ratios, CHROM, ROUTES_C[1], SLOW, 10000, {}, CHAOS);
eq([c2.steps.map((s) => [s.received, s.given]), c2.unspent, c2.base],
  [[[27, 9990], [2673, 27], [9869, 2673]], 10, CHAOS], "chaos mode: chromatic slow R2 steps");
eq(runRoute(ratios, CHROM, ROUTES_C[2], SLOW, 10000, {}, CHAOS).rank.toFixed(4), (859 / 370).toFixed(4),
  "chaos mode: ranked in div at the route's chaos per div (859c / 370)");
// A starting amount too small for one unit of a main trade: the route is unaffordable and not offered at all.
const poor = runRoute(ratios, CHROM, ROUTES_C[0], SLOW, 3, {}, CHAOS);
eq([poor.steps[0].lots, poor.unaffordable], [0, true], "too little to start for one unit (3c, at 3.405c each): unaffordable");
eq(runRoute(ratios, CHROM, ROUTES_C[2], SLOW, 10, {}, CHAOS).steps[0].orders, [{ lots: 2, received: 2, given: 7 }],
  "less than a lot (17c) still buys whole units: 10c buys 2 chrom for 7c");
const halfway = runRoute(ratios, VIVID, ROUTES_C[0], SLOW, 300, {}, CHAOS);
eq([halfway.steps[0].lots > 0, halfway.steps[1].lots, halfway.unaffordable], [true, 0, true], "a later main trade short of one unit: unaffordable");
eq(runRoute(ratios, VIVID, ROUTES_C[0], SLOW, 1000, {}, CHAOS).unaffordable, false, "enough for every trade: affordable");
eq(allResults(ratios, VIVID, 300, SLOW, {}, CHAOS).some((r) => r.route.id === ROUTES_C[0].id), false, "allResults leaves unaffordable routes out");
eq(allResults(ratios, CHROM, 3, SLOW, {}, CHAOS), [], "nothing affordable: no routes at all");
// An extra divine partway (Chaos mode R2's div → item leg) is kept as it is, and worth its chaos when ranking.
const oddDiv = { ...ratios, [rowKey(CHROM, DIVINE)]: [1, 2.5] }; // lot 2 chrom : 5 div, so 27 div leave 2, short of 2.505
const c2odd = runRoute(oddDiv, CHROM, ROUTES_C[1], SLOW, 10000, {}, CHAOS);
eq([c2odd.steps.length, c2odd.leftovers, c2odd.value - c2odd.gain], [3, [[DIVINE, 2]], 760], "chaos mode: an extra divine is kept, worth 2 × 380c");
eq((c2odd.gainRank * c2odd.value / c2odd.rank).toFixed(4), c2odd.gain.toFixed(4), "chaos mode: the gain alone in div, at the rank's rate");
eq(allResults(ratios, CHROM, 10000, SLOW, {}, CHAOS).map((r) => [r.route.id, r.gain]),
  [[`after:${DIVINE}`, 6340], ["direct", 859], [`before:${DIVINE}`, -121]], "chaos mode: one result per route, best first");
eq(allResults(ratios, CHROM, 25, FAST, {}, DIVINE)[0].base, DIVINE, "a Div start ends in div");

// --- missing ratios ---
const partial = { ...ratios };
delete partial[rowKey(CHROM, DIVINE)];
eq(runRoute(partial, CHROM, ROUTES[2], FAST, 25).missing, rowKey(CHROM, DIVINE), "missing ratio reported");
delete partial[rowKey(DIVINE, CHROM)];
eq(allResults(partial, CHROM, 25, SLOW).every((r) => r.missing), true, "routes with no usable rows report missing");

// --- unknown gold fees ---
setGold({ [CHAOS]: 15, [DIVINE]: 250 });
const noFee = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25);
eq([noFee.steps[1].gold, noFee.gold, noFee.goldUnknown], [null, 142500 + 10250, true], "unknown fee: step is null, total is the known steps (chaos + div)");
setGold({ [CHAOS]: 15, [DIVINE]: 250, HarvestSeedGreen: 0.125, CurrencyRerollSocketColours: 20, CurrencyDeepwater: 0.001 });

// --- rows with no open orders ---
setNoOrders([rowKey(CHROM, CHAOS)]); // nobody offering Chaos for Chromatics
const fastR2 = runRoute(ratios, CHROM, ROUTES[1], FAST, 25);   // step 2 (want chrom, have chaos) reads Chaos>Chrom: fine
const slowR2 = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25);   // step 2 reads Chrom>Chaos: no competing trades
eq([fastR2.blocked, slowR2.blocked, slowR2.steps[1].noOrders], [false, false, false], "no competing trades on a Competing step: its order is the only one, nothing blocked");
// Nobody posting and no price read (the game showed Competing empty): the step asks the pair's usual price, here 3.5
// Chaos a Chromatic, less than the 3.69 the orders already up ask, so it's an order of its own; at a usual 3.9, those
// orders are the better deal, so posting fills them at once; with no usual price, it has none.
{
  const empty = Object.fromEntries(Object.entries(ratios).filter(([k]) => k !== rowKey(CHROM, CHAOS)));
  setReadEmpty((key) => key === rowKey(CHROM, CHAOS));
  setUsual((recv, give) => (recv === CHROM && give === CHAOS ? 1 / 3.5 : null));
  const alone = runRoute(empty, CHROM, ROUTES[1], SLOW, 25).steps[1];
  eq([alone.alone, alone.ratio, alone.noOrders, alone.thin, alone.fillHours !== 0], [true, [1, 3.5], false, false, true], "alone: the usual price, as the game shows it, waiting to fill");
  setUsual((recv, give) => (recv === CHROM && give === CHAOS ? 1 / 3.9 : null));
  const filled = runRoute(empty, CHROM, ROUTES[1], SLOW, 25).steps[1];
  eq([filled.alone, filled.fillHours], [true, 0], "alone, but the buyers already pay the usual price: their orders, at once");
  setUsual(null);
  eq(runRoute(empty, CHROM, ROUTES[1], SLOW, 25).missing, rowKey(CHROM, CHAOS), "alone with no usual price: none");
  setReadEmpty(null);
}
setNoOrders([rowKey(CHAOS, CHROM)]); // nobody offering Chromatics for Chaos
const blocked = runRoute(ratios, CHROM, ROUTES[1], FAST, 25);
eq([blocked.blocked, blocked.steps[1].noOrders], [true, true], "no available trades blocks a Fast route");
eq(allResults(ratios, CHROM, 25, FAST)[0].route.id !== `before:${CHAOS}`, true, "blocked routes sort after the rest");
setNoOrders([]);

// --- stock depth ---
// Fast R2 buys 2,505 chromatics (step 2): at least that many must be on offer.
setStock((recv) => (recv === CHROM ? 2000 : null));
const thin = runRoute(ratios, CHROM, ROUTES[1], FAST, 25);
eq([thin.steps[1].depth, thin.steps[1].thin, thin.blocked], [2000, true, true], "less than the order on offer: thin and blocked");
setStock((recv) => (recv === CHROM ? 2505 : null));
eq(runRoute(ratios, CHROM, ROUTES[1], FAST, 25).blocked, false, "exactly the order on offer: fine");
// Slow R2 step 2 gives 9,500 chaos for chromatics, with only 9,000 chaos offered by others: its own order doesn't need theirs.
setStock((offered) => (offered === CHAOS ? 9000 : null));
const slowThin = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25);
eq([slowThin.steps[1].depth, slowThin.steps[1].thin, slowThin.blocked], [9000, false, false], "Competing: less than what you give on offer by others is fine");
setStock((offered) => (offered === CHAOS ? 9500 : null));
eq(runRoute(ratios, CHROM, ROUTES[1], SLOW, 25).blocked, false, "Competing: as much as you give is fine");
setStock(null);

// --- fill time: the sum of the steps at the pair's recent pace; no limit, nothing blocks ---
// Slow R2 receives 9,500 chaos, then 2,790 chromatics, then 41 div.
setPerHour((x) => ({ [CHAOS]: 95000, [CHROM]: 27900, [DIVINE]: 410 })[x]);   // 0.1 h each
const quick = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25);
eq([quick.steps.slice(0, 3).map((s) => s.fillHours.toFixed(2)), quick.fillHours.toFixed(2), quick.blocked],
  [["0.10", "0.10", "0.10"], "0.30", false], "fill time is the sum of the main steps");
setPerHour((x) => ({ [CHAOS]: 95000, [CHROM]: 2790, [DIVINE]: 410 })[x]);    // chromatics take 1 h
const slow = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25);
eq([slow.fillHours.toFixed(2), slow.blocked], ["1.20", false], "a slow route isn't blocked");
setPerHour((x) => ({ [CHAOS]: 95000, [CHROM]: 0, [DIVINE]: 410 })[x]);       // no recent chromatic trades
const never = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25);
eq([never.steps[1].fillHours, never.fillHours, never.blocked], [null, null, false], "no recent trades: fill time unknown, not blocked");
setPerHour((x) => ({ [CHAOS]: 95000, [DIVINE]: 410 })[x]);                   // chromatic pace unknown
const unknown = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25);
eq([unknown.steps[1].fillHours, unknown.fillHours, unknown.blocked], [null, null, false], "unknown pace: the route's fill time unknown too");
setPerHour((x) => ({ [CHAOS]: 95000, [CHROM]: 0, [DIVINE]: 410 })[x]);       // no recent chromatic trades
const instant = runRoute(ratios, CHROM, ROUTES[1], FAST, 25);
eq([instant.steps.map((s) => s.fillHours), instant.fillHours],
  [[0, 0, 0], 0], "Available Trades fill existing orders: instant, whatever the pace");
const mixedPace = runRoute(ratios, CHROM, ROUTES[1], FAST, 25, { [stepKey(CHROM, CHAOS)]: SLOW });
eq([mixedPace.fillHours, mixedPace.blocked], [null, false], "a Competing step with no recent trades: the route's fill time unknown");
setPerHour((x, other) => (x === CHAOS && other === CHROM ? 480 : ({ [CHAOS]: 95000, [CHROM]: 27900, [DIVINE]: 410 })[x]));
// Div mode R3: 2,475 chromatics (0.09 h), then 36 div (0.09 h); the 27 chromatics left over aren't sold, so take no time.
const kept = runRoute(ratios, CHROM, ROUTES[2], SLOW, 25);
eq([kept.leftovers, kept.fillHours.toFixed(2)], [[[CHROM, 27]], "0.18"], "what's left over adds no time");
// The queue: Slow R2's first step gives 25 div for 9,500 chaos (380 : 1); 25 div already posted at that price is
// another 9,500 chaos to trade before it, so the step takes twice as long.
setPerHour((x) => ({ [CHAOS]: 95000, [CHROM]: 27900, [DIVINE]: 410 })[x]);
setAhead((key) => (key === rowKey(CHAOS, DIVINE) ? 25 : null));
const queued = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25);
eq([queued.steps[0].ahead, queued.steps[0].fillHours.toFixed(2), queued.fillHours.toFixed(2)], [25, "0.20", "0.40"],
  "Competing: the stock posted ahead at the price fills first");
eq(runRoute(ratios, CHROM, ROUTES[1], FAST, 25, { [stepKey(CHAOS, DIVINE)]: SLOW }).steps[0].fillHours.toFixed(2), "0.20",
  "a Competing step in an Instant route queues too");
// A Manual step trades at its typed price: 390 : 1 is 9,750 chaos for 25 div, with nothing counted ahead (the 25 div queued
// are at the read price, 380 : 1); typed at the read price, it queues behind them as Competitive does.
const manual = (ratio) => runRoute(ratios, CHROM, ROUTES[1], FAST, 25, { [stepKey(CHAOS, DIVINE)]: { method: MANUAL, ratio } }).steps[0];
eq([manual([390, 1]).method, manual([390, 1]).ratio, manual([390, 1]).received, manual([390, 1]).ahead], [MANUAL, [390, 1], 9750, 0],
  "Manual: at its typed price, nothing ahead");
eq(manual([380, 1]).ahead, 25, "Manual at the read price: behind the stock there");
// Undercutting (SPEC.md §3.6): orders posted ahead after yours slow the queue's drain. The queued step above (9,500
// chaos and 9,500 of queue at 95,000 an hour, 0.2 h) with 125 div an hour posted ahead (47,500 chaos at 380 : 1)
// drains at 47,500: 0.4 h. Undercut faster than it trades, it still drains at half the pace: 0.4 h.
setUndercut((key) => (key === rowKey(CHAOS, DIVINE) ? 125 : null));
const undercut = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25).steps[0];
eq([undercut.fillHours.toFixed(2), undercut.undercut], ["0.40", 125], "Competing: undercutting slows the queue");
setUndercut((key) => (key === rowKey(CHAOS, DIVINE) ? 300 : null));
eq(runRoute(ratios, CHROM, ROUTES[1], SLOW, 25).steps[0].fillHours.toFixed(2), "0.40", "undercut faster than it trades: at most twice as long");
eq(runRoute(ratios, CHROM, ROUTES[1], FAST, 25).steps[0].undercut, null, "Instant steps aren't undercut");
setUndercut(null);
// Measured buying (SPEC.md §3.6): 50 div an hour of Chaos:Divine's orders bought is 19,000 chaos an hour at 380 : 1, in
// place of the pair's 95,000: the 19,000 chaos (queue and step) take 1 h.
setBought((key) => (key === rowKey(CHAOS, DIVINE) ? 50 : null));
const bought = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25).steps[0];
eq([bought.fillHours.toFixed(2), bought.bought], ["1.00", 50], "Competing: paced by the row's measured buying");
eq(runRoute(ratios, CHROM, ROUTES[1], FAST, 25).steps[0].bought, null, "Instant steps aren't paced");
setUndercut((key) => (key === rowKey(CHAOS, DIVINE) ? 125 : null));
const both = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25).steps[0];
eq([both.fillHours.toFixed(2), both.undercut], ["1.00", null], "measured buying: the undercutting isn't taken off it");
setUndercut(null);
setBought(null);
setAhead(null);
setPerHour(null);

// --- undercutting from list reads (SPEC.md §3.6) ---
{
  const MIN = 60000, read = (m, ...levels) => ({ at: m * MIN, levels: levels.map(([chaos, stock]) => ({ ratio: [chaos, 1], stock })) });
  // Chaos : Divine, best (fewest chaos per div) first. At 8 min, 4 div at 378 is ahead of the first read's 380; at 16 min,
  // 2 div at 377 ahead of the 8 min read's 378 (the 4 at 378 aren't counted twice); at 24 min, 6 div at 376: 12 div in
  // 24 min, 30 an hour.
  const reads = [read(0, [380, 10]), read(1, [375, 100]), read(8, [378, 4], [380, 10]), read(16, [377, 2], [378, 4], [380, 10]),
    read(24, [376, 6], [377, 2], [378, 4])];
  eq(undercutRate(reads, 24 * MIN), 30, "stock ahead of each read's best price, per hour (a read under 2 minutes on is skipped)");
  eq(undercutRate(reads.slice(0, 4), 16 * MIN), null, "under 20 minutes compared: not known");
  eq(undercutRate([read(0, [380, 10]), read(10, [378, 400], [380, 10]), read(20, [378, 390]), read(30, [378, 380])], 30 * MIN), 0,
    "one order posted ahead isn't a rate: none");
  eq(undercutRate([read(0, [380, 10]), read(30, [370, 50]), read(33, [370, 50])], 33 * MIN), null, "reads over 20 minutes apart aren't compared");
  eq(undercutRate(reads, 85 * MIN), null, "reads over an hour old aren't used");
  eq(undercutRate([read(0, [380, 10]), read(10, [380, 6], [381, 9]), read(20, [380, 6])], 20 * MIN), 0, "nothing ahead: no undercutting");

  // Bought: at 8 min 4 of the 10 div at 380 are gone; at 16 min the 6 left at 380 are gone above 381, still listed, and 2
  // of its 9 with them; at 24 min 382 (further down) is gone, taken down, and 3 more of 381's: 15 div in 24 min, 37.5 an hour.
  const book = [read(0, [380, 10], [381, 9], [382, 5]), read(8, [380, 6], [381, 9], [382, 5]), read(16, [381, 7], [382, 5]),
    read(24, [379, 20], [381, 4])];
  eq(boughtRate(book, 24 * MIN), 37.5, "bought: stock gone at prices still listed and every price above them");
  eq(boughtRate(book.slice(0, 3), 16 * MIN), null, "under 20 minutes compared: not known");
  const full = (m, from, stock) => read(m, ...[0, 1, 2, 3, 4].map((i) => [from + i, stock]));
  eq(boughtRate([full(0, 380, 5), full(10, 370, 5), full(20, 360, 5), full(30, 350, 5)], 30 * MIN), null,
    "a full list pushed down by better prices: nothing seen bought, not known");
  eq(boughtRate([full(0, 380, 5), read(10, [383, 5], [384, 5]), read(20, [384, 5]), read(30, [384, 4])], 30 * MIN), 42,
    "a short list: every price above the best still listed was bought (21 div in 30 min)");
}

// --- a pinned price: exactly that ratio, whatever the scans (SPEC.md §4.6) ---
{
  const at = leg(ratios, SLOW, CHROM, DIVINE, 25, [60, 1]);
  eq([at.ratio, at.received, at.given], [[60, 1], 1500, 25], "pinned: traded at the ratio given, not the scanned 99 : 1");
  const fast = leg(ratios, FAST, CHROM, DIVINE, 25, [70, 1]);
  eq([fast.ratio, fast.received], [[70, 1], 1750], "pinned Instant: its ratio as entered, want:have");
}

// --- a listing's steps as they were posted (SPEC.md §4.6) ---
{
  const live = runRoute(ratios, CHROM, ROUTES[0], SLOW, 25);
  const posted = { ...live.steps[0], ratio: [1, 60], received: 1500, given: 25, have: 25, extra: 0, fillHours: 0.5 };
  const kept = runRoute(ratios, CHROM, ROUTES[0], SLOW, 25, {}, DIVINE, [posted]);
  eq([kept.steps[0].received, kept.steps[1].have], [1500, 1500], "a posted step is kept as it was, and the next starts from it");
  eq(kept.steps[1].ratio, live.steps[1].ratio, "the steps after it follow the prices");
}

// --- per-step method overrides ---
const mixed = runRoute(ratios, CHROM, ROUTES[1], SLOW, 25, { [stepKey(CHAOS, DIVINE)]: FAST });
eq(mixed.steps.map((s) => s.method).slice(0, 3), [FAST, SLOW, SLOW], "one step overridden, the rest keep the route's method");
eq(mixed.steps[0].ratio, [370, 1], "overridden step uses the other side's ratio");
eq(mixed.steps[1].have, 9250, "later steps start from the overridden step's result");
const all2 = allResults(ratios, CHROM, 25, SLOW, { [`before:${CHAOS}`]: { [stepKey(CHAOS, DIVINE)]: FAST } });
eq(all2.find((r) => r.route.id === `before:${CHAOS}`).steps[0].method, FAST, "allResults applies overrides per route");
eq(all2.find((r) => r.route.id === `after:${CHAOS}`).steps[0].method, SLOW, "other routes unaffected");

// --- 999,999 per side per order ---
const big = { [rowKey(SULPH, DIVINE)]: [39144, 1] };
const split = leg(big, SLOW, SULPH, DIVINE, 30);
eq(split.orders.map((o) => [o.lots, o.received, o.given]), [[25, 978600, 25], [5, 195720, 5]], "splits at 999,999 per side");
eq([split.received, split.gold], [1174320, 979 + 196], "split totals, gold rounded per order");
eq(split.orders.every((o) => o.received <= MAX_ORDER && o.given <= MAX_ORDER), true, "every order within the cap");
const huge = leg({ [rowKey(SULPH, DIVINE)]: [1200000, 1] }, SLOW, SULPH, DIVINE, 30);
eq([huge.lots, huge.tooBig, huge.extra], [0, true, 30], "a single unit over the cap can't trade");
// A lot over the cap at a price that can trade (250000.37 : 1 shows from 4,750,007 : 19 at the least): rounded
// whole-number orders, always on the safe side of whatever's behind the two decimals, rounded on the cheap side.
const cheap = leg({ [rowKey(SULPH, DIVINE)]: [250000.37, 1] }, SLOW, SULPH, DIVINE, 7);
eq([cheap.rounded, cheap.tooBig, cheap.orders.map((o) => [o.received, o.given]), cheap.extra],
  [true, false, [[750001, 3], [750001, 3], [250000, 1]], 0], "buying the cheap side: all of it spent, what's asked rounded down at 0.005 under, split at the cap");
eq(cheap.orders.every((o) => o.received / o.given <= 250000.365), true, "  never asks more than the lowest price that shows as 250000.37");
const dear = leg({ [rowKey(DIVINE, SULPH)]: [1, 250000.37] }, SLOW, DIVINE, SULPH, 900000);
eq([dear.rounded, dear.orders.map((o) => [o.received, o.given]), dear.extra], [true, [[3, 750002]], 149998],
  "buying the expensive side: whole units at 0.005 over, paid rounded up, the rest kept");
eq(dear.given / dear.received >= 250000.375, true, "  never pays less than the highest price that shows as 250000.37");
setBooks(() => [{ ratio: [1, 250000.37], stock: 600000 }]);
const booked = leg({ [rowKey(DIVINE, SULPH)]: [1, 250000.37] }, FAST, SULPH, DIVINE, 7);
setBooks(null);
eq([booked.rounded, booked.received, booked.given, booked.extra], [true, 500000, 2, 5], "a book level over the cap: rounded, up to its stock");
eq(leg({ [rowKey(SULPH, DIVINE)]: [16666.67, 1] }, SLOW, SULPH, DIVINE, 30).rounded, false, "16666.67 : 1 shows from 50,000 : 3: exact lots, no rounding");
eq(leg(ratios, SLOW, CHAOS, DIVINE, 25).orders.length, 1, "small trades stay one order");

// --- three hubs (Exalted, Chaos, Divine; items left over valued in Exalted) ---
setCurrencies({ hubs: [EXALTED, CHAOS, DIVINE], end: DIVINE, sellTo: EXALTED });
eq(routesFor(EXALTED).map((r) => [EXALTED, ...r.path("X")]), [
  [EXALTED, "X", CHAOS, EXALTED], [EXALTED, "X", DIVINE, EXALTED],   // S → Item → H → S, H ≠ S
  [EXALTED, CHAOS, "X", EXALTED], [EXALTED, DIVINE, "X", EXALTED],   // S → H → Item → S
  [EXALTED, "X", EXALTED],                                           // S → Item → S
], "three hubs: five routes, all ending in exalted");
eq(routesFor(DIVINE).length, 5, "three hubs, Div start: five routes too");
// Worked by hand, Slow, 10 div: 450 X for 10 div (45 X : 1 div), 11 div for 440 X (1 div : 40 X), the 10 X left over
// kept. Profit +1 div, 10 X; ranked as 1 + (what 10 X sell for in exalted: 25 ex at 5 ex : 2 X) / 100 = 1.25 div.
const hub3 = Object.fromEntries([
  r("X", EXALTED, [1, 2]), r(DIVINE, "X", [1, 40]), r(EXALTED, "X", [2.5, 1]), r("X", DIVINE, [45, 1]),
  r(DIVINE, EXALTED, [1, 100]), r(EXALTED, DIVINE, [100, 1]), r(DIVINE, CHAOS, [1, 300]), r(CHAOS, DIVINE, [300, 1]),
]);
const direct3 = runRoute(hub3, "X", routesFor(DIVINE).at(-1), SLOW, 10, {}, DIVINE);
eq([direct3.steps.map((s) => [s.recv, s.received, s.given, s.extra]), direct3.gain, direct3.leftovers, direct3.rank],
  [[["X", 450, 10, 0], [DIVINE, 11, 440, 10]], 1, [["X", 10]], 1.25],
  "three hubs: the X left over is kept, valued at what it sells for in exalted");
// Exalted → X → Exalted buys 500 X for 1,000 ex and sells them (lot 5 ex : 2 X) for 1,250 ex: +250 ex, ranked as
// 2.5 div at 100 ex per div. Ending in Exalted needs every other hub's rate to Exalted, so Chaos ↔ Exalted too.
eq(runRoute(hub3, "X", routesFor(EXALTED).at(-1), SLOW, 1000, {}, EXALTED).missing, rowKey(EXALTED, CHAOS),
  "three hubs, exalted start: needs chaos → exalted");
const hub3x = { ...hub3, ...Object.fromEntries([r(EXALTED, CHAOS, [69, 1]), r(CHAOS, EXALTED, [1, 69])]) };
const back3 = runRoute(hub3x, "X", routesFor(EXALTED).at(-1), SLOW, 1000, {}, EXALTED);
eq([back3.gain, back3.rank, back3.base], [250, 2.5, EXALTED], "three hubs: exalted start, +250 ex = 2.5 div");
delete hub3[rowKey(DIVINE, CHAOS)];
eq(runRoute(hub3, "X", routesFor(DIVINE).at(-1), SLOW, 10, {}, DIVINE).missing, rowKey(DIVINE, CHAOS),
  "three hubs: every hub's rate to div is needed");
setCurrencies({ hubs: [CHAOS, DIVINE], end: DIVINE, sellTo: CHAOS });

// --- a hub as the item (SPEC.md §3.1): routes that receive a currency twice are dropped ---
// Div start, item Chaos: only Div → Chaos → Div. Competing sells 25 div at 380c and buys 25 back at 370c.
const hubSlow = allResults(ratios, CHAOS, 25, SLOW);
eq(hubSlow.map((x) => [x.route.id, ...shown(x)]), [["direct", 0, { [CHAOS]: 250 }]], "chaos as the item from div: one route, +0 div, 250c");
eq(allResults(ratios, CHAOS, 25, FAST).map(shown), [[-1, { [CHAOS]: 130 }]], "chaos as the item from div: available loses the gap");
// Chaos start, item Divine: only Chaos → Div → Chaos. 740c buys 2 div (260c unspent), sold for 760c: +20c.
const hubBack = allResults(ratios, DIVINE, 1000, SLOW, {}, CHAOS);
eq(hubBack.map((x) => [x.route.id, x.route.path(DIVINE), x.unspent, x.gain]), [["direct", [DIVINE, CHAOS], 260, 20]],
  "divine as the item from chaos: Chaos → Div → Chaos, +20c");

// --- order books: Available Trades filled level by level (SPEC.md §3.2a) ---
// Buying Exalted (as the stand-in item) with div. Row Div>Exalted reads give:receive, 1 : 3500 meaning 3500
// Exalted for 1 div; its stock is Exalted on offer. The best price, 3500 for 1 div, has 1 lot; 3400 has 3; 3300 has 1.
{
  const key = rowKey(DIVINE, EXALTED), ratios = { [key]: [1, 3500] };
  const levels = (...rows) => rows.map(([r, stock]) => ({ ratio: [1, r], stock }));
  const book = levels([3500, 3500], [3400, 10200], [3300, 3300]);
  const fill = (b, have, method = FAST) => {
    setBooks((k) => (k === key ? b : null));
    const t = leg(ratios, method, EXALTED, DIVINE, have);
    setBooks(null);
    return t;
  };
  const sum = (t) => [t.received, t.given, t.ratio, t.lots, t.thin, t.extra];
  eq(sum(fill(book, 5)), [17000, 5, [3300, 1], 5, false, 0], "book: 5 div takes all three prices, each at its own, entered at the worst (3300 : 1)");
  eq(fill(book, 5).orders, [{ lots: 5, received: 17000, given: 5 }], "book: one order");
  eq(sum(fill(book, 3)), [10300, 3, [3400, 1], 3, false, 0], "book: 3 div stop partway through the second price");
  eq(sum(fill(book, 1)), [3500, 1, [3500, 1], 1, false, 0], "book: 1 div, the best price only");
  eq(sum(fill(book, 7)), [17000, 5, [3300, 1], 5, false, 2], "book: 7 div buy everything on offer, 2 extra (not \"not enough\")");
  eq(sum(fill(levels([3500, 3500], [3400, 3], [3300, 3300]), 5)), [6800, 2, [3300, 1], 2, false, 3],
    "book: a price with less than a lot on offer is passed over");
  // Fractional: 2.75 div per 4 Exalted (lot 11 : 4); 8 Exalted on offer is 2 lots, 30 div affords 2.
  eq(sum(fill([{ ratio: [2.75, 1], stock: 8 }], 30)), [8, 22, [1, 2.75], 2, false, 8], "book: whole lots of a fractional price");
  // The "worse than" row: everything beyond the list, counted at its last price (the same as the row before).
  eq(sum(fill([...book, { ratio: [1, 3300], stock: 3300 * 1000 }], 7)), [23600, 7, [3300, 1], 7, false, 0],
    "book: the worse-than stock at the last price takes the rest");
  eq(sum(fill(null, 5)), [17500, 5, [3500, 1], 5, false, 0], "no book: the pair's ratio");
  // 1 div : 3500.5 shows from 2 div : 7,001: 3 div take one lot, and the last div buys 3,500 at 3500.495, rounded down.
  eq(sum(fill(levels([3500.5, 1e6]), 3)), [10501, 3, [3500.5, 1], 2, false, 0], "book: what's left after whole lots tops up at that price");
  eq(sum(fill(levels([3500.5, 7001]), 3)), [7001, 2, [3500.5, 1], 1, false, 1], "book: no top-up past the stock on offer");
  eq(fill(book, 5, SLOW).book ?? false, false, "Competing Trades don't use the book");
}

log(failed ? `\n${failed} FAILED` : "\nall passed");
if (failed && globalThis.document) document.title = "FAILED";
