// Building data/glyphs.json from the test frames (tests/snip.html): the line reader, which finds each character of a
// line and compares it with examples of the game's font (0-9 and < > by shape; ". , :" by size and position), with its
// examples in tests/lines.json; the row reader's masters (js/rows.js) and the names' letters, learnt with it; and their
// packing as JSON. Never loaded by the site: the reader (js/reader.js) only reads with what's built.
import { components, CUTS, GRID, levels, unit } from "./snip.js";
import { longestIn } from "./rows.js";

// A glyph's grey levels on the grid, scaled so its line's digit height fills it (a "1" stays narrow), as a
// zero-mean unit vector for correlation.
function glyphVector(img, c, digitH, { bg, fg }) {
  // Centred on the glyph's brightness, not its box: dimmer text (the Stock column) thresholds a pixel narrower.
  let sum = 0, sumX = 0;
  for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
    const a = Math.max(0, img.lum[y * img.w + x] - bg);
    sum += a; sumX += a * (x + 0.5);
  }
  const cx = sum ? sumX / sum : (c.x0 + c.x1 + 1) / 2;
  const top = c.y1 + 1 - digitH; // bottom-aligned
  const s = digitH / GRID; // image pixels per grid cell
  const at = (x, y) => (x < c.x0 - 1 || x > c.x1 + 1 || x < 0 || y < 0 || x >= img.w || y >= img.h ? bg : img.lum[y * img.w + x]);
  const v = new Float32Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    const sx = cx + (gx + 0.5 - GRID / 2) * s - 0.5, sy = top + (gy + 0.5) * s - 0.5;
    const x = Math.floor(sx), y = Math.floor(sy), fx = sx - x, fy = sy - y;
    const val = (1 - fy) * ((1 - fx) * at(x, y) + fx * at(x + 1, y)) + fy * ((1 - fx) * at(x, y + 1) + fx * at(x + 1, y + 1));
    v[gy * GRID + gx] = Math.max(0, Math.min(1, (val - bg) / (fg - bg)));
  }
  return unit(v);
}

// Best correlation of a with b shifted up to one grid cell left or right.
function match(a, b) {
  let best = -1;
  for (let dx = -1; dx <= 1; dx++) {
    let s = 0;
    for (let y = 0; y < GRID; y++) for (let x = Math.max(0, dx); x < GRID + Math.min(0, dx); x++) s += a[y * GRID + x] * b[y * GRID + x - dx];
    best = Math.max(best, s);
  }
  return best;
}

