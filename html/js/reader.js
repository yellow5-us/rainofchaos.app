// The price reader, in a worker (SPEC.md §4.7): watching hands it each frame to read as a bitmap, so the page never
// waits on a read. Started with the catalog's names ({ names }); it loads data/glyphs.json and answers { ready } or
// { failed }. Then each frame ({ id, bitmap, style, last, crops, debug }) is answered with what's in it (`read`).
// A second worker, a helper (this same script, started with { names, helper: true }), reads Competing's rows while
// this one reads the rest, and then the I Have name while this one reads I Want; without it, this one reads it all.
import { cropLum, findWindows, nameBoxes, nameOf, rankNames, readNames, toLum, unpackNames } from "./snip.js";
import { findAll, joinRows, rowsAt, unpackModel } from "./rows.js";

let reader = null, helper = null, kept = null;
onmessage = async ({ data: m }) => {
  if (m.names) {
    try {
      const json = await (await fetch("/data/glyphs.json")).json();
      reader = { names: unpackNames(json), model: unpackModel(json.rows), all: m.names };
      if (!m.helper) helper = await startHelper(m.names);
      postMessage({ ready: true });
    } catch (e) {
      postMessage({ failed: String(e) });
    }
    return;
  }
  try {
    postMessage({ id: m.id, ...(m.lower ? lower(m) : m.side ? side(m) : await read(m)) });
  } catch (e) {
    postMessage({ id: m.id, failed: String(e) });
  }
};

// The helper, as a function that hands it a frame and resolves to its answer; null if it can't be started. One that dies,
// or doesn't answer within HELPER_WAIT (a read takes a second at most), is let go: what it was asked answers { failed },
// and this worker reads it all itself from then on.
const HELPER_WAIT = 5000;
async function startHelper(names) {
  try {
    const worker = new Worker(new URL("./reader.js", import.meta.url), { type: "module" });
    const ok = await new Promise((done) => {
      worker.onmessage = ({ data }) => done(!!data.ready);
      worker.onerror = () => done(false);
      worker.postMessage({ names, helper: true });
    });
    if (!ok) { worker.terminate(); return null; }
    let id = 0, gone = false;
    const waiting = new Map();
    const drop = (why) => {
      if (gone) return;
      gone = true;
      worker.terminate();
      helper = null;
      for (const done of waiting.values()) done({ failed: why });
      waiting.clear();
    };
    worker.onmessage = ({ data }) => { waiting.get(data.id)?.(data); waiting.delete(data.id); };
    worker.onerror = worker.onmessageerror = () => drop("helper failed");
    return (msg, transfer) => new Promise((done) => {
      if (gone) { done({ failed: "helper gone" }); return; }
      msg.id = ++id;
      const timer = setTimeout(() => drop("helper timed out"), HELPER_WAIT);
      waiting.set(msg.id, (data) => { clearTimeout(timer); done(data); });
      worker.postMessage(msg, transfer);
    });
  } catch {
    return null;
  }
}

// A frame's pixels (and their luminance), with how long drawing, copying them out and making them grey took.
function pixelsOf(bitmap) {
  const t0 = performance.now(), canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  const t1 = performance.now(), data = g.getImageData(0, 0, canvas.width, canvas.height), t2 = performance.now();
  const img = toLum(data), t3 = performance.now();
  return { data, img, at: t3, parts: { draw: t1 - t0, copy: t2 - t1, grey: t3 - t2 } };
}
// Where the window may be: its buttons as found, else where it last was (`last`, when the frame misses it).
const windowsIn = (data, style, last) => {
  const wins = findWindows(data, style);
  return wins.length || !last ? wins : [last];
};

