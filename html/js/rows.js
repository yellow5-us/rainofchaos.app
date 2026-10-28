// Reads a list row as a whole (SPEC.md §4.7), for text of any size. The game scales its UI with the window, so
// digits come at any height from about 5 pixels up. Instead of cutting a row into characters and comparing each
// with examples, this keeps one large, sharp example ("master") of each character, draws it at the row's own size,
// and finds the string the row's format allows whose characters, placed along the row, best redraw it. Touching
// characters and faint commas are then part of the fit, not a cut to get right first.
import { AT, LEVELS, cropLum, findListsIn, hoverBoxOf, levels, markOf, readLines } from "./snip.js";

// ---------- masters ----------
// A master: { ch, w, h, top, data } with data the character's grey levels (0 background, 1 text) in a w x h box
// whose bottom edge sits `h - top` rows under the digits' bottom edge (a comma hangs below it). `H` is the
// digit height they were taken at.

// Masters from a snip whose rows are known (["363:1 1,089", ...]), read with the line reader (`glyphs`, tests/lines.json's): each
// line that reads as a known row has one shape per character of it, in order. One of each character is kept, of
// middling width.
export function takeMasters(img, rows, glyphs) {
  const lv = levels(img);
  const found = [];
  const heights = [], ys = [];
  for (const { text, ln } of readLines(img, glyphs)) {
    if (!rows.includes(text)) continue;
    const chars = text.replace(/ /g, "").split("");
    const comps = ln.comps.filter((c) => markOf(c, c.m) !== null);
    if (comps.length !== chars.length) continue;
    heights.push(ln.digitH);
    ys.push(ln.baseline);
    // The line the digits sit on, from those that don't hang below it (3, 4, 5, 7 and 9 do): the shapes are kept
    // in place against it, so a hanging 3 is drawn hanging.
    const sitting = comps.filter((c, i) => "01268".includes(chars[i])).map((c) => c.y1 + 1).sort((a, b) => a - b);
    const bottom = sitting.length ? sitting[Math.floor(sitting.length / 2)] : ln.baseline + 1;
    found.push({ text, chars, comps, bottom });
  }
  // A ratio drawn in the game's smaller size: one with a number of 5 characters or more ("366.50 : 1", "1 : 65000",
  // over full-size stock). Its characters are kept as small masters, for ratios in that size: its own pixel shapes,
  // not the full size's scaled down.
  const out = [];
  for (const { text, chars, comps, bottom } of found) {
    const ratioText = text.split(" ")[0], small = longestIn(ratioText) >= 5, ratioLen = ratioText.length;
    comps.forEach((c, i) => {
      const w = c.x1 - c.x0 + 1, y0 = Math.min(c.y0, bottom - 1), h = Math.max(c.y1 + 1, bottom) - y0;
      const data = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = (img.lum[(y0 + y) * img.w + c.x0 + x] - lv.bg) / (lv.fg - lv.bg);
        data[y * w + x] = Math.max(0, Math.min(1, v));
      }
      out.push({ ch: chars[i], w, h, top: bottom - y0, data, ...(small && i < ratioLen ? { small: true } : {}) });
    });
  }
  heights.sort((a, b) => a - b);
  return { H: heights[Math.floor(heights.length / 2)], P: pitchOf(ys), masters: keep(out) };
}
// The row spacing among lines at heights `ys`: the gap most gaps between neighbouring lines agree with (within
// 12%), averaged, so it's finer than a pixel. Headers and blank space between the lists don't agree. null if under
// two gaps agree.
function pitchOf(ys) {
  const s = [...ys].sort((a, b) => a - b), gaps = s.slice(1).map((y, i) => y - s[i]).filter((g) => g > 0);
  let best = null;
  for (const g of gaps) {
    const near = gaps.filter((x) => Math.abs(x - g) <= 0.12 * g);
    if (near.length >= 2 && (!best || near.length > best.length)) best = near;
  }
  return best && best.reduce((a, b) => a + b, 0) / best.length;
}
// One of each character, of middling width (just under the middle).
function keep(all) {
  const kept = [];
  for (const key of new Set(all.map((m) => `${m.ch}${m.small ? "s" : ""}`))) {
    const these = all.filter((m) => `${m.ch}${m.small ? "s" : ""}` === key).sort((a, b) => a.w - b.w);
    kept.push(these[Math.max(0, Math.floor(these.length / 2) - 1)]);
  }
  return kept;
}

// A master drawn at scale k (target pixels per master pixel), starting `phase` of a pixel in: each target pixel
// is the average of the master area it covers, as the game's anti-aliasing draws it.
function draw(m, k, phase) {
  const w = Math.ceil(m.w * k + phase), top = Math.ceil(m.top * k), bot = Math.ceil((m.h - m.top) * k);
  const h = top + bot, data = new Float32Array(w * h), n = Math.max(2, Math.ceil(3 / k));
  let energy = 0;
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
    let sum = 0;
    for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
      const mx = Math.floor((tx + (sx + 0.5) / n - phase) / k), my = Math.floor(m.top + (ty - top + (sy + 0.5) / n) / k);
      if (mx >= 0 && mx < m.w && my >= 0 && my < m.h) sum += m.data[my * m.w + mx];
    }
    const v = sum / (n * n);
    data[ty * w + tx] = v;
    energy += v * v;
  }
  // Edge columns with next to nothing in them (the sub-pixel shift's) would keep neighbours apart: dropped.
  const colMax = (x) => { let mx = 0; for (let y = 0; y < h; y++) mx = Math.max(mx, data[y * w + x]); return mx; };
  let l = 0, r = w;
  while (r - l > 1 && colMax(l) < 0.1) l++;
  while (r - l > 1 && colMax(r - 1) < 0.1) r--;
  if (l > 0 || r < w) {
    const nw = r - l, nd = new Float32Array(nw * h);
    let e = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < nw; x++) { const v = data[y * w + l + x]; nd[y * nw + x] = v; e += v * v; }
    return { ch: m.ch, w: nw, h, top, data: nd, energy: e };
  }
  return { ch: m.ch, w, h, top, data, energy };
}