// Text lines: { comps (left to right; marks merged), digitH, baseline }. Each comp's `m` is its word's
// { digitH, baseline }: a long ratio is drawn smaller than the stock beside it ("2500.10 : 1   250,010").
export function segment(img, cut) {
  const lv = levels(img, cut);
  const { w, h, lum } = img;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = lum[i] > lv.t ? 1 : 0;
  // Straight lines far longer than any stroke of a digit are the box's frame and row lines, not text: a loose
  // box takes in the frame, whose sides would join every row into one.
  const long = Math.max(60, 0.12 * Math.min(w, h));
  const clearRuns = (n, len, at) => {
    for (let i = 0; i < n; i++) {
      let start = -1;
      for (let j = 0; j <= len; j++) {
        if (j < len && mask[at(i, j)]) { if (start < 0) start = j; continue; }
        if (start >= 0 && j - start > long) for (let k = start; k < j; k++) mask[at(i, k)] = 0;
        start = -1;
      }
    }
  };
  clearRuns(w, h, (x, y) => y * w + x); // vertical
  clearRuns(h, w, (y, x) => y * w + x); // horizontal
  for (let y = 0; y < h; y++) {
    // A row separator line runs most of the width: drop it.
    let lit = 0;
    for (let x = 0; x < w; x++) lit += mask[y * w + x];
    if (lit > 0.5 * w) for (let x = 0; x < w; x++) mask[y * w + x] = 0;
  }
  // Lines are grouped from the shapes themselves, by where each sits, rather than cut across the whole width:
  // scenery beside a loosely boxed list would otherwise join its rows. A shape joins a line when each one's
  // middle falls within the other; marks (dots, commas) join the line they sit nearest.
  const height = (c) => c.y1 - c.y0 + 1;
  const mid = (c) => (c.y0 + c.y1) / 2;
  const shapes = components(mask, w, 0, h).filter((c) => c.n >= 2 && height(c) <= Math.max(40, 0.15 * h) && c.x1 - c.x0 < 6 * Math.max(height(c), 3));
  const groups = [];
  for (const c of shapes.filter((c) => height(c) >= 5).sort((a, b) => a.y0 - b.y0)) {
    const g = groups.find((l) => mid(c) >= l.y0 && mid(c) <= l.y1 && l.mid >= c.y0 && l.mid <= c.y1);
    if (g) g.comps.push(c);
    else groups.push({ y0: c.y0, y1: c.y1, mid: mid(c), comps: [c] });
  }
  // A comma or dot can be tall enough to start a group of its own: one under 0.6 of a line's height, sitting
  // on it, joins it (scenery and text lines don't: they're taller).
  const joinNearest = (mid, size) => {
    const off = (l) => Math.max(l.y0 - mid, mid - l.y1, 0);
    const fits = groups.filter((l) => size < 0.6 * (l.y1 - l.y0 + 1) && off(l) <= 0.3 * (l.y1 - l.y0 + 1));
    return fits.reduce((best, l) => (!best || off(l) < off(best) ? l : best), null);
  };
  for (const g of [...groups].sort((a, b) => a.y1 - a.y0 - (b.y1 - b.y0))) {
    const size = Math.max(...g.comps.map(height));
    const into = joinNearest(g.mid, size);
    if (into && into !== g) { into.comps.push(...g.comps); groups.splice(groups.indexOf(g), 1); }
  }
  for (const c of shapes.filter((c) => height(c) < 5)) {
    const g = joinNearest(mid(c), 0) ?? null;
    if (g) g.comps.push(c);
  }
  const lines = [];
  for (const { comps } of groups.sort((a, b) => a.y0 - b.y0)) {
    const heights = comps.map((c) => c.y1 - c.y0 + 1).sort((a, b) => a - b);
    const digitH = heights[heights.length - 1 - Math.floor(heights.length / 4)];
    if (digitH < 5) continue;
    const bottoms = comps.filter((c) => c.y1 - c.y0 + 1 >= 0.7 * digitH).map((c) => c.y1).sort((a, b) => a - b);
    const baseline = bottoms[Math.floor(bottoms.length / 2)];
    // The colon's two dots overlap horizontally: one mark.
    const small = (c) => c.y1 - c.y0 + 1 < 0.5 * digitH;
    const merged = [];
    for (const c of comps.sort((a, b) => a.x0 - b.x0)) {
      const last = merged.at(-1);
      if (last && small(c) && last.parts.every(small) && c.x0 <= last.x1) {
        last.parts.push(c);
        last.x0 = Math.min(last.x0, c.x0); last.x1 = Math.max(last.x1, c.x1);
        last.y0 = Math.min(last.y0, c.y0); last.y1 = Math.max(last.y1, c.y1);
      } else merged.push({ ...c, parts: [c] });
    }
    // Words: runs of comps with no wide gap. A word of marks only (a colon) uses the line's size.
    const line = { digitH, baseline };
    const words = [];
    for (let i = 0; i < merged.length;) {
      let j = i + 1;
      while (j < merged.length && merged[j].x0 - merged[j - 1].x1 <= 0.5 * digitH) j++;
      const word = merged.slice(i, j);
      const wh = Math.max(...word.map((c) => c.y1 - c.y0 + 1));
      let m = line;
      if (wh >= 0.5 * digitH) {
        const wb = word.filter((c) => c.y1 - c.y0 + 1 >= 0.7 * wh).map((c) => c.y1).sort((a, b) => a - b);
        m = { digitH: wh, baseline: wb[Math.floor(wb.length / 2)] };
      }
      for (const c of word) c.m = m;
      words.push({ word, m, h: wh });
      i = j;
    }
    // The "worse than" arrow starts a row on its own and is shorter than a digit: it's sized by the ratio after it.
    const [first, next] = words;
    if (next && first.word.length === 1 && first.h < 0.85 * next.m.digitH) first.word[0].m = next.m;
    lines.push({ comps: merged, digitH, baseline });
  }
  return { lines, lv, mask };
}