// The helper's part of a frame ({ bitmap, style, last }): Competing's rows in the first window's hover box ({ lines }).
// The frame is kept for its I Have name (`side`).
function lower({ bitmap, style, last }) {
  kept = null;
  const { data, img } = pixelsOf(bitmap), wins = windowsIn(data, style, last);
  kept = img;
  return { lines: wins.length ? rowsAt(img, reader.model, wins[0], [2]) : null };
}
// The helper's I Have name in the frame it read last, from the lists' place ({ place, debug }): nameIn's.
const side = ({ place, debug }) => nameIn(kept, readNames(kept, place, reader.names).right, debug);
// A name box's text (readNames') as the catalog's name ({ name }, null when not certain) and, with `debug`, the nearest
// two (`rank`).
function nameIn(img, text, debug) {
  const seen = text && seenBox(img, text.box);
  if (seen?.got && (seen.got.rank || !debug)) return seen.got;
  const got = { name: (text && nameOf(text, reader.names, reader.all)) || null,
    rank: debug && (text ? rankNames(text, reader.names, reader.all, 2).map((r) => `${r.name} ${r.cost.toFixed(2)}`).join(" / ") : "no box") };
  if (seen) seen.got = got;
  return got;
}
// The last NAMES_KEPT name boxes read, with what they read as: a box whose every pixel is within NAME_SAME grey levels
// of one of them, at the same size, reads as it did, without matching it against the catalog again (the game draws a
// box alike each time; another name, or a cursor over it, changes many pixels by far more). Returns the box kept
// ({ size, lum, got }, `got` null for a box new to it).
const NAMES_KEPT = 8, NAME_SAME = 24, boxesSeen = [];
function seenBox(img, b) {
  const size = [b.x1 - b.x0 + 1, b.y1 - b.y0 + 1], { lum } = cropLum(img, b.x0, b.y0, ...size);
  const alike = (k) => k.size[0] === size[0] && k.size[1] === size[1] && k.lum.every((v, i) => Math.abs(v - lum[i]) <= NAME_SAME);
  const i = boxesSeen.findIndex(alike), box = i >= 0 ? boxesSeen.splice(i, 1)[0] : { size, lum, got: null };
  boxesSeen.unshift(box);
  boxesSeen.length = Math.min(boxesSeen.length, NAMES_KEPT);
  return box;
}

// One frame: { same } when a reading waiting on its second read (`crops`, keyCrops') is still there as it was; else the
// lists (`found`, findAll's), the names as the catalog's (null when not certain; `ranks`, with `debug`, the nearest of
// each), the reading's `crops`, and how long its parts took. The helper gets the frame at once, or after the `crops`
// check when there's one.
async function read({ bitmap, style, last, crops, debug }) {
  const help = helper, spare = help && await createImageBitmap(bitmap);
  const ask = () => help({ lower: true, bitmap: spare, style, last }, [spare]);
  let asked = spare && !crops ? ask() : null;
  const { data, img, at, parts } = pixelsOf(bitmap);
  if (crops && sameKeys(img, crops)) { spare?.close(); return { same: true }; }
  if (spare && !asked) asked = ask();
  const wins = windowsIn(data, style, last);
  let first = null;
  if (asked && wins.length) {
    const upper = rowsAt(img, reader.model, wins[0], [0, 1]), { lines } = await asked;
    first = upper && lines ? joinRows(upper, lines, wins[0]) : null;
  }
  const found = findAll(data, img, reader.model, wins, style, first);
  const readable = (found.available && found.competing) || found.empty;
  let names = null, ranks = false;
  if (readable && found.place) {
    const there = asked && help({ side: true, place: found.place, debug }), texts = readNames(img, found.place, reader.names);
    const left = nameIn(img, texts.left, debug), got = there && await there;
    const right = got && !got.failed ? got : nameIn(img, texts.right, debug);
    names = [left.name, right.name];
    ranks = debug && [left.rank, right.rank];
  }
  const t4 = performance.now();
  return { found, names, ranks, crops: names?.every(Boolean) ? keyCrops(img, found) : null,
    parts: { ...parts, find: t4 - at } };
}

// What a reading rests on, as pixels: the two name boxes and the first row (its best price) of each list read. A later
// frame whose pixels there are the same (within KEY_SAME grey levels on average) reads the same, so it confirms the
// reading without reading it again; anything else there (a cursor, a new stock) is read as usual.
const KEY_SAME = 6;
function keyCrops(img, found) {
  const p = found.place;
  if (!p) return null;
  const { left, right } = nameBoxes(img, p);
  const firstRow = (y) => y != null && [Math.round(p.x0 - 0.3 * p.pitch), Math.round(y - 0.5 * p.pitch), Math.round(p.x1 - p.x0 + 0.6 * p.pitch), Math.round(p.pitch)];
  const rects = [left && [left.x0, left.y0, left.x1 - left.x0 + 1, left.y1 - left.y0 + 1], right && [right.x0, right.y0, right.x1 - right.x0 + 1, right.y1 - right.y0 + 1],
    ...["available", "competing"].filter((k) => found[k]).map((k) => firstRow(p.firstRows[k]))];
  if (rects.some((r) => !r || r[0] < 0 || r[1] < 0 || r[2] < 1 || r[3] < 1 || r[0] + r[2] > img.w || r[1] + r[3] > img.h)) return null;
  return rects.map((r) => ({ r, lum: cropLum(img, ...r).lum }));
}
function sameKeys(img, crops) {
  if (crops.some(({ r }) => r[0] + r[2] > img.w || r[1] + r[3] > img.h)) return false;
  return crops.every(({ r, lum }) => {
    const now = cropLum(img, ...r).lum;
    let d = 0;
    for (let i = 0; i < lum.length; i++) d += Math.abs(now[i] - lum[i]);
    return d / lum.length <= KEY_SAME;
  });
}