// ---------- reading a row ----------
const DIGITS = "0123456789";
// What may follow what, and how far apart (in digit heights): within a number characters sit close; the colon
// is spaced; the stock is well right of the ratio. Every row has its colon: a line read without one is not a row.
// APART's least: "> 1 : 15750 7,072,720" leaves 0.79 (a long stock pushes up to the ratio), well over NEAR's most. A
// row whose space was found narrower than that (a 7- or 8-digit stock all but touching its ratio) has it there already:
// CLOSE lets it be ("> 1 : 16667 10,639,024" leaves 0.35, "1 : 42201 1,645,839" 0.61; at 0.2 a stock's 1 joins the ratio).
const NEAR = [0, 0.45], SPACED = [0, 1.8], APART = [0.7, 14], CLOSE = [0.25, 14];
// States: start, arrow, ratio digits (a1), its dot (a2), decimals (a3, a4), colon (c), second ratio (b1-b4),
// stock's first group (s1-s3), comma (sc), groups after it (g1-g3). Ends: s1-s3, g3.
// A comma too small to see may be skipped across the room it takes (COMMA): the stock's commas fall every three
// digits from the right, so the text gets them back from the digit count. A comma that can be seen is still placed:
// skipping it would leave its ink unexplained. (A point isn't skipped: "2.90" and "290" are both prices.)
const COMMA = [0.35, 1];
const NEXT = {
  start: [["<>", "arrow", [0, 0]], [DIGITS, "a1", [0, 0]]],
  arrow: [[DIGITS, "a1", SPACED]],
  a1: [[DIGITS, "a1", NEAR], [".", "a2", NEAR], [":", "c", SPACED]],
  a2: [[DIGITS, "a3", NEAR]],
  a3: [[DIGITS, "a4", NEAR]],
  a4: [[":", "c", SPACED]],
  c: [[DIGITS, "b1", SPACED]],
  b1: [[DIGITS, "b1", NEAR], [".", "b2", NEAR], [DIGITS, "s1", APART]],
  b2: [[DIGITS, "b3", NEAR]],
  b3: [[DIGITS, "b4", NEAR]],
  b4: [[DIGITS, "s1", APART]],
  s1: [[DIGITS, "s2", NEAR], [",", "sc", NEAR], [DIGITS, "g1", COMMA]],
  s2: [[DIGITS, "s3", NEAR], [",", "sc", NEAR], [DIGITS, "g1", COMMA]],
  s3: [[",", "sc", NEAR], [DIGITS, "g1", COMMA]],
  sc: [[DIGITS, "g1", NEAR]],
  g1: [[DIGITS, "g2", NEAR]],
  g2: [[DIGITS, "g3", NEAR]],
  g3: [[",", "sc", NEAR], [DIGITS, "g1", COMMA]],
};
const ENDS = ["s1", "s2", "s3", "g3"];
// A long ratio ("2500.10 : 1", "1 : 65000") is drawn smaller than the stock beside it: the ratio's states have
// copies ("~a1"...) whose characters are drawn at RATIO_SMALL; a ratio is all one size, the stock always full size.
// A ratio of five characters or more ("366.50") is drawn smaller than the rest of the row, by this much.
const RATIO_SMALL = 0.82;
const RATIO_STATES = ["arrow", "a1", "a2", "a3", "a4", "c", "b1", "b2", "b3", "b4"];
for (const st of RATIO_STATES) NEXT[`~${st}`] = NEXT[st].map(([chars, to, range]) => [chars, RATIO_STATES.includes(to) ? `~${to}` : to, range]);
NEXT.start.push(...NEXT.start.map(([chars, to, range]) => [chars, `~${to}`, range]));
const plain = (st) => st.replace("~", "");
const PHASES = [0, 0.33, 0.67];
// In larger text a third of a pixel moves a digit's shape far less: two sub-pixel places are enough there.
const PHASES_LARGE = [0, 0.5], LARGE = 13;
// A character is placed only on ink at least this bright and this like it; marks (separators, colon, arrows) are
// small, so faint blur or a bit of the box's frame looks enough like one unless they must match closely.
const MIN_INK = 0.5, MIN_CORR = 0.6, MARK_INK = 0.7, MARK_CORR = 0.8, SEP_CORR = 0.8;
// Where the slot's own shapes show a mark (a dot or comma at the foot of the line, the colon's gap, a short shape before
// the ratio that may be an arrow: `hints`, entryInSlot's), a mark only has to match as well as a digit does.
const HINT_INK = 0.5, HINT_CORR = 0.5;
const SEP_CLEAR = 0.2; // the most ink a separator's columns may have above it, at digit height
const TALLEST = 1.35; // in digit heights: anything taller in a row's strip isn't a character
const SPACE_MIN = 0.33; // in digit heights: the narrowest the space before a stock is taken to be (entryInSlot)
// In digit heights right of the stock's centre: how far a shape may start and still be the row's text (8-digit stocks end
// within 3.1 of it), so the box's texture further right doesn't set the row's line (entryInSlot).
const TEXT_REACH = 4;
const MAX_H = 18; // rows with taller digits are read shrunk to this: plenty, and far quicker

