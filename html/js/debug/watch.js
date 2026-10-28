// ?debug (SPEC.md §4.7): what watching the game sees, for a share that won't read. app.js loads this only with ?debug
// in the address. It shows nothing: when watching ends, the log downloads as a text file (the share's size and settings, how
// often it was looked at and read, the last read, each minute's reads (and their parts) and video, each minute's looks
// (the longest wait between two, the longest the video went without a new frame, the biggest change a look saw that
// wasn't enough to read), any wait of a second or more, and the newest reads), with the
// frames that matter: the last one in which rows were found, the last one in trouble (the window and its hover box
// found, but rows seen and no list made of them, or one list only with the other not shown empty), the last one with rows seen and the
// window not found, and the last one read, each once; and the read history (js/history.js) and the listings as
// JSON.
import { SIDE_SHARE, UNDERCUT_FLOOR } from "../calc.js";
import { game } from "../game.js";
import { allReads, HISTORY_FOR } from "../history.js";
import { state } from "../store.js";
import * as undercut from "../undercut.js";

const counts = new WeakMap(); // each watch's looks, reads, log, waits and video
const of = (watch) => {
  if (!counts.has(watch)) counts.set(watch, { looks: 0, blank: 0, reads: 0, last: "none", log: [], waits: [], minutes: [], video: null, lookAt: null });
  const c = counts.get(watch);
  if (!c.video && watch.video) c.video = follow(watch);
  return c;
};

// Each minute of watching (from 0): its reads, looks and video. A wait of a second or more (between looks, or for a new
// video frame) is also logged on its own, the last 30 kept.
const WAIT_LOGGED = 1000;
const minuteOf = (c, watch) => (c.minutes[Math.floor((Date.now() - watch.since) / 60000)] ??= {
  ms: [], fps: [], age: 0, looks: 0, lookGap: 0, frameGap: 0, change: 0, ...Object.fromEntries(PARTS.map((k) => [k, []])) });
const stamp = () => new Date().toISOString().slice(11, 23);
function waited(c, what, ms) {
  if (ms >= WAIT_LOGGED) c.waits = [...c.waits, `${stamp()} ${what} for ${(ms / 1000).toFixed(1)} s`].slice(-30);
}

// The shared video's frames as the page gets them (requestVideoFrameCallback): how many and when the newest came.
// Where the browser gives a frame's capture time, how long ago the newest was captured.
function follow(watch) {
  const { video } = watch, v = { frames: 0, at: null, captured: null, sawFrames: 0, sawAt: performance.now() };
  if (!video.requestVideoFrameCallback) return v;
  const frame = (now, md) => {
    if (watch.ended) return;
    if (v.at != null) {
      const c = counts.get(watch), m = minuteOf(c, watch), gap = now - v.at;
      m.frameGap = Math.max(m.frameGap, gap);
      waited(c, "no new video frame", gap);
    }
    Object.assign(v, { frames: md.presentedFrames, at: now });
    if (md.captureTime) v.captured = now - md.captureTime;
    video.requestVideoFrameCallback(frame);
  };
  video.requestVideoFrameCallback(frame);
  return v;
}
// The video since the last read: frames a second, the newest frame's age, frames dropped.
function videoNow(c, video) {
  const v = c.video, t = performance.now();
  if (!v?.at) return { text: "video: no frame timing", age: null };
  const fps = ((v.frames - v.sawFrames) * 1000) / Math.max(1, t - v.sawAt), age = t - v.at;
  Object.assign(v, { sawFrames: v.frames, sawAt: t });
  const dropped = video.getVideoPlaybackQuality?.().droppedVideoFrames;
  return { fps, age, text: `video ${fps.toFixed(1)} fps, newest frame ${Math.round(age)} ms old${v.captured == null ? "" : `, captured ${Math.round(v.captured)} ms ago`}${dropped == null ? "" : `, ${dropped} dropped`}` };
}
// A look at the window that didn't read it: no frame yet, or too little changed since the last read (`change`, the share
// of the 96 x 54 look that did).
export function looked(watch, frame, change = 0) {
  const c = of(watch);
  look(c, watch).change = Math.max(minuteOf(c, watch).change, change);
  if (!frame) c.blank++;
}
// Every look, read or not: counted, and the wait since the one before.
function look(c, watch) {
  const t = performance.now(), m = minuteOf(c, watch);
  c.looks++;
  m.looks++;
  if (c.lookAt != null) {
    m.lookGap = Math.max(m.lookGap, t - c.lookAt);
    waited(c, "no look", t - c.lookAt);
  }
  c.lookAt = t;
  return m;
}

