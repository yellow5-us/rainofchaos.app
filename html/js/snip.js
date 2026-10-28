// Finds the game's Currency Exchange window in a frame, the lists' places in it and the currency names (SPEC.md §4.7);
// the rows themselves are read by js/rows.js. Also the line reader, which finds each character of a line and compares
// it with examples of the game's font (0-9 and < > by shape; ". , :" by size and position): only for building
// data/glyphs.json's row masters from the test frames, with its examples in tests/lines.json.

const GRID = 16; // glyphs are compared on a GRID x GRID grid, scaled to their line's digit height

// Luminance of ImageData: { w, h, lum }.
export function toLum({ width: w, height: h, data }) {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2];
  return { w, h, lum };
}

// Text is the brightest few percent; the panel behind it (parchment, wood, row lines) is mid-dark. Text is what's
// over `cut` of the way from one to the other. Small text draws characters close enough to touch at the usual
// cut (a decimal point joined to the next digit, "484" as one shape): a higher one parts them (CUTS).
const CUTS = [0.5, 0.6];
export function levels(img, cut = CUTS[0]) {
  const sorted = Float32Array.from(img.lum).sort();
  const bg = sorted[Math.floor(sorted.length * 0.5)];
  const fg = sorted[Math.floor(sorted.length * 0.995)];
  return { t: bg + cut * (fg - bg), bg, fg };
}