// A row's strip of the image, shrunk by f (1 or less), as grey levels from 0 (background) to 1 (text), with its
// own background and text levels: the stock column is dimmer than the ratio, and a wide window's scenery doesn't
// move them. `bottom` is the digits' bottom edge in strip rows.
// `minRange`: the least text-to-background range the strip's levels may have (the box's own, mostly): a row with
// little ink ("1 : 1  1") would otherwise have its faint texture stretched into shapes.
function stripOf(img, x0, x1, bottomY, digitH, f, minRange = 0) {
  const above = Math.ceil(1.25 * digitH), below = Math.ceil(0.6 * digitH); // digits rise to about 1.1: not into a header
  const ix0 = Math.max(0, x0), ix1 = Math.min(img.w, x1), iy0 = Math.max(0, bottomY - above), iy1 = Math.min(img.h, bottomY + below);
  const w = Math.max(1, Math.floor((ix1 - ix0) * f)), h = Math.max(1, Math.floor((iy1 - iy0) * f));
  const raw = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, n = 0;
    for (let sy = Math.floor(iy0 + y / f); sy < Math.min(iy1, Math.ceil(iy0 + (y + 1) / f)); sy++)
      for (let sx = Math.floor(ix0 + x / f); sx < Math.min(ix1, Math.ceil(ix0 + (x + 1) / f)); sx++) { sum += img.lum[sy * img.w + sx]; n++; }
    raw[y * w + x] = n ? sum / n : 0;
  }
  const sorted = Float32Array.from(raw).sort();
  const bg = sorted[Math.floor(sorted.length * 0.5)], fg = sorted[Math.floor(sorted.length * 0.98)];
  const range = Math.max(1, fg - bg, minRange);
  const data = raw.map((v) => Math.max(0, Math.min(1, (v - bg) / range)));
  // The panel's lines between rows run the strip's width: a pixel row lit across most of it is one, not text (the
  // gaps between characters, and between ratio and stock, keep text rows well under).
  for (let y = 0; y < h; y++) {
    let lit = 0;
    for (let x = 0; x < w; x++) if (data[y * w + x] > 0.3) lit++;
    if (lit > 0.6 * w) data.fill(0, y * w, (y + 1) * w);
  }
  // Then anything bright and taller than any character (a mouse cursor beside the row: about 2.4 digits tall, where the
  // tallest character, a hanging or rising digit, is under 1.2) isn't the row's: it's taken out, or the fit would
  // cover it with digits rather than leave so much ink unexplained.
  const lit = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) lit[i] = data[i] > 0.35 ? 1 : 0;
  const seen = new Uint8Array(w * h);
  let erased = false;
  for (let i = 0; i < w * h; i++) {
    if (!lit[i] || seen[i]) continue;
    const blob = [i], stack = [i];
    seen[i] = 1;
    let y0 = h, y1 = 0;
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w;
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) if (k >= 0 && k < w * h && lit[k] && !seen[k]) { seen[k] = 1; stack.push(k); blob.push(k); }
    }
    // Its soft edge too: a pixel round it, dimmer than the cut, would sit beside the row's first digit.
    // So is anything running into the strip's top or bottom edge: the row's characters stop short of both (a
    // quarter digit of room above the tallest, half a digit below the lowest), so it comes from outside the row (a
    // cursor's tail reaching down, a header's letters).
    if (y1 - y0 + 1 > TALLEST * digitH * f || y0 === 0 || y1 === h - 1) for (const j of blob) {
      erased = true;
      const x = j % w, y = (j - x) / w;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) data[yy * w + xx] = 0;
    }
  }
  // Its brightness set the strip's levels (it's the brightest thing there): set them again from what's left, or the
  // row, the dimmer stock most, is left too faint to read. Never under 0.8 of `minRange`: a row with little ink under
  // its list's header ("3 : 1  1") has its texture as its top, and stretched it becomes shapes (0.7 to 0.9 read every
  // test snip).
  if (erased) {
    const left = Float32Array.from(data).sort(), top = Math.max(left[Math.floor(left.length * 0.98)], 0.8 * minRange / range);
    if (top > 0.05) for (let i = 0; i < w * h; i++) data[i] = Math.min(1, data[i] / top);
  }
  return { w, h, data, bottom: Math.round((bottomY - iy0) * f), x0: ix0, f };
}