// What a component is by size and position: ":" (two stacked dots), a separator ("." or ",", told apart by the
// digits after it), null for noise, or undefined for a glyph to match.
const SEP = "_";
export function markOf(c, { digitH, baseline }) {
  const hgt = c.y1 - c.y0 + 1;
  if (c.parts.length >= 2) return hgt > 0.35 * digitH ? ":" : null;
  if (hgt >= 0.5 * digitH) return undefined;
  return c.y1 >= baseline - 0.2 * digitH ? SEP : null;
}

const MIN_SCORE = 0.55; // below this a glyph is unreadable ("?"), so its line won't parse
const SPLIT_SCORE = 0.6; // a piece of a split glyph must match better: header letters split into digit-like bits
const MARGIN = 0.03; // the best character must beat the next best by this much, or it's a guess: unreadable

// Each text line as read, e.g. "1:2.90 19" or "<1:3.33 182". Lines that aren't list rows read as junk.
export function readLines(img, glyphs, cut = CUTS[0]) {
  const { lines, lv, mask } = segment(img, cut);
  // The best glyph for a box and its score; "?" under MIN_SCORE.
  const glyphOf = (c, ln) => {
    const v = glyphVector(img, c, ln.digitH, lv), aspect = (c.x1 - c.x0 + 1) / ln.digitH; // ln: the glyph's word
    // Shape, less a penalty for a different width (a "1" is far narrower than a "4"), best per character.
    // A shape can match at most 1, so one whose width alone puts it under MIN_SCORE - MARGIN can't win or come
    // close enough to matter: skipped, which leaves scenery (rarely digit-shaped) little to compare.
    const byChar = {};
    for (const g of glyphs) {
      const off = 2 * Math.abs(aspect - g.aspect);
      if (1 - off < MIN_SCORE - MARGIN) continue;
      const d = match(v, g.v) - off;
      if (!(d <= byChar[g.ch])) byChar[g.ch] = d;
    }
    const [[ch, score] = ["?", -1], [, next] = [null, -1]] = Object.entries(byChar).sort((x, y) => y[1] - x[1]);
    // In small text a 2 and an 8 can be close: too close to call is unreadable, never a guess.
    return score < MIN_SCORE || score - next < MARGIN ? { ch: "?", score } : { ch, score };
  };
  // The lit pixels of `c` within columns [xa, xb], as a box (null if none).
  const part = (c, xa, xb) => {
    let p = null;
    for (let y = c.y0; y <= c.y1; y++) for (let x = xa; x <= xb; x++) {
      if (!mask[y * img.w + x]) continue;
      if (!p) p = { x0: x, x1: x, y0: y, y1: y, n: 0 };
      p.x0 = Math.min(p.x0, x); p.x1 = Math.max(p.x1, x); p.y0 = Math.min(p.y0, y); p.y1 = Math.max(p.y1, y); p.n++;
    }
    return p;
  };
  const isDot = (p, ln) => p.y1 - p.y0 + 1 <= 0.4 * ln.digitH && p.x1 - p.x0 + 1 <= 0.45 * ln.digitH
    && p.y1 >= ln.baseline - 0.2 * ln.digitH;
  // Small text can draw neighbours touching: a decimal point tucked under the next digit ("1.27" as 1 and ".2")
  // or two digits. A glyph that doesn't match is tried as two or three pieces, each a glyph that matches or a
  // dot; the split whose weakest glyph matches best wins.
  const pieceOf = (p, ln) => {
    if (isDot(p, ln)) return { ch: SEP, score: 1 };
    const g = glyphOf(p, ln);
    return g.score >= SPLIT_SCORE ? g : { ch: "?", score: 0 };
  };
  const split = (c, ln) => {
    // Only what could be two or three touching characters: scenery in a loose snip is full of big shapes, and
    // trying every way to cut those took minutes.
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (h < 0.6 * ln.digitH || h > 1.4 * ln.digitH || w > 3.2 * ln.digitH) return "?";
    // Cut only at the edges of thin stretches (at most 40% of the fullest column lit): where a dot starts and ends.
    const lit = [];
    for (let x = c.x0; x <= c.x1; x++) {
      let n = 0;
      for (let y = c.y0; y <= c.y1; y++) n += mask[y * img.w + x];
      lit.push(n);
    }
    const thin = (x) => lit[x - c.x0] <= Math.max(...lit) * 0.4;
    const at = [];
    for (let x = c.x0 + 1; x <= c.x1; x++) if (thin(x) !== thin(x - 1)) at.push(x);
    if (at.length > 8) return "?"; // not a few characters
    // And either side of a bridge one pixel thin: a 7's top bar touching the next 1's flag, all of it thin.
    const bridge = (x) => lit[x - c.x0] <= 1;
    for (let x = c.x0 + 1; x <= c.x1; x++) if ((bridge(x) || bridge(x - 1)) && !at.includes(x)) at.push(x);
    at.sort((a, b) => a - b);
    if (at.length > 12) return "?";
    const seen = new Map(); // each slice is read once, however many splits share it
    const pieceAt = (xa, xb) => {
      const k = `${xa}|${xb}`;
      if (!seen.has(k)) { const p = part(c, xa, xb); seen.set(k, p && pieceOf(p, ln)); }
      return seen.get(k);
    };
    let best = null;
    const consider = (cuts) => {
      const edges = [c.x0, ...cuts, c.x1 + 1];
      const pieces = [];
      for (let i = 0; i + 1 < edges.length; i++) {
        const r = pieceAt(edges[i], edges[i + 1] - 1);
        if (!r || r.ch === "?") return;
        pieces.push(r);
      }
      // One dot, not two halves; nor two separators in three pieces (they're 2 or 3 digits apart): a 2's tail cut off
      // as a "dot" read ".25" as ".2.5".
      if (pieces.filter((r) => r.ch === SEP).length > 1) return;
      if (pieces.every((r) => r.ch === SEP)) return;
      const score = Math.min(...pieces.map((r) => r.score));
      if (!best || score > best.score) best = { ch: pieces.map((r) => r.ch).join(""), score };
    };
    at.forEach((a, i) => {
      consider([a]);
      for (const b of at.slice(i + 1)) consider([a, b]);
    });
    return best?.ch ?? "?";
  };
  return lines.map((ln) => {
    let s = "", prevX1 = null;
    const chars = []; // what each character read as, where, and how tall
    for (const c of ln.comps) {
      const mark = markOf(c, c.m);
      if (mark === null) continue;
      if (prevX1 !== null && c.x0 - prevX1 > 0.9 * ln.digitH) s += " ";
      prevX1 = c.x1;
      if (mark) { s += mark; chars.push({ ch: mark, x0: c.x0, x1: c.x1, h: c.y1 - c.y0 + 1 }); continue; }
      const g = glyphOf(c, c.m);
      const ch = g.ch !== "?" ? g.ch : split(c, c.m);
      s += g.ch !== "?" ? ch : ch.replaceAll(SEP, "~"); // "~": a separator split off a shape, for the check below
      chars.push({ ch, x0: c.x0, x1: c.x1, h: c.y1 - c.y0 + 1 });
    }
    // A separator split off a shape with one digit after it is a digit's tail ("47,922" read as "47.92_2").
    s = s.replace(/~(?=\d(?!\d))/g, "").replaceAll("~", SEP);
    // A separator before exactly 3 digits groups thousands (2,544); before 2 it's a decimal point (2.90). One that
    // ends a number is neither: the half-seen lower dot of a dim colon ("1.75_ 1").
    s = s.replace(/_(?=\d{3}(?!\d))/g, ",").replace(/_(?=\d{2}(?!\d))/g, ".").replace(/(\d)_+(?= |$)/g, "$1")
      .replace(/(^| )_+ /g, "$1"); // nor one on its own: a speck of the box's frame
    // The game spaces "1 : 3" round the colon, and "< 1" after the arrow.
    s = s.replace(/ ?: ?/g, ":").replace(/^([<>]) /, "$1").trim();
    // In small text the colon's dots are too dim to see, but a row is always three numbers: "1.33 1 4" is 1.33 : 1.
    const bare = !s.includes(":") && s.match(/^([<>]?)([\d.,]+) ([\d.,]+) ([\d.,]+)$/);
    return { text: bare ? `${bare[1]}${bare[2]}:${bare[3]} ${bare[4]}` : s, y: ln.baseline, chars, ln };
  }).filter((l) => l.text);
}