// Connected components (8-way) of the mask within rows [y0, y1).
function components(mask, w, y0, y1) {
  const seen = new Uint8Array(mask.length);
  const out = [];
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i] || seen[i]) continue;
    const c = { x0: x, x1: x, y0: y, y1: y, n: 0 };
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      const px = j % w, py = (j - px) / w;
      c.n++;
      c.x0 = Math.min(c.x0, px); c.x1 = Math.max(c.x1, px);
      c.y0 = Math.min(c.y0, py); c.y1 = Math.max(c.y1, py);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || nx >= w || ny < y0 || ny >= y1) continue;
        const k = ny * w + nx;
        if (mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    out.push(c);
  }
  return out;
}

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
function unit(v) {
  let mean = 0;
  for (const a of v) mean += a;
  mean /= v.length;
  let norm = 0;
  for (let i = 0; i < v.length; i++) { v[i] -= mean; norm += v[i] * v[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
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

// A list row: "1:2.90 19", "<1:3.33 182", "2500.10:1 250,010", "1:12,500 3".
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d\d)?`; // ratios over 999 have no comma: 2501 : 1
// Stock may have lost a faint comma (26000 for 26,000): the same number either way.
const ROW = new RegExp(String.raw`^([<>])?(${NUM}):(${NUM}) (\d{1,3}(?:,\d{3})+|\d+)$`);
// The row in a line: the one ratio and stock pair among its words, so a speck of frame read before or after it
// ("2630:1 8 _::") doesn't spoil it; three bare numbers are one whose colon was too faint ("2600 1 26000"). null
// unless there's exactly one.
function rowIn(line) {
  const words = line.split(" ");
  const found = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const m = `${words[i]} ${words[i + 1]}`.match(ROW);
    if (m) found.push(m);
    const bare = i + 2 < words.length && /^[<>]?[\d.,]+$/.test(words[i]) && /^[\d.,]+$/.test(words[i + 1])
      && `${words[i]}:${words[i + 1]} ${words[i + 2]}`.match(ROW);
    if (bare) found.push(bare);
  }
  return found.length === 1 ? found[0] : null;
}
const side = (text) => ({ text, value: Number(text.replace(/,/g, "")), digits: (text.split(".")[1] ?? "").length });

// The game lists the best LEVELS prices of each list, then a "worse than" row for the rest.
// LONE_NEAR: how far a lone row's price may be from the other list's best (SPEC.md §4.7): the two lists' best prices are
// within 5x over the test frames (Transmutation's 103 and 500), a dropped decimal point 100x.
export const LEVELS = 5;
const OFF_CENTRE = 0.2, LONE_NEAR = 10;
// Where the lists are: Available's first row, the row spacing, and the lists' left and right edges. With only
// Competing read, Available's place is 8.45 spacings above it, if the game shows Available unread; but with no
// Available trades at all the game moves Competing up into its place, so both are given (`tops`, likeliest first).
// `firstRows`: each list's own first row, null for a list not read. null without positions (tests). The spacing is
// measured on Available's rows, else Competing's; a list of one row has none, so with one row in each read list it's
// the window's (`P`).
function placeOf({ available, competing }, P = null) {
  const all = [...(available ?? []), ...(competing ?? [])];
  if (!all.length || all.some((r) => r.y == null || r.x0 == null)) return null;
  const pitch = [available, competing].map((l) => l && spacing(l)).find((s) => s != null) ?? P;
  const tops = available ? [available[0].y] : [competing[0].y - 8.45 * pitch, competing[0].y];
  return {
    firstY: tops[0], tops, pitch,
    x0: Math.min(...all.map((r) => r.x0)), x1: Math.max(...all.map((r) => r.x1)),
    firstRows: { available: available?.[0].y ?? null, competing: competing?.[0].y ?? null },
  };
}
// A place found in a box cut at (dx, dy), in the whole image's terms.
const moved = (p, dx, dy) => p && {
  ...p, firstY: p.firstY + dy, tops: p.tops.map((t) => t + dy), x0: p.x0 + dx, x1: p.x1 + dx,
  firstRows: Object.fromEntries(Object.entries(p.firstRows).map(([k, y]) => [k, y == null ? null : y + dy])),
};
// The usual gap between rows; each within a quarter of it (unknown positions pass: plain text in tests).
const spacing = (rows) => {
  const gaps = rows.slice(1).map((r, i) => r.y - rows[i].y).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
};
const price = (r) => r.have.value / r.want.value;
// Neighbouring prices in a list are within JUMP of each other. Thin books jump (1 : 1 then 6 : 1; a Mirror's 1 : 65000
// then 1 : 5001); a dropped decimal point jumps 100x, as the game always shows two (2.50 as 250), and so does an absurd
// order (10000 : 1 after 69 : 1). Either way the list ends before the jump (`beforeJump`: how many prices come before
// the first, all of them with none).
const JUMP = 30;
const beforeJump = (prices) => {
  const i = prices.findIndex((p, k) => k > 0 && Math.max(p, prices[k - 1]) / Math.min(p, prices[k - 1]) > JUMP);
  return i < 0 ? prices.length : i;
};
// Prices that move one way down a list, with no jump. Neighbours can show the same price: the game rounds to two
// decimals (7.50 then 7.50).
function orderly(prices) {
  if (!prices.every((p) => p > 0 && Number.isFinite(p))) return false;
  const dir = Math.sign(prices.find((p) => p !== prices[0]) - prices[0]) || 0;
  for (let i = 1; i < prices.length; i++) {
    const step = Math.sign(prices[i] - prices[i - 1]);
    if (step !== 0 && step !== dir) return false;
  }
  return beforeJump(prices) === prices.length;
}
function checks(rows) {
  if (rows.slice(0, -1).some((r) => r.worse)) return false;
  const p = rows.map(price);
  return p.at(-1) === p.at(-2) && orderly(p.slice(0, -1));
}

// Runs by the rows' spacing: the gap most gaps agree with (within 15%). With one row there's none: it's a run of its own.
// A gap of a whole number of spacings is rows unread inside a run (a cursor over them, say), marked `broken`. The gap
// between the lists is a whole number and about 0.45 (3.45, or 4.45 with the "worse than" row unread), so the fraction
// tells them apart.
function byGap(rows) {
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
// Runs read top-down (SPEC.md §4.7): a list's first row is a row read at one of `places` (within SLOT of a spacing
// `P`), with the column heads over it (`first(y)`) and in no other list. Each slot a spacing below the last then holds
// the next row, or is empty (under INK: the list ended), or has text that doesn't read (a cursor, say: an unread row,
// so the list isn't read). A "worse than" row is a list's last, and after LEVELS prices only one that reads is taken.
// Nothing outside the slots joins a list. `inkAt(y)`: how much text a slot whose row would be at y holds.
// Available's bare place comes first: a bare list's second row is near the place under the banner.
const SLOT = 0.3, INK = 40;
export const walkFrom = (places, P, inkAt, first) => Object.assign((rows) => {
  const at = (y) => rows.find((r) => Math.abs(r.y - y) <= SLOT * P);
  const runs = [];
  for (const place of places) {
    const r0 = at(place);
    if (!r0 || r0.unread || runs.some((run) => run.includes(r0)) || !first(r0.y)) continue;
    const run = [r0];
    while (run.length <= LEVELS && !run.at(-1).worse) {
      const y = run.at(-1).y + P, r = at(y);
      if (r && !(run.length === LEVELS && r.unread)) run.push(r);
      else if (run.length < LEVELS && inkAt(y) >= INK) run.push({ unread: true, y });
      else break;
    }
    runs.push(run);
  }
  return runs.sort((a, b) => a[0].y - b[0].y);
}, { P });
// How much text there is over a list's width in the slot of a row at `y` (its line): the 97th percentile of its grey
// levels over their median. A row's text is 52 or more, the panel alone 31 at most.
function inkOf(img, x0, x1, y, P) {
  const v = [];
  for (let yy = Math.max(0, Math.round(y - 0.7 * P)); yy <= Math.min(img.h - 1, Math.round(y + 0.05 * P)); yy++) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.w, x1); x++) v.push(img.lum[yy * img.w + x]);
  }
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v[Math.floor(0.97 * v.length)] - v[v.length >> 1];
}
// The lists from the rows read (SPEC.md §4.7), in runs: by `walk(rows)` (findListsIn's: each list read slot by slot from
// its first row, the window giving the places and the spacing), or without it (plain text in tests) by the rows'
// spacing (`byGap`). Each run is a list: ended by its "worse than" row (< for Available, > for Competing) after exactly
// LEVELS prices, or a thin market's 1 to LEVELS prices with no such row. A run made by spacing that fails the checks
// may have a header read as a row on top: it's tried without that. Two runs are Available then Competing. One run with
// no arrow is told by `which(run)` ("available", "competing" or null: not known, so not read). Returns lists'
// { available, competing, place }. `starts(kind, run)`, when given, says whether a list of that kind may start where
// the run's first row is (a list whose best rows went unread starts lower). A run with an unread row isn't read.
export function groups(lines, which = () => null, starts = null, walk = null) {
  const rows = [];
  for (const line of lines) {
    const { text, y = null, chars = [] } = line;
    // A row that's there (text in its slot) but didn't read: kept in place, its list can't be read.
    if (line.unread && y != null) { rows.push({ unread: true, y }); continue; }
    const m = rowIn(text);
    if (!m || y == null) continue;
    // The stock's digits are the row's last (a comma too faint to see may not be placed).
    const digits = chars.filter((c) => /\d/.test(c.ch)), stock = digits.slice(-m[4].replace(/,/g, "").length);
    rows.push({ worse: m[1] ?? "", want: side(m[2]), have: side(m[3]), stock: Number(m[4].replace(/,/g, "")), y,
      x0: digits.length ? Math.min(...digits.map((c) => c.x0)) : null, x1: digits.length ? Math.max(...digits.map((c) => c.x1)) : null,
      mid: stock.length ? (stock[0].x0 + stock.at(-1).x1) / 2 : null, h: stock[0]?.h ?? null });
  }
  rows.sort((a, b) => a.y - b.y);
  const none = { available: null, competing: null, place: null, rows: rows.length };
  if (!rows.length) return none;
  const runs = walk ? walk(rows) : byGap(rows);
  // The game centres a list's stocks: one off its list's centre by more than OFF_CENTRE of a digit lost a digit (under
  // a cursor: "16,837" read "6,837") or gained one, so its list isn't read. Read right, they're within 0.13.
  const centred = (run) => {
    const mids = run.filter((r) => r.mid != null && r.h), sorted = mids.map((r) => r.mid).sort((a, b) => a - b);
    if (mids.length < 3) return true;
    const med = (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
    return mids.every((r) => Math.abs(r.mid - med) <= OFF_CENTRE * r.h);
  };
  // A run as a list: [kind or null, its price rows, its "worse than" row or null, lone] or null if it doesn't check out.
  // A jump ends the list: the rows above it are the list, without the rows from it on or the "worse than" row. The
  // jump may be a misread, so a misread second row still fails; and one row above it is `lone`, kept only beside the
  // other list with a best price within LONE_NEAR of it (below): a misread best row (a dropped point) is 100x off.
  const asList = (run) => {
    if (run.some((r) => r.unread) || !centred(run)) return null;
    const worse = run.findIndex((r) => r.worse);
    if (worse >= 0 && (worse !== run.length - 1 || worse !== LEVELS)) return null;
    if (worse < 0 && run.length > LEVELS) return null;
    const kind = worse < 0 ? null : run[worse].worse === "<" ? "available" : "competing";
    const rows = worse < 0 ? run : run.slice(0, -1), n = beforeJump(rows.map(price));
    if (n < rows.length) return n >= 2 && orderly(rows.slice(0, n).map(price)) ? [kind, rows.slice(0, n), null] : n === 1 ? [kind, rows.slice(0, 1), null, true] : null;
    if (worse >= 0) return checks(run) ? [kind, rows, run[worse]] : null;
    return rows.length > 1 && !orderly(rows.map(price)) ? null : [null, rows];
  };
  // A run made by spacing that fails the checks may have a header read as a row on top: it's tried without that, which
  // is also what a lone row falls back to (`alt`) if it isn't kept. A walked run starts at its place: never without it.
  const read = runs.filter((run) => !run.broken).map((run) => {
    const whole = asList(run), rest = !walk && run.length > 1 ? asList(run.slice(1)) : null;
    if (whole?.[3] && rest && !rest[3]) whole.alt = rest;
    return whole ?? rest;
  }).filter(Boolean);
  if (runs.some((run) => run.broken) && read.length === 2) return none; // which of two is which needs both whole
  if (read.length > 2) return none; // more than two lists: something else is in the box
  if (read.length === 2) {
    const [[k1], [k2]] = read;
    if ((k1 && k1 !== "available") || (k2 && k2 !== "competing")) return none;
    read[0][0] = "available"; read[1][0] = "competing";
  } else if (read.length === 1 && !read[0][0]) read[0][0] = which(read[0][1]);
  // A lone row (its list cut by a jump right after it) is kept only beside the other list, near its best price.
  const near = (x, y) => Math.max(price(x), price(y)) / Math.min(price(x), price(y)) <= LONE_NEAR;
  for (const [i, r] of read.entries()) {
    if (!r[3] || (read.length === 2 && !read[1 - i][3] && near(r[1][0], read[1 - i][1][0]))) continue;
    if (r.alt) [, r[1], r[2]] = r.alt; else r[0] = null;
  }
  const found = { ...none };
  const took = { available: null, competing: null };
  for (const [kind, list, worse] of read) {
    if (!kind || (starts && !starts(kind, list, read.length))) continue;
    found[kind] = list.map(({ want, have, stock }) => ({ want, have, stock }));
    // The "worse than" row: all the stock at prices beyond the list's last (an order book counts it at that price).
    if (worse) (found.rest ??= {})[kind] = { want: worse.want, have: worse.have, stock: worse.stock };
    took[kind] = list;
  }
  found.place = placeOf(took, walk?.P);
  return found;
}

// A box of a luminance image.
export function cropLum(img, x, y, w, h) {
  const lum = new Float32Array(w * h);
  for (let r = 0; r < h; r++) lum.set(img.lum.subarray((y + r) * img.w + x, (y + r) * img.w + x + w), r * w);
  return { w, h, lum };
}

// ---------- the Currency Exchange window (SPEC.md §4.7) ----------
// Its title bar has two round orange buttons, an "i" at the left and an "x" at the right, the same size, level, and
// about 24.4 button-widths apart (the window scales with the game's UI), with the dark bar between them. They give
// the window's place and size: the market ratio's hover box, with the lists, hangs centred between them, from about
// 0.10 to 0.69 of their spacing below. From ImageData (it needs colour); null if they aren't there (out of
// frame, buttons covered).
export const findWindow = (imageData, style = "poe1") => findWindows(imageData, style)[0] ?? null;
// Every pair of buttons that could be the window's, best (darkest bar between) first, at most 6: an "i" on the left and
// an "x" on the right (buttonIs), level, alike in size, the right distance apart, over a dark bar, with room below for
// the lists. Should anything else still pass, the lists are looked for at each in turn (findListsIn).
export const findWindows = (imageData, style = "poe1") => WINDOWS[style].find(imageData).slice(0, 6).map(({ dark, ...win }) => win);
// The blobs of `mask`'s pixels, a pixel counting if one is within 2 (a button's glyph splits its disc): each with how
// many of `mask`'s pixels it has (`n`) and its bounds.
function blobsOf(mask, w, h) {
  const near = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) near.fill(1, yy * w + Math.max(0, x - 2), yy * w + Math.min(w, x + 3));
  }
  const seen = new Uint8Array(w * h), out = [];
  for (let i = 0; i < w * h; i++) {
    if (!near[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let n = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w;
      if (mask[j]) n++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) if (k >= 0 && k < w * h && near[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
    out.push({ n, x0, x1, y0, y1 });
  }
  return out;
}
// Path of Exile 1's: orange discs with dark glyphs.
function findWindows1({ data, width: w, height: h }) {
  const warm = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[4 * i], g = data[4 * i + 1], b = data[4 * i + 2];
    // Orange by proportion, not by level: a darker game (its brightness setting, a capture's colours) keeps its hue.
    warm[i] = r >= 60 && r > 1.4 * g && g > 1.2 * b && r - b > 0.55 * r ? 1 : 0;
  }
  const discs = [];
  for (const { n, x0, x1, y0, y1 } of blobsOf(warm, w, h)) {
    const bw = x1 - x0 - 3, bh = y1 - y0 - 3, fill = n / Math.max(1, bw * bh);
    if (bw >= 8 && bh >= 8 && bw / bh > 0.75 && bw / bh < 1.33 && fill > 0.1 && fill < 0.85) discs.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, d: (bw + bh) / 2 });
  }
  const pairs = [];
  for (const a of discs) for (const b of discs) {
    if (b.cx <= a.cx || Math.abs(a.d - b.d) > 0.3 * Math.max(a.d, b.d) || Math.abs(a.cy - b.cy) > 0.25 * a.d) continue;
    // The spacing fits a button size between the two found: either can come out off (a redder "x" with fewer of its
    // pixels warm enough comes out smaller; one touching something orange, bigger).
    const d = (a.d + b.d) / 2, span = b.cx - a.cx;
    if (span < 23 * Math.min(a.d, b.d) || span > 26 * Math.max(a.d, b.d)) continue;
    // The window hangs below its buttons: a pair with no room under it for Available's first row isn't it (at
    // 1280 x 960 the HUD's orange Menu arrow and (i) button, at the foot of the screen, are as far apart).
    if ((a.cy + b.cy) / 2 + AT.available * span > h) continue;
    // The dark title bar between them (its title in the middle), not more icons of a skill bar.
    const y = Math.round((a.cy + b.cy) / 2);
    let dark = 0, n = 0;
    for (let x = Math.round(a.cx + d); x < b.cx - d; x++) for (const yy of [y - Math.round(d / 4), y, y + Math.round(d / 4)]) {
      const k = 4 * (yy * w + x);
      n++;
      if (0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2] < 70) dark++;
    }
    // Each button read on the pair's line, at the pair's size: a pixel matters at 800 x 600 (buttons 16 wide).
    if (dark <= 0.75 * n) continue;
    const ai = { cx: a.cx, cy: y, d }, bx = { cx: b.cx, cy: y, d }, light = Math.max(lightOf(data, w, ai), lightOf(data, w, bx));
    if (buttonIs(data, w, ai, "info", light) && buttonIs(data, w, bx, "close", light)) pairs.push({ left: a.cx, right: b.cx, y, button: d, dark: dark / n, at: AT });
  }
  return pairs.sort((p, q) => q.dark - p.dark);
}
// Path of Exile 2's buttons are dark discs with light glyphs, ringed in gold: the "x" on dark red, the "i" on dark
// brown (not orange enough for the above). The "x" is found by its red (inside the ring, about 0.74 of the button),
// and the "i" left of it on its line, 21 to 27 buttons away: a light upright stroke with nothing light either side.
// Then the same dark title bar between them, and room below for Available's first row.
function findWindows2({ data, width: w, height: h }) {
  const lum = (x, y) => lumAt(data, w, x, y);
  const red = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[4 * i], g = data[4 * i + 1], b = data[4 * i + 2];
    red[i] = r >= 35 && r > 2.5 * g && r > 2 * b ? 1 : 0;
  }
  const out = [];
  for (const { n, x0, x1, y0, y1 } of blobsOf(red, w, h)) {
    const bw = x1 - x0 - 3, bh = y1 - y0 - 3, fill = n / Math.max(1, bw * bh);
    if (bw < 8 || bh < 8 || bw / bh <= 0.75 || bw / bh >= 1.33 || fill <= 0.15 || fill >= 0.9) continue;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, d = (bw + bh) / 2 / 0.74, r = d / 2;
    if (cy - r < 0 || cy + r >= h) continue;
    // The share of rows from ya to yb (in radii from cy) light in column x.
    const lit = (x, ya, yb) => {
      let rows = 0, hit = 0;
      for (let y = cy + ya * r; y <= cy + yb * r; y++) { rows++; if (lum(x, y) > 110) hit++; }
      return hit / Math.max(1, rows);
    };
    // The "x": its arms light either side, above or below the middle.
    const arm = (dx) => Math.max(lit(cx + dx * r, -0.4, -0.1), lit(cx + dx * r, 0.1, 0.4));
    if (Math.min(arm(-0.22), arm(0.22)) < 0.4) continue;
    // The "i": the best stroke along the line (its middle, where several columns score alike).
    let best = -1, xs = [];
    for (let x = Math.round(cx - 27 * d); x <= cx - 21 * d; x++) {
      if (x - r < 0) continue;
      const stroke = Math.max(lit(x - 1, -0.45, 0.45), lit(x, -0.45, 0.45), lit(x + 1, -0.45, 0.45));
      const score = stroke - Math.max(lit(x - 0.35 * r, -0.3, 0.3), lit(x + 0.35 * r, -0.3, 0.3));
      if (score > best + 0.02) { best = score; xs = [x]; } else if (score >= best - 0.02) xs.push(x);
    }
    if (best < 0.6) continue;
    const left = xs.reduce((a, b) => a + b, 0) / xs.length, span = cx - left;
    if (cy + AT2.available * span > h) continue;
    let dark = 0, m = 0;
    for (let x = Math.round(left + d); x < cx - d; x++) for (const yy of [cy - d / 4, cy, cy + d / 4]) { m++; if (lum(x, yy) < 70) dark++; }
    if (dark > 0.75 * m) out.push({ left, right: cx, y: Math.round(cy), button: d, dark: dark / m, at: AT2 });
  }
  return out.sort((p, q) => q.dark - p.dark);
}
// Each game's exchange window, kept apart: how its buttons are found (best first) and where things sit below them
// (on each window found, `at`). A game names its own (js/game.js, `window`); a new look is a new entry here.
const WINDOWS = { poe1: { find: findWindows1 }, poe2: { find: findWindows2 } };

// Which button a disc is, by its dark glyph inside the orange (the inner third of the disc): the "i" is an upright
// stroke, dark down the middle and clear at one side at least, above and below the middle; the "x" is dark at both
// sides there, where its arms are. Dark is under half the pair's light (lightOf, the lighter button's: the "x" is the
// darker), so the game's brightness setting moves glyph and orange alike. In every test screenshot the "i" has a side
// at 0.33 or under and the "x" both at 1, and something else orange beside the window (the window's own "x" taken for
// the left button, a socket in an open inventory, the HUD's Menu arrow) isn't both.
function buttonIs(data, w, disc, which, light) {
  const r = disc.d / 2, half = Math.max(1, 0.08 * r), cut = 0.5 * light;
  const dark = (x, y) => lumAt(data, w, x, y) < cut;
  // The share of rows from y0 to y1 (in radii from the centre) dark somewhere in a thin strip at dx.
  const share = (dx, y0, y1) => {
    let rows = 0, hit = 0;
    for (let y = disc.cy + y0 * r; y <= disc.cy + y1 * r; y++) {
      rows++;
      for (let x = disc.cx + dx - half; x <= disc.cx + dx + half; x++) if (dark(x, y)) { hit++; break; }
    }
    return hit / Math.max(1, rows);
  };
  const side = (dx) => Math.max(share(dx, -0.36, -0.14), share(dx, 0.14, 0.36));
  const sides = Math.min(side(-0.28 * r), side(0.28 * r));
  return which === "info" ? share(0, -0.35, 0.35) >= 0.4 && sides < 0.5 : sides >= 0.6;
}
const lumAt = (data, w, x, y) => { const k = 4 * (Math.round(y) * w + Math.round(x)); return 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2]; };
// A button's light: the 90th percentile of its middle's luminance (its orange, not its glyph).
function lightOf(data, w, disc) {
  const r = disc.d / 2, all = [];
  for (let y = disc.cy - 0.7 * r; y <= disc.cy + 0.7 * r; y++) for (let x = disc.cx - 0.7 * r; x <= disc.cx + 0.7 * r; x++) all.push(lumAt(data, w, x, y));
  all.sort((p, q) => p - q);
  return all[Math.floor(0.9 * (all.length - 1))];
}
// Where things sit in the window, in button spacings below the buttons (the window scales as a whole): Available's
// first row, Competing's when Available is shown, and the row spacing. With no Available trades at all the game
// moves Competing up into Available's place.
// With no Competing trades at all the box has no banners and Available's first row sits higher (`bare`, measured on
// one capture at 800 x 600).
// `top` and `bottom`: the hover box, from Available's banner to below Competing's last row.
export const AT = { available: 0.202, competing: 0.475, bare: 0.164, pitch: 0.0322, top: 0.11, bottom: 0.70 }; // as measured at 800 x 600, 1176 x 664 and 2384 x 960
// Path of Exile 2's hover box sits 0.068 of the spacing higher (it covers the Market Ratio line), the same size
// (measured at 2152 x 1243; `bare` assumed to move with the rest). findWindows says which a window is (`at`).
const UP2 = 0.068;
export const AT2 = { ...AT, available: AT.available - UP2, competing: AT.competing - UP2, bare: AT.bare - UP2, top: AT.top - UP2, bottom: AT.bottom - UP2 };
// A header banner is read only with the window's button spacing at least BANNER_MIN pixels, and decides only if one
// banner matches better by BANNER_MARGIN (the smallest margin read right so far: 0.18).
const BANNER_MIN = 420, BANNER_MARGIN = 0.15;
// The header banner over a list whose first row is at `firstY` ("AVAILABLE TRADES", "COMPETING TRADES": dark letters
// on a light strip, 1.8 to 2.6 row spacings up), its first word as a zero-mean unit vector on a 56 x 8 grid, for
// telling them apart.
export function bannerOf(img, win, firstY) {
  const span = win.right - win.left, mid = (win.left + win.right) / 2, P = AT.pitch * span;
  // Only the first word, where they differ: "TRADES" is the same in both.
  return gridOf(img, mid - 0.125 * span, firstY - 2.6 * P, 0.55 * 0.25 * span, 0.8 * P);
}
// The column heads over a list whose first row is at `firstY` ("Ratio" and "Stock", a row spacing up), as a
// zero-mean unit vector on a 56 x 8 grid: what tells a list's first row from a row-like line with no hover box round
// it (the window's own ratio field, "1 : 5.96", just above the bare place).
export function headsOf(img, win, firstY) {
  const span = win.right - win.left, mid = (win.left + win.right) / 2, P = AT.pitch * span;
  return gridOf(img, mid - 0.14 * span, firstY - 1.35 * P, 0.28 * span, 0.9 * P);
}
// Whether the column heads (`ref`, headsOf's from the game's own) are over the row at `firstY`, slid a little up and down
// (`headsScore`: how well they match, best). Lists' first rows match at 0.34 or more (a cursor over the heads takes some
// away), the ratio field at 0.07. At a list's place, heads plainly there (HEADS_PLAIN) mean a hover box: 0.75 or more
// with lists, 0.38 at most without one.
const HEADS_MIN = 0.2, HEADS_PLAIN = 0.6;
// The game centres every stock on one column: 0.0466 of the button spacing right of the window's centre, within 0.002
// on 90% of 487 rows (800 x 600 to 2564 x 1406, both games).
const STOCK_AT = 0.0466;
const headsSay = (img, win, firstY, ref) => headsScore(img, win, firstY, ref) >= HEADS_MIN;
function headsScore(img, win, firstY, ref) {
  const P = AT.pitch * (win.right - win.left);
  let best = -1;
  for (let dy = -Math.ceil(0.3 * P); dy <= Math.ceil(0.3 * P); dy++) {
    const v = headsOf(img, win, firstY + dy);
    best = Math.max(best, ref.reduce((sum, x, i) => sum + x * v[i], 0));
  }
  return best;
}
// A box's grey levels on a 56 x 8 grid, as a zero-mean unit vector.
function gridOf(img, x0, y0, w, h) {
  const GW = 56, GH = 8, v = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    let sum = 0, n = 0;
    for (let y = Math.floor(y0 + (gy * h) / GH); y < y0 + ((gy + 1) * h) / GH; y++) for (let x = Math.floor(x0 + (gx * w) / GW); x < x0 + ((gx + 1) * w) / GW; x++) {
      if (x >= 0 && y >= 0 && x < img.w && y < img.h) { sum += img.lum[y * img.w + x]; n++; }
    }
    v[gy * GW + gx] = n ? sum / n : 0;
  }
  return unit(v);
}
// Whether the game says "There are no available trades for these two items": white letters on a dark strip just
// under the title, reaching well past the title's ends. Beside the title (0.17 to 0.27 of the button spacing either
// side of the middle), from 0.008 to 0.035 below the buttons: with the message over a third of those pixels are
// white; without it, a few at most. Either side will do (a cursor may cover the other).
function noTradesMessage({ data, width }, win) {
  const span = win.right - win.left, mid = (win.left + win.right) / 2;
  const share = (a, b) => {
    let n = 0, white = 0;
    for (let y = Math.round(win.y + 0.008 * span); y <= Math.round(win.y + 0.035 * span); y++) for (let x = Math.round(a); x < b; x++) {
      const i = 4 * (y * width + x), lo = Math.min(data[i], data[i + 1], data[i + 2]), hi = Math.max(data[i], data[i + 1], data[i + 2]);
      n++;
      if (lo > 140 && hi - lo < 40) white++;
    }
    return n ? white / n : 0;
  };
  return Math.max(share(mid - 0.27 * span, mid - 0.17 * span), share(mid + 0.17 * span, mid + 0.27 * span)) >= 0.15;
}
// The hover box in the window (findWindows'): centred, 0.38 of the button spacing wide, from Available's banner (PoE1:
// 0.11 down) to below Competing's last row (0.70), as { x0, y0, x1, y1 }, null when hardly any of it is in the frame. With
// it, `slots`: where its lists are read slot by slot from their first rows (js/rows.js, readSlotRows), in the box's
// terms: `places`, Available's (bare, or under its banner) and Competing's; the stocks centred on STOCK_AT; a row's text
// reaching no further left than the box's inside.
export function hoverBoxOf(img, win) {
  const span = win.right - win.left, mid = (win.left + win.right) / 2, lay = win.at ?? AT;
  const x0 = Math.max(0, Math.round(mid - 0.19 * span)), x1 = Math.min(img.w, Math.round(mid + 0.19 * span));
  const y0 = Math.max(0, Math.round(win.y + lay.top * span)), y1 = Math.min(img.h, Math.round(win.y + lay.bottom * span));
  if (x1 - x0 <= 20 || y1 - y0 <= 20) return null;
  const places = [lay.bare, lay.available, lay.competing].map((rel) => win.y + rel * span - y0);
  return { x0, y0, x1, y1, slots: { places, span, stockX: mid + STOCK_AT * span - x0,
    x0: Math.round(mid - 0.15 * span) - x0, x1: Math.round(mid + 0.15 * span) - x0 } };
}
// The lists inside the window (findWindows'): the hover box's area is read, its place moved back into the whole image's
// terms. Without the window there are none. Options: readRowsIn ((img, slots) => lines, each list's rows from
// its place in `slots` ({ places, span, stockX, x0, x1 }); `groups` makes the
// lists of them), `banners` ({ available, competing }: bannerOf's from a known window) to tell a lone list with no
// arrow row by its header, `heads` ({ poe1, poe2 }: headsOf's, from each game's window) to tell a list's first row
// from a row-like line with no hover box, `wins` (the window's buttons where they're known already), `style` (the game's
// window) and `first` (the rows of the first window's hover box, readRowsIn's, when they're read already).
// `empty`, on the result: the list the game shows has no trades at all ("available" or "competing"), else null.
export function findListsIn(imageData, img, { readRowsIn, banners = null, heads = null, wins: known = null, style = "poe1", first: given = null }) {
  const wins = known ?? findWindows(imageData, style), win = wins[0] ?? null;
  // At each pair of buttons that could be the window, best first: the first whose hover box gives rows is it.
  for (const [i, win] of wins.entries()) {
    const span = win.right - win.left, mid = (win.left + win.right) / 2, lay = win.at ?? AT, area = hoverBoxOf(img, win);
    if (area) {
      const { x0, y0, slots } = area;
      // A lone list with no arrow row: at Competing's place it's Competing. At Available's, the game's message says:
      // with "no available trades" it's Competing moved up, else Available. Where the header banner can be read, it
      // must not clearly say otherwise.
      const message = noTradesMessage(imageData, win);
      const which = (run) => {
        // Places are measured to well under a row (Available's with and without its banner are only 1.2 rows apart).
        const firstY = run[0].y + y0, rel = (firstY - win.y) / span, near = 0.6 * AT.pitch;
        if (Math.abs(rel - lay.competing) <= near) return "competing";
        if (Math.abs(rel - lay.bare) <= near) return "available"; // only Available is shown without a banner
        if (Math.abs(rel - lay.available) > near) return null;
        const kind = message ? "competing" : "available";
        const banner = bannerSays(firstY);
        return banner && banner !== kind ? null : kind;
      };
      // What the header banner over a list says, if it can be read and says it clearly: "available", "competing" or
      // null. The banner's letters are about 6 pixels tall in a window under ~640 high (button spacing under
      // BANNER_MIN): too small to tell apart, so not read.
      const bannerSays = (firstY) => {
        if (!banners || span < BANNER_MIN) return null;
        // Its banner against each, slid up and down a little (at the small sizes a pixel is much of the letters).
        const P = AT.pitch * span, best = { available: -1, competing: -1 };
        for (let dy = -Math.ceil(0.3 * P); dy <= Math.ceil(0.3 * P); dy++) {
          const v = bannerOf(img, win, firstY + dy);
          for (const k of ["available", "competing"]) best[k] = Math.max(best[k], banners[k].reduce((sum, x, i) => sum + x * v[i], 0));
        }
        const [a, c] = [best.available, best.competing];
        return a - c > BANNER_MARGIN ? "available" : c - a > BANNER_MARGIN ? "competing" : null;
      };
      // Each list starts where its first row belongs: Available at its place, Competing at its own or, alone, moved
      // up into Available's.
      const starts = (kind, list, n) => {
        const rel = (list[0].y + y0 - win.y) / span, near = (at) => Math.abs(rel - at) <= 0.6 * AT.pitch;
        return kind === "available" ? near(lay.available) || (n === 1 && near(lay.bare)) : near(lay.competing) || (n === 1 && near(lay.available));
      };
      const P = AT.pitch * span, { places } = slots, lines = i === 0 && given ? given : readRowsIn(cropLum(img, x0, y0, area.x1 - x0, area.y1 - y0), slots);
      const plain = () => !heads?.[style] || places.some((p) => headsScore(img, win, p + y0, heads[style]) >= HEADS_PLAIN);
      const inkAt = (y) => inkOf(img, mid - 0.15 * span, mid + 0.15 * span, y + y0, P);
      const first = (y) => !heads?.[style] || headsSay(img, win, y + y0, heads[style]);
      let found = groups(lines, which, starts, walkFrom(places, P, inkAt, first));
      const at = [x0, y0];
      // Rows in the window but no list made of them (a lone list not told apart, say): that's the answer for this
      // frame, not a reason to try the next pair of buttons.
      if (found.available || found.competing || found.rows) {
        const at0 = moved(found.place, ...at), place = at0 && { ...at0, win: { left: win.left, right: win.right, button: win.button } };
        const [a, c] = [place?.firstRows.available, place?.firstRows.competing];
        // A list alone where the game says the other has no trades: Competing moved up into Available's place under
        // the "no available trades" message, or Available with no banners at its own higher place (`bare`: no Competing
        // trades). Alone anywhere else, the other may only be hidden (Competing shows with Alt held).
        const near = (y, rel) => y != null && Math.abs((y - win.y) / span - rel) <= 0.6 * AT.pitch;
        const empty = found.competing && !found.available && message && near(c, lay.available) ? "available"
          : found.available && !found.competing && near(a, lay.bare) ? "competing" : null;
        // A hover box is there when a row sits at a list's place with the column heads over it: one that reads, or any with
        // the heads plainly there (a cursor over the row; unread text with the heads only faintly matched is the ratio field).
        const atPlace = lines.filter((l) => l.y != null && places.some((p) => Math.abs(l.y - p) <= SLOT * P) && first(l.y));
        const hover = atPlace.some((l) => !l.unread) || (atPlace.length > 0 && plain());
        return { ...found, window: win, place, empty, hover };
      }
    }
  }
  return { window: win };
}

// ---------- currency names (SPEC.md §4.7) ----------
// The I Want and I Have names sit in near-black boxes beside the lists, above the first row: they tell which pair a
// frame shows, and which way round.

// The name boxes: the highest near-black region on each side, about 5-12 row spacings wide and 1-2.8 tall, mostly
// dark (the letters are the rest), in the strip from 3.2 spacings above the first row to one below it. `place` is the
// lists' { firstY, pitch, win } (findListsIn's; `win`, the window's buttons). A box not found is null (out of frame, a
// pinned hover box moved off them). Each side's search runs from the "Currency Exchange" title box's edge (TITLE_EDGE
// of the button spacing from the window's centre, a little inside it: the boxes' inner edges are at 0.19 to 0.21) out
// to a button's width short of the buttons, as a fill that reaches the frame can join the box with the dark beyond it.
// Each box's outer edge is then set from its button: the boxes end BOX_EDGE of a button's width inside the info and
// close buttons' centres.
const TITLE_EDGE = 0.185, BOX_EDGE = 0.1;
// Where each box's text starts, in button spacings from the info button's centre (I Want) and the window's centre (I
// Have): in the middle of the gap between the icon and the first letter (0.0444 to 0.0492 and 0.2436 to 0.2503 over
// the test frames), and how near that the gap is looked for (textStart).
const TEXT_AT = { left: 0.0468, right: 0.247 }, TEXT_NEAR = 0.006;
const DARK = 32;
export function nameBoxes(img, place) {
  for (const firstY of place.win ? place.tops ?? [place.firstY] : []) {
    const boxes = nameBoxesAt(img, { ...place, firstY });
    if (boxes.left || boxes.right) return boxes;
  }
  return { left: null, right: null };
}
function nameBoxesAt(img, { firstY, pitch, win }) {
  const { w, lum } = img;
  const out = { left: null, right: null };
  // Down to a row below the first price row: with no Competing trades the lists sit higher (AT.bare) and the boxes
  // reach below their first row. Beside the title box, so no price row is taken in.
  const ys = Math.max(0, Math.round(firstY - 3.2 * pitch)), ye = Math.min(img.h, Math.round(firstY + pitch));
  const span = win.right - win.left, mid = (win.left + win.right) / 2, title = TITLE_EDGE * span;
  for (const side of ["left", "right"]) {
    const [from, to] = side === "left" ? [win.left + win.button, mid - title] : [mid + title, win.right - win.button];
    const xs = Math.max(0, Math.round(from)), xe = Math.min(w, Math.round(to));
    const W = xe - xs, H = ye - ys;
    if (W < 10 || H < 10) continue;
    const dark = new Uint8Array(W * H), seen = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dark[y * W + x] = lum[(y + ys) * w + x + xs] < DARK ? 1 : 0;
    for (let i = 0; i < W * H; i++) {
      if (!dark[i] || seen[i]) continue;
      const stack = [i];
      seen[i] = 1;
      let n = 0, bx0 = W, bx1 = 0, by0 = H, by1 = 0;
      while (stack.length) {
        const j = stack.pop(), x = j % W, y = (j - x) / W;
        n++;
        bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
        for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) {
          if (k >= 0 && k < W * H && dark[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
      if (bw < 5 * pitch || bw > 12 * pitch || bh < pitch || bh > 2.8 * pitch || n < 0.45 * bw * bh) continue;
      // The highest that fits: the name box stays put whichever way the lists sit, and a dark patch can lie below it.
      if (!out[side] || by0 + ys < out[side].y0) out[side] = { x0: bx0 + xs, y0: by0 + ys, x1: bx1 + xs, y1: by1 + ys, n };
    }
    const b = out[side];
    if (!b) continue;
    if (side === "left") b.x0 = Math.max(0, Math.round(win.left + BOX_EDGE * win.button));
    else b.x1 = Math.min(w - 1, Math.round(win.right - BOX_EDGE * win.button));
    b.text = { at: side === "left" ? win.left + TEXT_AT.left * span : mid + TEXT_AT.right * span, near: TEXT_NEAR * span };
  }
  return out;
}

// Names are read whole, not letter by letter: each line of a box becomes a run of columns, each column the
// brightness over BINS bands down a strip set by the line's letter height, and every candidate name is drawn the same
// way from letter samples (data/glyphs.json, `names`) and compared with the box by dynamic time warping. Letters that
// touch, small sizes and a cut-off pixel cost a little; a different name costs a lot.
const BINS = 12;

// Where the text starts: after the item's icon, at the end of the gap of dark columns before the first letter. With the
// window known (`b.text`, nameBoxes'), the gap is the run of dark columns nearest where the window puts it, within
// `near` of it, else that place itself (a glow across the gap): a thin or broken icon (a shard, a tattoo) has dark
// columns through it, which the first gap after the icon's start can be. A box cut out on its own (the name tests' and
// the letter samples' boxes, with no window): the first gap of dark columns from a little way in (the icon is narrower
// than the box is tall).
function textStart(img, b) {
  const bh = b.y1 - b.y0 + 1, vals = [];
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) vals.push(img.lum[y * img.w + x]);
  vals.sort((p, q) => p - q);
  const bg = vals[Math.floor(vals.length * 0.5)], fg = vals[Math.floor(vals.length * 0.995)], cut = bg + 0.3 * (fg - bg);
  const dark = (x) => { for (let y = b.y0 + 1; y < b.y1; y++) if (img.lum[y * img.w + x] > cut) return false; return true; };
  if (b.text) {
    const { at, near } = b.text;
    let best = null;
    for (let x = Math.max(b.x0, Math.round(at - near)); x <= Math.min(b.x1 - 1, Math.round(at + near)); x++) {
      if (!dark(x)) continue;
      let a = x, e = x;
      while (a > b.x0 && dark(a - 1)) a--;
      while (e < b.x1 - 1 && dark(e + 1)) e++;
      const d = Math.abs((a + e) / 2 - at);
      if (!best || d < best.d) best = { e, d };
      x = e;
    }
    return best ? best.e : Math.round(at);
  }
  const gap = Math.max(2, Math.round(0.08 * bh));
  for (let x = Math.round(b.x0 + 0.4 * bh); x < Math.min(b.x1 - gap, b.x0 + 1.6 * bh); x++) {
    let run = 0;
    while (run < gap && dark(x + run)) run++;
    if (run === gap) { let e = x + gap; while (e < b.x1 && dark(e)) e++; return e - 1; }
  }
  return Math.round(b.x0 + 1.05 * bh);
}

const BOX_LH = 0.35;
// The text in a name box: its letter height `lh` (a capital's, specks of the box's edge aside) and its lines, top
// first, each with its pieces of ink and its columns over a strip from just above the capitals to below descenders.
// `force`: that letter height instead of the measured one; `again(d)` reads the box d pixels smaller (nameOf).
export function nameText(img, b, force = null) {
  const x0 = textStart(img, b), x1 = b.x1 - 2, y0 = b.y0 + 1, y1 = b.y1 - 1;
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  if (W < 5 || H < 5) return { lines: [], lh: 1 };
  const box = cropLum(img, x0, y0, W, H);
  const sorted = Float32Array.from(box.lum).sort();
  const bg = sorted[Math.floor(sorted.length * 0.5)], fg = sorted[Math.floor(sorted.length * 0.995)];
  const v = Float32Array.from(box.lum, (l) => Math.max(0, Math.min(1, (l - bg) / Math.max(1, fg - bg))));
  const comps = components(Uint8Array.from(v, (a) => (a > 0.45 ? 1 : 0)), W, 0, H).filter((c) => c.n >= 2);
  const tall = comps.map((c) => c.y1 - c.y0 + 1).filter((h) => h > 2).sort((a, b) => a - b);
  // The letters' height, at most BOX_LH of the box's: the game draws a name at that size (or smaller, a long one), but
  // letters reaching above the capitals can measure taller ("Stacked Deck", its k, d and k: 17 in a box of 47 beside
  // Chaos Orb's 16, drawn 15% too wide and read as Sacred Orb). Far over it, the box is cut short (at the frame's edge): left be.
  const measured = tall[Math.floor(tall.length * 0.75)] || 1, cap = Math.round(BOX_LH * (b.y1 - b.y0 + 1));
  const lh = force ?? (measured > cap && measured <= 1.15 * cap ? cap : measured);
  const lines = [];
  for (const c of comps.filter((c) => c.y1 - c.y0 + 1 >= 0.45 * lh)) {
    const mid = (c.y0 + c.y1) / 2;
    const l = lines.find((l) => Math.abs(l.mid - mid) < 0.6 * lh);
    if (l) l.comps.push(c); else lines.push({ mid, comps: [c] });
  }
  lines.sort((a, b) => a.mid - b.mid);
  for (const l of lines) {
    const capitals = l.comps.filter((c) => c.y1 - c.y0 + 1 >= 0.8 * lh);
    const top = Math.min(...(capitals.length ? capitals : l.comps).map((c) => c.y0)) - 0.15 * lh, tall = 1.5 * lh;
    // Small pieces (dots, apostrophes, commas) in the strip belong to the line too.
    l.pieces = comps.filter((c) => c.y1 >= top && c.y0 <= top + tall).sort((a, b) => a.x0 - b.x0);
    l.x0 = Math.min(...l.pieces.map((c) => c.x0));
    l.x1 = Math.max(...l.pieces.map((c) => c.x1));
    l.cols = [];
    for (let x = l.x0; x <= l.x1; x++) {
      const col = new Float32Array(BINS);
      for (let k = 0; k < BINS; k++) {
        const ya = top + (k * tall) / BINS, yb = top + ((k + 1) * tall) / BINS;
        let s = 0, n = 0;
        for (let y = Math.max(0, Math.floor(ya)); y < Math.min(H, Math.ceil(yb)); y++) { s += v[y * W + x]; n++; }
        col[k] = n ? s / n : 0;
      }
      l.cols.push(col);
    }
  }
  return { lines, lh, again: (d) => nameText(img, b, lh - d) };
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
export function unpackNames({ names } = {}) {
  if (!names) return null;
  const letters = {};
  for (const { ch, w, gap, cols } of names.letters) {
    const bytes = Uint8Array.from(atob(cols), (c) => c.charCodeAt(0));
    letters[ch] = { w, gap, cols: Array.from({ length: bytes.length / BINS }, (_, i) => Float32Array.from(bytes.subarray(i * BINS, (i + 1) * BINS), (v) => v / 255)) };
  }
  return { letters, space: names.space };
}

// A run of columns stretched or squeezed to n.
function resample(cols, n) {
  const out = [];
  for (let j = 0; j < n; j++) {
    const t = cols.length === 1 ? 0 : (j * (cols.length - 1)) / Math.max(1, n - 1), i = Math.floor(t), f = t - i;
    const a = cols[i], b = cols[Math.min(cols.length - 1, i + 1)], c = new Float32Array(BINS);
    for (let k = 0; k < BINS; k++) c[k] = a[k] * (1 - f) + b[k] * f;
    out.push(c);
  }
  return out;
}
const blank = (n) => Array.from({ length: Math.max(0, n) }, () => new Float32Array(BINS));

// A name drawn at letter height lh from the letter samples, as columns (kept, per model and height: the same names
// are drawn for every box). A character with no sample is a faint block of the average width.
const drawn = new WeakMap();
function draw(name, model, lh) {
  let cache = drawn.get(model);
  if (!cache) drawn.set(model, (cache = new Map()));
  const key = `${lh}|${name}`;
  if (cache.has(key)) return cache.get(key);
  const all = Object.values(model.letters), avgW = all.reduce((s, m) => s + m.w, 0) / all.length;
  const out = [], words = name.split(" ");
  words.forEach((word, wi) => {
    [...word].forEach((ch, i) => {
      const m = model.letters[ch], n = Math.max(1, Math.round((m ? m.w : avgW) * lh));
      out.push(...(m ? resample(m.cols, n) : blank(n).map((c) => c.fill(0.25))));
      if (i < word.length - 1) out.push(...blank(Math.round((m ? m.gap : 0.08) * lh)));
    });
    if (wi < words.length - 1) out.push(...blank(Math.round(model.space * lh)));
  });
  cache.set(key, out);
  return out;
}

// A box's lines as one run of columns (the wrap a space).
const columnsOf = (text, model) =>
  text.lines.flatMap((l, i) => (i ? [...blank(Math.round(model.space * text.lh)), ...l.cols] : l.cols));

// Dynamic time warping: the cheapest path's cost per step, kept within 20% of the diagonal. Its rows (costs and path
// lengths, the last and this) are kept between calls: a box is warped against hundreds of names.
let warpRows = Array.from({ length: 4 }, () => new Float64Array(0));
function warp(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return Infinity;
  const band = Math.max(4, Math.ceil(0.2 * Math.max(n, m)));
  if (warpRows[0].length < m + 1) warpRows = warpRows.map(() => new Float64Array(m + 1));
  let prev = warpRows[0], prevLen = warpRows[1], cur = warpRows[2], len = warpRows[3];
  prev.fill(Infinity);
  prev[0] = 0;
  prevLen.fill(0);
  for (let i = 1; i <= n; i++) {
    cur.fill(Infinity);
    const jc = Math.round((i * m) / n);
    for (let j = Math.max(1, jc - band); j <= Math.min(m, jc + band); j++) {
      const x = a[i - 1], y = b[j - 1];
      let d = 0;
      for (let k = 0; k < BINS; k++) { const t = x[k] - y[k]; d += t * t; }
      let best = prev[j - 1], bl = prevLen[j - 1];
      if (prev[j] < best) { best = prev[j]; bl = prevLen[j]; }
      if (cur[j - 1] < best) { best = cur[j - 1]; bl = len[j - 1]; }
      cur[j] = best + d;
      len[j] = bl + 1;
    }
    let t = prev; prev = cur; cur = t;
    t = prevLen; prevLen = len; len = t;
  }
  return prev[m] / Math.max(1, prevLen[m]);
}

// The names nearest a box's text, best first ([{ name, cost }]): of those within 30% of its width, the SHORTLIST
// nearest when both are squeezed to at most COARSE columns are compared in full.
const COARSE = 96, SHORTLIST = 30;
const squeezed = new WeakMap(); // per drawn name: { n: its squeezed columns }
export function rankNames(text, model, names, top = 3) {
  if (!text?.lines.length) return [];
  const box = columnsOf(text, model), n = Math.min(COARSE, box.length), rough = resample(box, n), near = [];
  for (const name of names) {
    const whole = draw(name, model, text.lh);
    if (Math.abs(whole.length / box.length - 1) > 0.3) continue;
    if (!squeezed.has(whole)) squeezed.set(whole, {});
    const sq = squeezed.get(whole);
    near.push({ name, whole, d: warp(rough, (sq[n] ??= resample(whole, n))) });
  }
  return near.sort((x, y) => x.d - y.d).slice(0, SHORTLIST).map(({ name, whole }) => ({ name, cost: warp(box, whole) }))
    .sort((x, y) => x.cost - y.cost).slice(0, top);
}

// The texts of a frame's name boxes: { left (I Want), right (I Have) }, each null when its box wasn't found, and with
// its box (`box`, nameBoxes').
export function readNames(img, place, model) {
  if (!place || !model) return { left: null, right: null };
  const boxes = nameBoxes(img, place);
  const read = (b) => { const t = b && nameText(img, b); return t?.lines.length ? { ...t, box: b } : null; };
  return { left: read(boxes.left), right: read(boxes.right) };
}

// A box's name for certain: the nearest within NAME_SURE, with the next nearest NAME_CLEAR times as far; else null
// (a box cut off, covered, or near two names). Letters reaching above the capitals can still make the letter height
// a pixel or two too big in a small box (Stacked Deck in a 40 px box: 14, where it reads at 12), and a two-line name
// that's mostly lowercase measures its lowercase letters (Divination Scarab of The Cloister: 11, where it reads at 13),
// so a box with no certain name is read again 1 and 2 px smaller (not under 8 px), then 1 to 3 px larger, and named
// there only if far clearer: the nearest within NAME_NEAR and the next NAME_FAR times as far.
const NAME_SURE = 0.9, NAME_CLEAR = 1.1, NAME_NEAR = 0.5, NAME_FAR = 1.5;
export function nameOf(text, model, names) {
  const [best, next] = rankNames(text, model, names, 2);
  if (best && best.cost <= NAME_SURE && (!next || next.cost >= NAME_CLEAR * best.cost)) return best.name;
  for (const d of [1, 2, -1, -2, -3]) {
    const other = text?.again?.(d);
    if (!other?.lines.length || other.lh < 8) continue;
    const [b2, n2] = rankNames(other, model, names, 2);
    if (b2 && b2.cost <= NAME_NEAR && (!n2 || n2.cost >= NAME_FAR * b2.cost)) return b2.name;
  }
  return null;
}