// The best reading of a strip with the masters drawn at scale k: { text, cost, ink, places } or null.
// `zone` ({ stock, again }): where the stock starts (strip columns), when known. A ratio is all one size and the stock
// always full size, so smaller characters are only tried left of it; and `again` (a fit's `at`, read again with
// `drop`) has the smaller characters as they were, the full-size ones (only the stock's then) tried from it on.
function fit(strip, drawn, digitH, hints, drop, apart, zone) {
  const { w: W, h: Hs, data: I, bottom } = strip;
  // Ink per column, and running totals: the cost of leaving columns as background.
  const col = new Float64Array(W + 1);
  for (let x = 0; x < W; x++) { let e = 0; for (let y = 0; y < Hs; y++) e += I[y * W + x] ** 2; col[x + 1] = col[x] + e; }
  const bgCost = (a, b) => col[b] - col[a];
  // Ink (squared) over any box, from running totals: a character's window can be ruled out before it's compared.
  const sq = new Float64Array((W + 1) * (Hs + 1));
  for (let y = 0; y < Hs; y++) for (let x = 0; x < W; x++) sq[(y + 1) * (W + 1) + x + 1] = I[y * W + x] ** 2 + sq[y * (W + 1) + x + 1] + sq[(y + 1) * (W + 1) + x] - sq[y * (W + 1) + x];
  const inkIn = (x, y0, w, h) => { const a = Math.max(0, y0), b = Math.min(Hs, y0 + h); return b <= a ? 0 : sq[b * (W + 1) + x + w] - sq[a * (W + 1) + x + w] - sq[b * (W + 1) + x] + sq[a * (W + 1) + x]; };
  // The cost of each drawn character starting at each column: the strip's ink there, less what the character
  // explains at its best brightness (the stock is dimmer) and height (a pixel up or down).
  // The mean ink in columns x..x+w-1 over the upper half of the digits.
  const above = (x, w, dy) => {
    let sum = 0, n = 0;
    for (let y = Math.max(0, bottom - Math.round(digitH) + dy); y < Math.min(Hs, bottom - Math.round(0.5 * digitH) + dy); y++)
      for (let i = 0; i < w; i++) { sum += I[y * W + x + i]; n++; }
    return n ? sum / n : 0;
  };
  const slack = Math.max(1, Math.round(0.12 * digitH)); // how far a character may sit off the line found
  const reach = Math.round(0.5 * digitH);
  const at = drawn.map((t, v) => {
    if (zone.again && t.small) return zone.again[v];
    const sep = ".,".includes(t.ch);
    const best = new Float64Array(W).fill(Infinity);
    const x0 = zone.again ? Math.max(0, zone.stock - reach) : 0, x1 = t.small ? Math.min(W, zone.stock + reach) : W;
    const strict = DIGITS.includes(t.ch) ? [MIN_INK, MIN_CORR] : ".,".includes(t.ch) ? [MARK_INK, SEP_CORR] : [MARK_INK, MARK_CORR];
    const mine = hints.filter((h) => h.chars.includes(t.ch));
    for (let x = x0; x + t.w <= x1; x++) {
      // Too little ink in these columns for the character to pass MIN/HINT_INK at all: it ≤ √(energy · ii).
      if (bgCost(x, x + t.w) < HINT_INK * HINT_INK * t.energy) continue;
      const [minInk, minCorr] = mine.some((h) => x >= h.lo && x <= h.hi) ? [HINT_INK, HINT_CORR] : strict;
      for (let dy = -slack; dy <= slack; dy++) {
        const y0 = bottom - t.top + dy + (t.small ? 0 : drop);
        // it ≤ √(energy · ii): too little ink here to pass minInk, whatever its shape.
        const ii = inkIn(x, y0, t.w, t.h);
        if (ii < minInk * minInk * t.energy) continue;
        let it = 0;
        for (let j = Math.max(0, -y0); j < Math.min(t.h, Hs - y0); j++) {
          const row = (y0 + j) * W + x, mj = j * t.w;
          for (let i = 0; i < t.w; i++) it += t.data[mj + i] * I[row + i];
        }
        // Only where there's ink shaped like it: a dot or an arrow drawn on faint texture would cost next to nothing.
        if (it < minInk * t.energy || it < minCorr * Math.sqrt(t.energy * ii)) continue;
        // A separator sits in a gap: nothing above it at digit height (blur under two close digits isn't one).
        if (sep && above(x, t.w, dy + (t.small ? 0 : drop)) > SEP_CLEAR) continue;
        const a = Math.max(0.5, Math.min(1.6, it / t.energy));
        const c = bgCost(x, x + t.w) - 2 * a * it + a * a * t.energy;
        if (c < best[x]) best[x] = c;
      }
    }
    return best;
  });
  // Where each can start, in order: the path only looks there.
  const starts = at.map((best) => { const out = []; best.forEach((c, x) => { if (Number.isFinite(c)) out.push(x); }); return out; });
  return { ...path(W, drawn, digitH, at, bgCost, null, starts, null, false, apart), at, bgCost, starts, ink: col[W], apart };
}

// Each step of the format: the drawn characters it allows, and how far from the last one they may start. The same for
// every path through a row (kept per drawn set).
const STEPS = new WeakMap();
function stepsOf(drawn, digitH, W, noSmall, apart) {
  const byDrawn = STEPS.get(drawn) ?? new Map(), key = `${digitH}|${W}|${noSmall}|${apart}`;
  STEPS.set(drawn, byDrawn);
  if (byDrawn.has(key)) return byDrawn.get(key);
  const g = (r) => [Math.floor(r[0] * digitH), Math.ceil(r[1] * digitH)];
  const steps = {};
  for (const s of Object.keys(NEXT)) steps[s] = NEXT[s].map(([chars, to, range]) => ({ to, range: s === "start" ? [0, W] : g(range === APART ? apart : range),
    vs: drawn.map((t, v) => v).filter((v) => chars.includes(drawn[v].ch) && !drawn[v].small === !to.startsWith("~") && !(noSmall && drawn[v].small)) }));
  byDrawn.set(key, steps);
  return steps;
}
// The cheapest path through the row's format, as { places, cost } (or null): `ban` ({ ch, lo, hi }) forbids that
// character starting in columns lo-hi, for how much worse the row reads without it there.
// `span` ({ s0, x0, s1, x1 }) limits the path to one stretch of the row: from state s0 ending at column x0 to state
// s1 ending at x1 (s1 null: to the row's end), for the margins: a different reading of one digit only changes the
// row near it. `apart`: the space between ratio and stock (APART, or CLOSE).
function path(W, drawn, digitH, at, bgCost, ban, starts, span = null, noSmall = false, apart = APART) {
  const states = Object.keys(NEXT);
  const dp = {}, back = {};
  for (const s of states) { dp[s] = new Float64Array(W + 1).fill(Infinity); back[s] = new Array(W + 1); }
  const steps = stepsOf(drawn, digitH, W, noSmall, apart);
  // The first start at or after x in a sorted list.
  const from = (list, x) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] < x) lo = m + 1; else hi = m; } return lo; };
  const [s0, x0] = span ? [span.s0, span.x0] : ["start", 0];
  if (s0 !== "start") dp[s0][x0] = 0;
  for (let x = x0, xEnd = span?.s1 ? span.x1 : W; x <= xEnd; x++) {
    for (const s of states) {
      // Any amount of background before the first character: "start" is at 0 only, and its steps reach anywhere.
      if (s === "start" && (x > 0 || s0 !== "start")) continue;
      const here = s === "start" ? 0 : dp[s][x];
      if (!Number.isFinite(here)) continue;
      for (const { to, range, vs } of steps[s]) {
        for (const v of vs) {
          const list = starts[v], t = drawn[v];
          for (let k = from(list, x + range[0]); k < list.length && list[k] <= x + range[1]; k++) {
            const start = list[k];
            if (ban && ban.chars.includes(t.ch) && start >= ban.lo && start <= ban.hi) continue;
            const end = start + t.w;
            if (span?.s1 && end > span.x1) continue;
            const total = here + bgCost(x, start) + at[v][start];
            if (total < dp[to][end]) { dp[to][end] = total; back[to][end] = { from: s, to, x, start, v }; }
          }
        }
      }
    }
  }
  if (span?.s1) return { places: null, cost: dp[span.s1][span.x1] };
  let best = null;
  for (const s of ENDS) for (let x = 0; x <= W; x++) {
    const total = dp[s][x] + bgCost(x, W);
    if (total < (best?.total ?? Infinity)) best = { s, x, total };
  }
  if (!best) return { places: null, cost: Infinity };
  if (span) return { places: null, cost: best.total }; // a stretch's cost is all the margins need
  const places = [];
  for (let s = best.s, x = best.x; s !== "start";) {
    const b = back[s][x];
    places.unshift({ ch: drawn[b.v].ch, from: b.from, to: b.to, start: b.start, v: b.v, cost: at[b.v][b.start] });
    s = b.from; x = b.x;
  }
  return { places, cost: best.total };
}