// Glyph examples from a snip whose lists are known ([["1:2.90 19", ...], [...]], each top to bottom). A line's
// layout must fit its row: split at its widest gap, its ratio and stock have that row's numbers of glyphs ("1:3.50
// 6" is 4 and 1). And a list's rows are found as one evenly spaced run of fitting lines (its first row may not fit,
// with touching characters, so the run is placed by whichever rows do): a header that only looks like some row ("Ratio  Stock" read as 2 and 3 shapes, like "1:4 168") sits off
// that run, so it can't take a row's labels and shift every row after it, teaching a 5 as a 6. Rows whose line
// isn't found are passed over. Returns the number of rows used. Run clean() once all snips are learned.
// Learned at whichever cut (CUTS) fits more rows: small text's touching characters fit at the higher one.
export function learn(img, known, glyphs) {
  const [best] = CUTS.map((cut) => learnAt(img, known, cut)).sort((a, b) => b.used - a.used);
  glyphs.push(...best.glyphs);
  return best.used;
}
function learnAt(img, known, cut) {
  const glyphs = [];
  const { lines, lv } = segment(img, cut);
  const glyphsOf = (t) => t.replace(/[ .,:]/g, "").split("");
  const shapeOf = (r) => { const [ratio, stock = ""] = r.split(" "); return `${glyphsOf(ratio).length}|${glyphsOf(stock).length}`; };
  const read = lines.map((ln) => {
    const comps = [...ln.comps].sort((a, b) => a.x0 - b.x0);
    const tall = comps.filter((c) => markOf(c, c.m) === undefined);
    // the widest gap between neighbouring characters parts the ratio from the stock
    let cut = 0;
    for (let i = 1; i < comps.length; i++) if (!cut || comps[i].x0 - comps[i - 1].x1 > comps[cut].x0 - comps[cut - 1].x1) cut = i;
    const split = cut ? comps[cut].x0 : Infinity;
    return { y: ln.baseline, ln, tall, shape: `${tall.filter((c) => c.x0 < split).length}|${tall.filter((c) => c.x0 >= split).length}` };
  });
  const taken = new Set();
  let used = 0;
  for (const rows of known) {
    const shapes = rows.map(shapeOf);
    // the evenly spaced run of fitting lines that fits the most rows, from a line fitting some row and the next
    // (the first row may not fit: touching characters in its stock)
    let best = [];
    for (let k0 = 0; k0 < Math.max(1, rows.length - 1); k0++) for (const a of read.filter((l) => l.shape === shapes[k0] && !taken.has(l))) {
      const steps = rows.length < 2 ? [null] : read.filter((l) => l.y > a.y && l.shape === shapes[k0 + 1] && !taken.has(l)).map((l) => l.y - a.y);
      for (const pitch of steps) {
        const run = [];
        for (let k = 0; k < rows.length; k++) {
          const l = k === k0 ? a : pitch && read.find((x) => !taken.has(x) && x.shape === shapes[k] && Math.abs(x.y - (a.y + (k - k0) * pitch)) <= 0.25 * pitch);
          if (l) run.push([l, k]);
        }
        if (run.length > best.length) best = run;
      }
    }
    for (const [l, k] of best) {
      taken.add(l);
      const row = Symbol("row"), labels = glyphsOf(rows[k]);
      l.tall.forEach((c, i) => glyphs.push({ ch: labels[i], v: glyphVector(img, c, c.m.digitH, lv), aspect: (c.x1 - c.x0 + 1) / c.m.digitH, row }));
      used++;
    }
  }
  return { glyphs, used };
}