// A read: what it found, how long it took (and its parts: drawing the video's frame, copying its pixels out, making
// them grey, and finding and reading what's in it), and whether the window was found.
const PARTS = ["draw", "copy", "grey", "find"];
export function read(watch, { found, ms, win, frame, lastPlace = false, parts = {} }) {
  const c = of(watch);
  c.lastFrame = frame;
  if (found.available || found.competing) c.rowsFrame = frame;
  const unread = !found.available && !found.competing && found.rows;
  if (win && found.hover && (unread || (!found.available !== !found.competing && !found.empty))) c.troubleFrame = frame;
  if (!win && unread) c.lostFrame = frame;
  const m = look(c, watch);
  c.reads++;
  const vid = videoNow(c, watch.video);
  m.ms.push(ms);
  for (const k of PARTS) if (parts[k] != null) m[k].push(parts[k]);
  if (vid.age != null) { m.fps.push(vid.fps); m.age = Math.max(m.age, vid.age); }
  const split = PARTS.filter((k) => parts[k] != null).map((k) => `${k} ${Math.round(parts[k])}`).join(", ");
  const [av, co] = [found.available?.length ?? 0, found.competing?.length ?? 0], rows = `available ${av}, competing ${co}${found.empty ? ` (no ${found.empty} trades)` : ""}`;
  c.last = `${Math.round(ms)} ms: available ${av} rows, competing ${co} rows; ${win ? `window buttons at x ${Math.round(win.left)} to ${Math.round(win.right)}, y ${Math.round(win.y)}` : "window not found"}`;
  c.log = [...c.log, `${stamp()} (${Math.round(ms)} ms${split ? `: ${split}` : ""}) page ${document.visibilityState}: ${rows}${unread ? `, ${found.rows} rows seen but not read` : ""}, window ${win ? "found" : lastPlace ? "not found, read where it last was" : "not found"}; ${vid.text}`].slice(-50);
}

// A note on the newest read (Import Market Ratios' verdict on it), added to its log line once (a count in it, such as
// the seconds since an import, may change in between).
const shape = (text) => text.replace(/\d+(\.\d+)?/g, "#");
export function note(watch, text) {
  const c = of(watch);
  if (!c.log.length || shape(c.log.at(-1)).endsWith(shape(`; ${text}`))) return;
  c.log = [...c.log.slice(0, -1), `${c.log.at(-1)}; ${text}`];
}

// Watching ended: everything seen, as a text file, with the frames that matter and the reads.
// The site's version (version.json, written at each deploy; the local server's names its commit), for the log.
const version = fetch("/version.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
export async function ended(watch, why) {
  const c = of(watch), stamp = Date.now();
  const frames = [[c.rowsFrame, "rows"], [c.troubleFrame, "trouble"], [c.lostFrame, "lost"], [c.lastFrame, "last"]]
    .filter(([f], i, all) => f && !all.slice(0, i).some(([g]) => g === f));
  const v = await version;
  const text = [`rainofchaos debug, ${new Date().toString()}`, `version ${v?.version ? `${v.version} (${v.commit})` : "unknown"}`,
    navigator.userAgent, `watching ended: ${why}`,
    `frames saved: ${frames.length ? frames.map(([, k]) => `rainofchaos-frame-${stamp}-${k}.png`).join(", ") : "none (nothing was read)"}`,
    "", lines(watch), ""];
  download(new Blob([text.join("\n")], { type: "text/plain" }), `rainofchaos-debug-${stamp}.txt`);
  // The frames are the bitmaps the reader was handed: drawn onto a canvas to save.
  for (const [f, k] of frames) {
    const c = Object.assign(document.createElement("canvas"), { width: f.width, height: f.height });
    c.getContext("2d").drawImage(f, 0, 0);
    c.toBlob((blob) => download(blob, `rainofchaos-frame-${stamp}-${k}.png`));
  }
  await downloadReads(stamp);
}

// The share, the counts, the last read, each minute, then the log.
function lines(watch) {
  const c = of(watch), { video } = watch, track = watch.stream?.getVideoTracks()[0];
  const q = video?.getVideoPlaybackQuality?.(), median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const looks = (m) => `${m.looks} looks, at most ${Math.round(m.lookGap)} ms apart; video at most ${Math.round(m.frameGap)} ms without a new frame; biggest change not read ${(100 * m.change).toFixed(1)}%`;
  const minutes = Array.from(c.minutes, (m, i) => !m ? `${i}: nothing` : `${i}: ${!m.ms.length ? "no reads" : `${m.ms.length} reads, median ${Math.round(median(m.ms))} ms${
    m.find.length ? ` (${PARTS.map((k) => `${k} ${Math.round(median(m[k]))}`).join(", ")})` : ""}${m.fps.length
    ? `; video median ${median(m.fps).toFixed(1)} fps, newest frame up to ${Math.round(m.age)} ms old` : ""}`}; ${looks(m)}`);
  return [
    `frame ${video?.videoWidth ?? 0} x ${video?.videoHeight ?? 0}; track ${track?.readyState ?? "none"} ${track ? JSON.stringify(track.getSettings()) : ""}`,
    `looked ${c.looks}, no frame yet ${c.blank}, read ${c.reads}${c.video?.frames ? `; video frames ${c.video.frames}` : ""}${q ? `, dropped ${q.droppedVideoFrames}` : ""}`,
    `last read: ${c.last}`, "", "each minute of watching (from 0):", ...minutes, "",
    `waits of a second or more (newest last): ${c.waits.length ? "" : "none"}`, ...c.waits, "", "reads (newest last):", ...c.log].join("\n");
}
function download(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The reads: every read in the history for this game and every listing (what each step's fill time was worked out
// from, and when it was done), with the site's version, how long reads are kept and the fill time's constants.
async function downloadReads(at) {
  const consts = Object.entries(undercut).filter(([, v]) => typeof v === "number");
  const data = { game: game.id, at, version: await version, constants: { ...Object.fromEntries(consts), UNDERCUT_FLOOR, SIDE_SHARE, HISTORY_FOR },
    reads: (await allReads()) ?? [], listings: state.listings ?? [] };
  download(new Blob([JSON.stringify(data)], { type: "application/json" }), `rainofchaos-reads-${at}.json`);
}