// How sure each placed digit is: how much worse the whole row reads with that digit forbidden where it is (a
// third of a digit either way), as a share of the ink the digit explains. Another digit there, or a different cut of the row
// round it, must cost clearly more. A separator with no mark of its own there (`hints`) is tested the same way against
// the row without it, as a share of a digit's ink: a hanging 7's tail can pass for a decimal point.
function margins(fitted, drawn, W, digitH, hints) {
  const { places, at, bgCost, cost } = fitted;
  // The path's cost up to the end of each character, for the stretch round each digit.
  const ends = places.map((p) => p.start + drawn[p.v].w), cum = [];
  places.forEach((p, k) => { cum.push((k ? cum[k - 1] : 0) + bgCost(k ? ends[k - 1] : 0, p.start) + p.cost); });
  const explained = (p) => bgCost(p.start, p.start + drawn[p.v].w) - p.cost;
  const digits = places.filter((p) => DIGITS.includes(p.ch));
  const digitInk = digits.reduce((sum, p) => sum + explained(p), 0) / Math.max(1, digits.length);
  return places.map((p) => {
    const sep = ".,".includes(p.ch);
    if (!DIGITS.includes(p.ch) && !(sep && !hints.some((h) => h.chars === ".," && p.start >= h.lo - 1 && p.start <= h.hi + 1))) return Infinity;
    // Forbidden over a third of a digit either way: just a column or two, and the same digit comes back shifted.
    const near = Math.max(1, Math.round(0.3 * digitH));
    // Re-read only from three characters before it to two after (or the row's ends), the rest kept as read.
    const i = places.indexOf(p), L = i - 3, R = i + 2;
    const stretch = { s0: L < 0 ? "start" : places[L].to, x0: L < 0 ? 0 : ends[L], s1: R < places.length ? places[R].to : null, x1: R < places.length ? ends[R] : W };
    const base = L < 0 ? 0 : cum[L], mine = (R < places.length ? cum[R] : cost) - base;
    const alt = path(W, drawn, digitH, at, bgCost, { chars: sep ? ".," : p.ch, lo: p.start - near, hi: p.start + near }, fitted.starts, stretch, fitted.noSmall, fitted.apart);
    return (alt.cost - mine) / Math.max(1e-6, sep ? digitInk : explained(p));
  });
}

export const SURE = 0.09;
const FITS = 0.45; // over the test snips, the surest wrong rows (bar the few below) were at 0.08
// How far below the line a mark may start and still be a point or comma, in digit heights: over the test snips they start
// from 0.33 above it to 0.07 below; the box's texture leaves specks from 0.13 below on.
const LOW_MARK = 0.2;
// A row as fitted: { text, y, chars, fit, sure }. Unsure or poorly fitting rows get a "?"
// for their first digit, so they don't read as rows.
function rowOf(ln, strip, got, drawn, digitH, f, hints) {
  const each = margins(got, drawn, strip.w, digitH, hints);
  // A dot seen on its own (a mark at the foot of the line), with no separator placed on it, leaves the row unsure: a dropped decimal
  // point (2.90 read as 290) costs little, and the digits' margins can't show it. A speck starting well below the line
  // (`low`) isn't one: points and commas start at the line or above it.
  const dropped = hints.some((h) => h.chars === ".," && !h.low && got.places.some((p, i) => {
    // Between two digits of one number (not the colon's lower dot, nor a speck between ratio and stock, which are
    // over a digit apart), in a gap with room for a point (a quarter of a digit: neighbouring digits sit far
    // closer), and inside that gap.
    const q = got.places[i + 1], end = p.start + drawn[p.v].w;
    return q && DIGITS.includes(p.ch) && DIGITS.includes(q.ch) && q.from === p.to
      && q.start - end >= 0.25 * digitH && q.start - end <= 0.9 * digitH && h.lo >= end - 1 && h.hi <= q.start + 1;
  }));
  const sure = dropped ? 0 : Math.min(...each);
  // How much of the ink under the row's characters they leave unexplained: only their own columns count, not the
  // gaps (faint texture between ratio and stock outweighs a row as bare as "1 : 1  1"), nor what's before the ratio or
  // after the stock (a mouse cursor beside the row, the box's edge).
  const under = got.places.reduce((sum, p) => sum + got.bgCost(p.start, p.start + drawn[p.v].w), 0);
  const fitShare = got.places.reduce((sum, p) => sum + p.cost, 0) / Math.max(1e-6, under);
  // The text as the format reads it: a colon too faint to place is still there, and the stock is a word apart.
  let text = "";
  for (const p of got.places) {
    if (plain(p.to) === "b1" && (plain(p.from) === "a1" || plain(p.from) === "a4")) text += ":";
    if (p.to === "s1") text += " ";
    text += p.ch;
  }
  // The stock's commas from its digits (seen or not, they fall every three from the right).
  const [ratioText, stockText = ""] = text.split(" ");
  if (stockText) text = `${ratioText} ${stockText.replace(/,/g, "").replace(/\B(?=(\d{3})+$)/g, ",")}`;
  const chars = got.places.map((p) => ({ ch: p.ch, x0: strip.x0 + Math.round(p.start / f), x1: strip.x0 + Math.round((p.start + drawn[p.v].w) / f) - 1, h: ln.digitH }));
  const ok = sure >= SURE && fitShare <= FITS;
  return { text: ok ? text : text.replace(/\d/, "?"), y: ln.baseline, chars, fit: fitShare, sure };
}