// Drops learned rows with a glyph far wider or narrower than that character usually is: touching characters
// ("1.27" with the dot under the 2) or a row whose glyph count only matched by chance would teach wrong shapes.
export function clean(glyphs, tolerance = 0.3) {
  const widths = {};
  for (const g of glyphs) (widths[g.ch] ??= []).push(g.aspect);
  const median = {};
  for (const [ch, a] of Object.entries(widths)) median[ch] = a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const bad = new Set(glyphs.filter((g) => Math.abs(g.aspect - median[g.ch]) > tolerance * median[g.ch]).map((g) => g.row));
  return glyphs.filter((g) => !bad.has(g.row));
}

// tests/lines.json stores each example's grid as signed bytes (base64).
export function packGlyphs(glyphs) {
  const pack = (list) => list.map(({ ch, v, aspect }) => {
    const max = Math.max(...v.map(Math.abs)) || 1;
    const bytes = Int8Array.from(v, (a) => Math.round((a / max) * 127));
    return { ch, aspect: Math.round(aspect * 1000) / 1000, v: btoa(String.fromCharCode(...new Uint8Array(bytes.buffer))) };
  });
  return { glyphs: pack(glyphs) };
}
export function unpackGlyphs({ glyphs }) {
  return glyphs.map(({ ch, aspect, v }) => {
    const bytes = new Int8Array(Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer);
    return { ch, aspect, v: unit(Float32Array.from(bytes)) };
  });
}

