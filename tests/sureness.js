// How sure the readers are of what they read on the test frames with the window, as watching reads them (SPEC.md §4.7):
// each list row's sureness (rows.js: how much worse the row reads with any one digit forbidden where it is; under SURE,
// 0.09, the row isn't read) and each name's cost and its gap to the next nearest name (snip.js, rankNames: the next
// costs that many times as much). Nothing is timed (tools/bench.py does that). With `?vs=<path>` (a folder holding
// another version's js/ and data/, as tools/sureness.py serves it), that version is measured on the same frames too.
// `?only=file,...` some frames.
const FRAMES = [
  "size-1.png", "size-2.png", "size-3.png", "size-4.png", "size-5.png", "size-6.png", "size-7.png", "size-8.png", "size-9.png",
  "size-10.png", "size-full.png", "size-small-no-available.png", "size-small-no-competing.png", "firefox-share-1280x960.png",
  "inv-open-1280x960.png", "inv-open-2125x960.png", "stash-open-1280x960.png", "stash-open-2125x960.png",
  "stash-inv-open-1280x960.png", "stash-inv-open-2125x960.png", "sparse-row-2371x1334.png", "wide-vivid-lifeforce.png",
  "vivid-small-ratios-window.png", "wild-lifeforce-window.png", "ember-short-prices-window.png", "cursor-over-stock-hover-window.png",
  "poe2-exalted-2152x1243.png", "icon-mortal-hope-window.png", "icon-annulment-poe2-window.png", "sulphur-millions-window.png",
  "sulphur-millions-2-window.png", "dark-x-window.png", "false-colon-window.png", "listings-below-window.png", "low-specks-window.png",
  "one-available-row-window.png", "one-row-head-window.png", "one-row-head-flipped-window.png", "outlier-competing-window.png",
  "ratio-field-window.png", "small-eights-window.png", "small-four-window.png", "stock-touching-ratio-window.png",
  "two-line-name-window.png", "sulphur-close-stock-window.png",
  "order-card-edge-window.png", "order-card-edge-2-window.png",
];
const q = new URLSearchParams(location.search), only = q.get("only")?.split(",");

async function version(base) {
  const [snip, rows] = await Promise.all([import(`${base}/js/snip.js`), import(`${base}/js/rows.js`)]);
  const json = await (await fetch(`${base}/data/glyphs.json`, { cache: "no-cache" })).json();
  const catalog = await (await fetch(`${base}/data/catalog.json`, { cache: "no-cache" })).json();
  return { snip, rows, glyphs: json.glyphs ? snip.unpackGlyphs(json) : null, model: rows.unpackModel(json.rows), nameModel: snip.unpackNames(json),
    names: [...new Set(Object.values(catalog).map((c) => c.name).filter(Boolean))] };
}
const dataOf = async (file) => {
  const img = await new Promise((ok, err) => { const m = new Image(); m.onload = () => ok(m); m.onerror = err; m.src = `snips/${file}`; });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
};
// One frame as watching reads it, with every row the reader read kept (findListsIn with the reader's own readRowsIn,
// wrapped): the lists, each list row's sureness and fit, and the names' costs.
function measure(V, data, style) {
  const lines = [], read = V.rows.readRowsWith(V.model);
  // (An older version takes the line reader's examples, `glyphs`, before the options, and hands them to readRowsIn.)
  const old = V.snip.findListsIn.length > 3, keep = (got) => { lines.push(...got); return got; };
  const readRowsIn = old ? (img, glyphs, slots) => keep(read(img, glyphs, slots)) : (img, slots) => keep(read(img, slots));
  const img = V.snip.toLum(data), opts = { readRowsIn, banners: V.model.banners, heads: V.model.heads, style };
  const got = old ? V.snip.findListsIn(data, img, V.glyphs, opts) : V.snip.findListsIn(data, img, opts);
  const ratio = (r) => `${r.want.text}:${r.have.text}`;
  const rowsOf = (list, kind) => (list ?? []).map((r) => {
    const line = lines.find((l) => l.sure != null && l.text.replace(/^[<>]/, "").split(" ")[0] === ratio(r) && Number(l.text.split(" ")[1]?.replace(/,/g, "")) === r.stock);
    return { kind, text: `${ratio(r)} ${r.stock}`, sure: line?.sure ?? null, fit: line?.fit ?? null };
  });
  const rows = [...rowsOf(got.available, "available"), ...rowsOf(got.competing, "competing")];
  let names = null;
  if (got.place && ((got.available && got.competing) || got.empty)) {
    const t = V.snip.readNames(img, got.place, V.nameModel);
    names = [t.left, t.right].map((text) => {
      if (!text) return { name: null, cost: null, gap: null };
      const [a, b] = V.snip.rankNames(text, V.nameModel, V.names, 2);
      return { name: V.snip.nameOf(text, V.nameModel, V.names), nearest: a?.name ?? null, cost: a?.cost ?? null, gap: a && b ? b.cost / Math.max(1e-9, a.cost) : null };
    });
  }
  return { lists: [got.available?.length ?? 0, got.competing?.length ?? 0], empty: got.empty ?? null, rows, names };
}
const f2 = (v) => (v == null ? "-" : v.toFixed(2));

const todo = FRAMES.filter((f) => !only || only.includes(f));
const result = window.sureness = { versions: ["this"], total: todo.length, frames: [], done: false };
try {
  const vs = q.get("vs"), V = { this: await version("../html") };
  if (vs) { V.vs = await version(vs); result.versions.push("vs"); }
  console.log(`sureness: each frame's least sure list row, and its names' costs (gap: how many times the next name costs)${vs ? `, this version against ${vs}` : ""}`);
  for (const file of todo) {
    const style = file.includes("poe2") ? "poe2" : "poe1", data = await dataOf(file), row = { file, style, size: [data.width, data.height] };
    for (const k of result.versions) {
      try { row[k] = measure(V[k], data, style); } catch (err) { row[k] = { error: String(err) }; }
    }
    result.frames.push(row);
    console.log(`${file}: ` + result.versions.map((k) => {
      const m = row[k];
      if (m.error) return `${k} failed: ${m.error}`;
      const s = m.rows.map((r) => r.sure).filter((v) => v != null);
      return `${k} lists ${m.lists.join("/")}, least sure ${f2(s.length ? Math.min(...s) : null)}, names ${m.names?.map((n) => `${n.name ?? "none"} ${f2(n.cost)} x${f2(n.gap)}`).join(" / ") ?? "none"}`;
    }).join(" | "));
  }
} catch (err) {
  result.error = String(err?.stack ?? err);
  console.log(`couldn't run: ${result.error}`);
}
result.done = true;
console.log("done");