// The masters drawn at a row's digit height: each full-size one at full size and also scaled to the smaller
// ratio size; each small one at the smaller size. Both kinds serve a smaller ratio, and the fit takes whichever
// matches: small masters taken at one size don't match every size (a point a pixel or two across at 800 x 600).
// A character there's only a small master of (the reference's one decimal point may be in a smaller ratio) is
// also drawn enlarged for full size.
function drawAll(masters, digitH) {
  const full = new Set(masters.filter((m) => !m.small).map((m) => m.ch));
  const phases = digitH >= LARGE ? PHASES_LARGE : PHASES;
  return masters.flatMap((m) => phases.flatMap((p) => m.small
    ? [{ ...draw(m, digitH / m.H, p), small: true }, ...(full.has(m.ch) ? [] : [draw(m, digitH / m.H / RATIO_SMALL, p)])]
    : [draw(m, digitH / m.H, p), ...(DIGITS.includes(m.ch) || ".:<>".includes(m.ch) ? [{ ...draw(m, (digitH / m.H) * RATIO_SMALL, p), small: true }] : [])]));
}
// The masters for digit height D, from `models` (masters at one or more sizes, { H, masters }): those nearest D
// (shrinking a larger master copies the game better than enlarging a smaller one), and for a character they lack, the
// next nearest that has it.
function mastersFor(models, D) {
  const away = (m) => Math.abs(Math.log(m.H / D)) * (m.H < D ? 1.5 : 1);
  const order = [...(Array.isArray(models) ? models : [models])].sort((a, b) => away(a) - away(b));
  const out = [];
  const key = (x) => `${x.ch}${x.small ? "s" : ""}`;
  for (const m of order) for (const k of new Set(m.masters.map(key))) {
    if (!out.some((x) => key(x) === k)) out.push(...m.masters.filter((x) => key(x) === k).map((x) => ({ ...x, H: m.H })));
  }
  return out;
}

// A model's own masters first (its size sets the scale), then its `more`.
export const readRowsWith = (model) => {
  const models = [model, ...(model.more ?? [])];
  return (img, slots) => readSlotRows(img, models, slots);
};

