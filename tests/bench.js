// How long the readers take on the test frames with the game's window, as watching reads them (SPEC.md §4.7): a whole
// read (luminance, the window and lists, both names) and the names alone. Reports, never fails. With `?vs=<path>` (a
// folder holding another version's js/ and data/, as tools/bench.py serves it), that version is timed on the same
// frames too, run for run in turn with this one so the machine's drift falls on both alike. `?runs=N` (default 15)
// timed runs per frame after 3 to warm up; `?only=file,...` some frames.
const FRAMES = [
  "size-1.png", "size-2.png", "size-3.png", "size-4.png", "size-5.png", "size-6.png", "size-7.png", "size-8.png", "size-9.png",
  "size-10.png", "size-full.png", "size-small-no-available.png", "size-small-no-competing.png", "firefox-share-1280x960.png",
  "inv-open-1280x960.png", "inv-open-2125x960.png", "stash-open-1280x960.png", "stash-open-2125x960.png",
  "stash-inv-open-1280x960.png", "stash-inv-open-2125x960.png", "sparse-row-2371x1334.png", "wide-vivid-lifeforce.png",
  "vivid-small-ratios-window.png", "wild-lifeforce-window.png", "ember-short-prices-window.png", "cursor-over-stock-hover-window.png",
  "poe2-exalted-2152x1243.png", "icon-mortal-hope-window.png", "icon-annulment-poe2-window.png", "sulphur-millions-window.png",
  "sulphur-millions-2-window.png",
];
const q = new URLSearchParams(location.search), runs = +(q.get("runs") ?? 15), only = q.get("only")?.split(",");

async function version(base) {
  const [snip, rows] = await Promise.all([import(`${base}/js/snip.js`), import(`${base}/js/rows.js`)]);
  const json = await (await fetch(`${base}/data/glyphs.json`, { cache: "no-cache" })).json();
  const catalog = await (await fetch(`${base}/data/catalog.json`, { cache: "no-cache" })).json();
  return { snip, rows, glyphs: json.glyphs ? snip.unpackGlyphs(json) : null, model: rows.unpackModel(json.rows), nameModel: snip.unpackNames?.(json),
    names: [...new Set(Object.values(catalog).map((c) => c.name).filter(Boolean))] };
}
const dataOf = async (file) => {
  const img = await new Promise((ok, err) => { const m = new Image(); m.onload = () => ok(m); m.onerror = err; m.src = `snips/${file}`; });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
};
// One watched frame's read (a frame with no lists, as the hover box with the cursor over a stock, reads no names), and
// the names alone from its lists' place.
function read(V, data, style) {
  // (An older version takes the line reader's examples, `glyphs`, before the model.)
  const img = V.snip.toLum(data), got = V.rows.findAll.length > 3 ? V.rows.findAll(data, img, V.glyphs, V.model, null, style)
    : V.rows.findAll(data, img, V.model, null, style);
  return { img, got, names: names(V, img, got.place) };
}
function names(V, img, place) {
  if (!place || !V.snip.readNames || !V.nameModel) return null;
  const t = V.snip.readNames(img, place, V.nameModel);
  return [V.snip.nameOf(t.left, V.nameModel, V.names), V.snip.nameOf(t.right, V.nameModel, V.names)];
}
const spread = (ts) => {
  const s = [...ts].sort((a, b) => a - b), at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { p10: at(0.1), median: at(0.5), p90: at(0.9) };
};
const ms = (v) => v.toFixed(1).padStart(7);

const todo = FRAMES.filter((f) => !only || only.includes(f));
// Published as it goes, so a runner can show each frame as it's done.
const result = window.bench = { runs, versions: ["this"], total: todo.length, frames: [], done: false };
try {
  const vs = q.get("vs"), V = { this: await version("../html") };
  if (vs) { V.vs = await version(vs); result.versions.push("vs"); }
  console.log(`${runs} runs per frame${vs ? `, this version against ${vs}` : ""}: median (10th to 90th percentile), ms`);
  for (const file of todo) {
    const style = file.includes("poe2") ? "poe2" : "poe1", data = await dataOf(file), first = read(V.this, data, style);
    if (!first.got.window) { result.frames.push({ file, skipped: "no window" }); console.log(`${file}: skipped (no window)`); continue; }
    const row = { file, style, size: [data.width, data.height] }, full = {}, alone = {}, out = {};
    for (const k of result.versions) {
      full[k] = []; alone[k] = [];
      try { const r = read(V[k], data, style); out[k] = { place: r.got.place, img: r.img, names: r.names, lists: [r.got.available?.length ?? 0, r.got.competing?.length ?? 0] }; }
      catch (err) { out[k] = { error: String(err) }; }
    }
    for (let i = 0; i < runs + 3; i++) {
      for (const k of i % 2 ? [...result.versions].reverse() : result.versions) {
        if (out[k].error) continue;
        let t = performance.now();
        read(V[k], data, style);
        const tf = performance.now() - t;
        t = performance.now();
        names(V[k], out[k].img, out[k].place);
        const tn = performance.now() - t;
        if (i >= 3) { full[k].push(tf); alone[k].push(tn); }
      }
    }
    for (const k of result.versions) {
      row[k] = out[k].error ? { error: out[k].error } : { full: spread(full[k]), names: spread(alone[k]), read: out[k].names, lists: out[k].lists };
    }
    result.frames.push(row);
    console.log(`${file} (${data.width} x ${data.height}): ` + result.versions.map((k) => row[k].error ? `${k} failed: ${row[k].error}`
      : `${k} ${ms(row[k].full.median)} (${row[k].full.p10.toFixed(0)}-${row[k].full.p90.toFixed(0)}), names ${ms(row[k].names.median)}, read ${row[k].read?.map((n) => n ?? "none").join(" / ") ?? "no names"}`).join(" | "));
  }
} catch (err) {
  result.error = String(err?.stack ?? err);
  console.log(`couldn't run: ${result.error}`);
}
result.done = true;
console.log("done");