// A line's pieces grouped into characters: pieces overlapping in x are one (an i and its dot).
function charsOf(line) {
  const out = [];
  for (const p of line.pieces) {
    const u = out.at(-1);
    if (u && p.x0 <= u.x1 - 0.2 * (p.x1 - p.x0 + 1)) { u.x1 = Math.max(u.x1, p.x1); u.x0 = Math.min(u.x0, p.x0); }
    else out.push({ x0: p.x0, x1: p.x1 });
  }
  return out;
}

// Letter samples from boxes whose names are known ([{ text: nameText(...), name }]): each character's columns, width
// and the gap after it, in letter heights, and the space between words. A word's pieces are its letters, but where
// letters touch (fewer pieces than letters) a piece is split between them by the widths of letters already learned:
// names whose letters are all apart go first. A name whose words can't be laid out is skipped (`skipped` says why).
export function learnNames(samples) {
  const by = {}, spaces = [], skipped = [];
  const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  // A text's characters in words: within a line, a gap over 0.3 letter heights starts a new word.
  const wordsOf = (text) => text.lines.flatMap((line) => {
    const cs = charsOf(line), ws = [];
    cs.forEach((c, i) => (i && c.x0 - cs[i - 1].x1 - 1 > 0.3 * text.lh ? ws.push([c]) : (ws.at(-1) ?? ws[ws.push([]) - 1]).push(c)));
    return ws.map((w) => ({ line, chars: w }));
  });
  const take = (ch, line, x0, x1, lh, gap) =>
    (by[ch] ??= []).push({ cols: line.cols.slice(x0 - line.x0, x1 - line.x0 + 1), w: (x1 - x0 + 1) / lh, gap });
  const pass = (split) => {
    const widthOf = (ch) => median((by[ch] ?? []).map((x) => x.w)) ?? 0.55;
    for (const { text, name } of samples) {
      if (!text?.lines.length) continue;
      const words = name.split(" "), found = wordsOf(text);
      if (found.length !== words.length) { if (split) skipped.push(`${name}: ${found.length} words read for ${words.length}`); continue; }
      if (found.every((f, i) => f.chars.length === words[i].length) === split) continue;
      found.forEach((f, wi) => {
        const want = [...words[wi]], lh = text.lh;
        if (wi < found.length - 1 && found[wi + 1].line === f.line) spaces.push((found[wi + 1].chars[0].x0 - f.chars.at(-1).x1 - 1) / lh);
        // Each piece takes a run of 1-3 of the word's letters, whichever fit the pieces' widths best.
        const n = f.chars.length, m = want.length, cost = [], back = [];
        for (let i = 0; i <= n; i++) { cost.push(new Array(m + 1).fill(Infinity)); back.push(new Array(m + 1).fill(0)); }
        cost[0][0] = 0;
        for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) for (let k = 1; k <= Math.min(3, j); k++) {
          const u = f.chars[i - 1], w = (u.x1 - u.x0 + 1) / lh;
          const c = cost[i - 1][j - k] + (w - want.slice(j - k, j).reduce((s, ch) => s + widthOf(ch), 0)) ** 2 + (k > 1 ? 0.05 : 0);
          if (c < cost[i][j]) { cost[i][j] = c; back[i][j] = k; }
        }
        if (cost[n][m] === Infinity) { skipped.push(`${name}: "${words[wi]}" can't be laid out`); return; }
        const runs = [];
        for (let i = n, j = m; i > 0; j -= back[i][j], i--) runs.unshift(back[i][j]);
        let j = 0;
        f.chars.forEach((u, i) => {
          const k = runs[i], cs = want.slice(j, j + k), total = cs.reduce((s, ch) => s + widthOf(ch), 0);
          let x = u.x0;
          cs.forEach((ch, q) => {
            const x1 = q === k - 1 ? u.x1 : Math.round(x + ((u.x1 - u.x0 + 1) * widthOf(ch)) / total) - 1;
            const next = q === k - 1 ? f.chars[i + 1]?.x0 : x1 + 1;
            take(ch, f.line, x, x1, lh, j + q < m - 1 && next != null ? (next - x1 - 1) / lh : null);
            x = x1 + 1;
          });
          j += k;
        });
      });
    }
  };
  pass(false);
  pass(true);
  // Each character's sample nearest its usual width, with its usual gap.
  const letters = {};
  for (const [ch, list] of Object.entries(by)) {
    const w = median(list.map((x) => x.w));
    const pick = list.reduce((a, b) => (Math.abs(b.w - w) < Math.abs(a.w - w) ? b : a));
    letters[ch] = { cols: pick.cols, w, gap: median(list.map((x) => x.gap)) ?? 0.08 };
  }
  return { letters, space: median(spaces) ?? 0.3, skipped };
}