// Bright shapes in a strip (8-connected, over 0.4): { x0, x1, y0, y1 }.
function shapesIn(st) {
  const { w, h, data } = st, seen = new Uint8Array(w * h), out = [];
  for (let i = 0; i < w * h; i++) {
    if (data[i] <= 0.4 || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, k = yy * w + xx;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h && data[k] > 0.4 && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    out.push({ x0, x1, y0, y1 });
  }
  return out;
}
// The longest number in a ratio, in characters ("366.50" is 6); in a read row's, its places up to the stock.
const longestIn = (ratio) => Math.max(0, ...ratio.split(/[^\d.]+/).map((w) => w.length));
function ratioLongest(places) {
  let text = "";
  for (const p of places) { if (p.to === "s1") break; text += p.ch; }
  return longestIn(text);
}
// The rows in their slots, without colons (SPEC.md §4.7): `places`, where each list's first row's digits may stand (box
// rows, from the window), `stockX` the box column the game centres every stock on, `x0`/`x1` the list's width. Each
// slot is cut from the gap above its row to the gap below (a row's text is about two thirds of a spacing), and the row is read from the
// line its digit-tall shapes stand on. The stock is the run of digits round `stockX`, as wide left of it as right; the
// ratio, its arrow and colon, everything left of that. A slot with no text gives nothing; text that doesn't read, an
// unread row.
function readSlotRows(img, models, { places, span, stockX, x0, x1 }) {
  const ref = (Array.isArray(models) ? models : [models])[0], P = AT.pitch * span;
  const D = ref.H * (P / ref.P), f = Math.min(1, MAX_H / D), digitH = D * f;
  const drawn = drawAll(mastersFor(models, D), digitH);
  const lv = levels(img), minRange = 0.9 * (lv.fg - lv.bg);
  const out = [], tried = [];
  // Each list as the walk reads it (snip.js's walkFrom): its first slot at a place, and only then the slots under it, to
  // an empty one, an unread row or the "worse than" row (after LEVELS prices). A slot read already isn't read again.
  const at = (y) => {
    const seen = tried.find((t) => Math.abs(t.y - y) <= 0.4 * P);
    if (seen) return seen.row;
    const row = entryInSlot(img, y, x0, x1, stockX, D, f, digitH, drawn, minRange);
    tried.push({ y, row });
    if (row && !out.includes(row)) out.push(row);
    return row;
  };
  for (const place of places) {
    let row = at(place);
    for (let k = 1; row && !row.unread && k <= LEVELS && !/^[<>]/.test(row.text); k++) row = at(row.y + 1 + P);
  }
  return out.sort((a, b) => a.y - b.y);
}
function entryInSlot(img, y, fx0, fx1, stockX, D, f, digitH, drawn, minRange, arrows = true) {
  const unread = (at = y) => ({ text: "?", y: at - 1, chars: [], unread: true });
  let strip = stripOf(img, fx0, fx1, Math.round(y), D, f, minRange), shapes = shapesIn(strip);
  const height = (s) => s.y1 - s.y0 + 1;
  const level = (s) => s.y1 >= strip.bottom - 1.3 * digitH && s.y0 <= strip.bottom + 0.5 * digitH;
  // A shape cut by the strip's side isn't the row's (the player's order card beside the box, its ratio a few pixels
  // higher), nor is one starting past the longest stock (a streak in the box's texture): neither sets the line. Nor is a
  // slot whose only shapes are cut by its side (the box's edge) an unread row.
  const sx = (stockX - fx0) * f;
  const sitting = shapes.filter((s) => level(s) && height(s) >= 0.75 * digitH && s.x0 > 0 && s.x1 < strip.w - 1 && s.x0 <= sx + TEXT_REACH * digitH)
    .map((s) => s.y1 + 1);
  if (!sitting.length) return shapes.some((s) => level(s) && height(s) >= 0.35 * digitH && s.x0 > 0 && s.x1 < strip.w - 1) ? unread() : null;
  let bottom = Math.round(y);
  if (Math.min(...sitting) !== strip.bottom) {
    bottom = Math.round(y + (Math.min(...sitting) - strip.bottom) / f);
    strip = stripOf(img, fx0, fx1, bottom, D, f, minRange);
    shapes = shapesIn(strip);
  }
  const STEP = 0.9, SPACE = 1.9;
  const big = shapes.filter((s) => level(s) && height(s) >= 0.62 * digitH && s.y1 + 1 >= strip.bottom - 0.25 * digitH && s.y1 + 1 <= strip.bottom + 0.4 * digitH)
    .sort((a, b) => a.x0 - b.x0);
  const marks = shapes.filter((s) => level(s) && height(s) < 0.45 * digitH && s.y1 >= strip.bottom - 0.35 * digitH);
  // The stock: the digits from the one nearest its centre out to the right while they're a digit's step apart; its left
  // edge about as far left of the centre as its right edge is right of it, at the space there: a gap at least SPACE_MIN
  // wide with no comma or point at its foot (gaps within a number are 0.31 of a digit at most, or have a mark; the space
  // before a stock is 0.35 or more, even an 8-digit one's), the widest of those with the stock starting within a digit
  // of the mirrored edge, which a few pixels' error in the centre can put inside a long stock's thin leading "1,". In
  // small text a pixel is a third of a digit's gap, so it's the widest, not the nearest.
  const near = big.filter((s) => s.x1 >= sx - 0.6 * digitH).sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - sx) - Math.abs((b.x0 + b.x1) / 2 - sx))[0];
  if (!near) return unread(bottom);
  let right = near.x1;
  for (const s of big) if (s.x0 > right && s.x0 - right <= STEP * digitH) right = Math.max(right, s.x1);
  const mirrored = 2 * sx - right, marked = (a, b) => marks.some((m) => (m.x0 + m.x1) / 2 > a && (m.x0 + m.x1) / 2 < b);
  const gap = big.slice(1).map((s, i) => [big[i].x1, s.x0]).filter(([a, b]) => b - a >= SPACE_MIN * digitH && !marked(a, b) && Math.abs(b - mirrored) <= digitH)
    .sort((g, h) => h[1] - h[0] - (g[1] - g[0]))[0];
  const stock = Math.max(0, gap ? gap[1] - 1 : Math.round(mirrored) - 1), apart = gap && gap[1] - gap[0] < APART[0] * digitH ? CLOSE : APART;
  // The ratio: the digits left of the stock (the space before it is 1.7 to 4.8 digits), back while each is within a
  // digit's step of the next, but for one wider gap, up to SPACE: the colon's, its dots often too faint to be shapes.
  // Specks, and the box's edge, lie beyond.
  let edge = stock, lo = null, wide = null;
  for (const s of big.filter((s) => s.x1 < stock).sort((a, b) => b.x1 - a.x1)) {
    const gap = edge - s.x1;
    if (lo != null && gap > STEP * digitH) { if (wide || gap > SPACE * digitH) break; wide = [s.x1, edge]; }
    lo = s.x0; edge = Math.min(edge, s.x0);
  }
  const mid = strip.bottom - 0.5 * digitH;
  // Not a shape cut by the strip's side: a sliver of the box's edge, which arrows sit well inside.
  const arrow = !arrows ? null : shapes.filter((s) => lo != null && s.x0 > 0 && s.x1 < lo && lo - s.x1 <= 1.9 * digitH && height(s) >= 0.35 * digitH && height(s) < 0.9 * digitH
    && Math.abs((s.y0 + s.y1 + 1) / 2 - mid) <= 0.3 * digitH).sort((a, b) => b.x1 - a.x1)[0];
  if (arrow) lo = arrow.x0;
  if (lo == null) return unread(bottom);
  lo = Math.max(0, Math.floor(lo) - 1);
  const hi = Math.min(strip.w - 1, Math.ceil(right) + 1);
  for (let yy = 0; yy < strip.h; yy++) for (let xx = 0; xx < strip.w; xx++) if (xx < lo || xx > hi) strip.data[yy * strip.w + xx] = 0;
  // The colon sits in the middle of the wide gap; its lower dot isn't a point.
  const cx = wide ? (wide[0] + wide[1]) / 2 : null, m = Math.max(1, 0.15 * digitH);
  const foot = marks.filter((s) => s.x0 >= lo && s.x1 <= hi && (cx == null || Math.abs((s.x0 + s.x1) / 2 - cx) > m))
    .map((s) => ({ chars: ".,", lo: s.x0 - 1, hi: s.x0 + 1, low: s.y0 - strip.bottom > LOW_MARK * digitH }));
  const hints = [...(cx != null ? [{ chars: ":", lo: Math.floor(cx) - 2, hi: Math.ceil(cx) + 1 }] : []), ...foot,
    ...(arrow ? [{ chars: "<>", lo: arrow.x0 - 1, hi: arrow.x0 + 1 }] : [])];
  let got = fit(strip, drawn, digitH, hints, 0, apart, { stock });
  if (got.places?.some((p) => drawn[p.v].small) && ratioLongest(got.places) < 5) got = { ...got, ...path(strip.w, drawn, digitH, got.at, got.bgCost, null, got.starts, null, true, apart), noSmall: true };
  if (got.places?.some((p) => drawn[p.v].small) && !got.noSmall) {
    const low = fit(strip, drawn, digitH, hints, Math.round((1 - RATIO_SMALL) * digitH), apart, { stock, again: got.at });
    if (low.places?.some((p) => drawn[p.v].small) && ratioLongest(low.places) >= 5 && low.cost < got.cost) got = low;
  }
  const row = got.places ? rowOf({ digitH: D, baseline: bottom - 1 }, strip, got, drawn, digitH, f, hints) : null;
  if (row && /^[<>]?([\d.]+:1|1:[\d.]+) [1-9][\d,]*$/.test(row.text)) return { ...row, y: bottom - 1 };
  // A speck taken for an arrow spoils the row: read again without one.
  return arrow ? entryInSlot(img, y, fx0, fx1, stockX, D, f, digitH, drawn, minRange, false) : unread(bottom);
}

// ---------- shipping the masters (data/glyphs.json's `rows`) ----------
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// The masters (grey levels as bytes), the header banners and the column heads (int8), as JSON.
// `more`: masters from other frames ({ H, P, masters }), for characters the model's own frame doesn't have.
export function packModel({ H, P, masters, banners, heads, more = [] }) {
  const pack = (list) => list.map(({ ch, w, h, top, small, data }) => ({ ch, w, h, top, ...(small ? { small } : {}), data: b64(Array.from(data, (v) => Math.round(v * 255))) }));
  return {
    H, P, masters: pack(masters),
    banners: banners && Object.fromEntries(Object.entries(banners).map(([k, v]) => [k, b64(Array.from(v, (x) => (Math.round(x * 127) + 256) % 256))])),
    heads: heads && Object.fromEntries(Object.entries(heads).map(([k, v]) => [k, b64(Array.from(v, (x) => (Math.round(x * 127) + 256) % 256))])),
    more: more.map((m) => ({ H: m.H, P: m.P, masters: pack(m.masters) })),
  };
}
export function unpackModel({ H, P, masters, banners, heads, more = [] }) {
  const unpack = (list) => list.map((m) => ({ ...m, data: Float32Array.from(unb64(m.data), (v) => v / 255) }));
  return {
    H, P, masters: unpack(masters),
    banners: banners && Object.fromEntries(Object.entries(banners).map(([k, v]) => [k, Float32Array.from(new Int8Array(unb64(v).buffer), (x) => x / 127)])),
    heads: heads && Object.fromEntries(Object.entries(heads).map(([k, v]) => [k, Float32Array.from(new Int8Array(unb64(v).buffer), (x) => x / 127)])),
    more: more.map((m) => ({ H: m.H, P: m.P, masters: unpack(m.masters) })),
  };
}
// The lists in a frame (ImageData, and its luminance), within the game's window, row by row from each list's place.
// `wins`: the window's buttons where they're known already (findWindows' form), instead of looking for them.
// `style`: the game's window (js/game.js, `window`). `first`: the rows of the first window's hover box, when they're read
// already (rowsAt's, joined by joinRows).
export const findAll = (imageData, img, model, wins = null, style = "poe1", first = null) =>
  findListsIn(imageData, img, { readRowsIn: readRowsWith(model), banners: model.banners, heads: model.heads, wins, style, first });

// Some of the lists' rows in the window's hover box (snip.js, hoverBoxOf), read from the places in `which` only (indices
// into its slots' places: 0 and 1 Available's, 2 Competing's), so the lists can be read apart. null with no hover box.
export function rowsAt(img, model, win, which) {
  const at = hoverBoxOf(img, win);
  if (!at) return null;
  const box = cropLum(img, at.x0, at.y0, at.x1 - at.x0, at.y1 - at.y0);
  return readSlotRows(box, [model, ...(model.more ?? [])], { ...at.slots, places: which.map((k) => at.slots.places[k]) });
}
// Rows read apart (rowsAt's) as one read reads them: a row in `b` that's in `a` already (within 0.4 of a row spacing) is
// the same row.
export function joinRows(a, b, win) {
  const P = AT.pitch * (win.right - win.left);
  return [...a, ...b.filter((r) => !a.some((q) => Math.abs(q.y - r.y) <= 0.4 * P))].sort((x, y) => x.y - y.y);
}