// data/glyphs.json stores the letters' columns as bytes (base64), widths and gaps to 3 decimals.
const round3 = (x) => Math.round(x * 1000) / 1000;
export function packNames({ letters, space }) {
  return {
    space: round3(space),
    letters: Object.entries(letters).map(([ch, { cols, w, gap }]) => ({ ch, w: round3(w), gap: round3(gap),
      cols: btoa(String.fromCharCode(...cols.flatMap((c) => [...c].map((v) => Math.round(v * 255)))) ) })),
  };
}

// ---------- the row reader's masters ----------
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

// ---------- shipping the masters (data/glyphs.json's `rows`) ----------
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
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

// Runs by the rows' spacing: the gap most gaps agree with (within 15%). With one row there's none: it's a run of its own.
// A gap of a whole number of spacings is rows unread inside a run (a cursor over them, say), marked `broken`. The gap
// between the lists is a whole number and about 0.45 (3.45, or 4.45 with the "worse than" row unread), so the fraction
// tells them apart.
export function byGap(rows) {
  const gaps = rows.slice(1).map((r, i) => r.y - rows[i].y);
  let pitch = null, most = 0;
  for (const g of gaps) { const n = gaps.filter((x) => Math.abs(x - g) <= 0.15 * g).length; if (n > most) { most = n; pitch = g; } }
  const runs = [[rows[0]]];
  for (const [i, r] of rows.slice(1).entries()) {
    const k = pitch && (r.y - rows[i].y) / pitch;
    // The "worse than" row is always a list's last: anything below it is something else.
    if (rows[i].worse) runs.push([r]);
    else if (pitch && k <= 1.25) runs.at(-1).push(r);
    else if (pitch && k <= 6.25 && Math.abs(k - Math.round(k)) < 0.2) { runs.at(-1).push(r); runs.at(-1).broken = true; }
    else runs.push([r]);
  }
  return runs;
}
