// Runs the page checks (checks.js) for pages.html: for each, its seed (seeds.js) into localStorage, the app opened fresh
// in an iframe (or a top-level window, for a check that asks), and the check run against it; ?only=a,b runs just those,
// ?skip=a,b all but those.
// The results show on the page and, once all are done, in window.pageChecks ({ done, results: [{ check, ok, name,
// detail }], errors: [{ check, error }], ms }) and the title ("all passed" or "FAILED"), which tools/pagecheck.py reads.
import { CHECKS, media, patches, within } from "./checks.js";
import { SEEDS, STORAGE } from "./seeds.js";

const CHECK_MS = 60000;
const q = new URLSearchParams(location.search);
const only = q.get("only")?.split(",").filter(Boolean), skip = q.get("skip")?.split(",").filter(Boolean) ?? [];
const results = [], errors = [];
window.pageChecks = { done: false, results, errors };
const list = document.getElementById("results");
function show(check, ok, name, detail = "") {
  results.push({ check, ok, name, detail });
  const li = Object.assign(document.createElement("li"), { className: ok ? "ok" : "fail" });
  li.textContent = `${ok ? "ok  " : "FAIL"} ${check}: ${name}${detail ? `: ${detail}` : ""}`;
  list.append(li);
}

// The next macrotask, without setTimeout's clamping: the app's document is caught as soon as it exists.
const tick = () => new Promise((ok) => { const ch = new MessageChannel(); ch.port1.onmessage = ok; ch.port2.postMessage(0); });

// The app's window, once a document at `path` (other than `was`) is in it.
async function arrive(get, path, was = null) {
  const end = Date.now() + 10000;
  let w = null;
  while (Date.now() < end && !(w = get()?.location.pathname === path && get().document !== was && get())) await tick();
  if (!w) throw new Error(`${path} didn't open`);
  return w;
}
// Its error listeners and the screen-sharing stand-in, put in as soon as its document exists.
function attach(w, errs) {
  w.addEventListener("error", (e) => errs.push(`${e.message} (${e.filename}:${e.lineno})`));
  w.addEventListener("unhandledrejection", (e) => errs.push(`unhandled rejection: ${e.reason}${e.reason?.stack ? `\n${e.reason.stack}` : ""}`));
  const consoleError = w.console.error;
  w.console.error = (...a) => { errs.push(a.join(" ")); consoleError.apply(w.console, a); };
  if (w.navigator.mediaDevices) w.navigator.mediaDevices.getDisplayMedia = (options) => media.get(options);
  within(w);
  return w;
}
// Where a check's app is (its third argument): open(url, path) in a new iframe, true when its listeners went in before
// the app ran (module scripts wait for the page to be parsed, and the app's first drawing fills #main); follow(path)
// after the app went to another address itself; popup(url, path) in a top-level window, closed when the check ends.
function pageFor(errs, popups) {
  let frame = null, w = null;
  return {
    async open(url, path) {
      frame = Object.assign(document.createElement("iframe"), { allow: "display-capture", src: url });
      document.getElementById("stage").replaceChildren(frame);
      w = await arrive(() => frame.contentWindow, path);
      const early = w.document.readyState === "loading" || !w.document.querySelector("#main")?.children.length;
      attach(w, errs);
      return early;
    },
    async follow(path) {
      w = attach(await arrive(() => frame.contentWindow, path, w.document), errs);
    },
    async popup(url, path) {
      const win = window.open(url, "_blank", "width=1280,height=900");
      if (!win) throw new Error("the browser blocked the top-level window: allow pop-ups for this page");
      popups.push(win);
      w = attach(await arrive(() => win, path), errs);
    },
  };
}

const started = performance.now();
for (const name of [...(only ?? []), ...skip].filter((n) => !CHECKS[n])) show(name, false, "is a check", "no check by that name");
for (const [name, check] of Object.entries(CHECKS).filter(([n]) => (!only || only.includes(n)) && !skip.includes(n))) {
  const t = {
    ok: (cond, label, detail = "") => { show(name, !!cond, label, cond ? "" : String(detail)); return !!cond; },
    eq: (got, want, label) => t.ok(JSON.stringify(got) === JSON.stringify(want), label, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`),
  };
  const errs = [], popups = [];
  try {
    const seed = SEEDS[check.seed](Date.now(), check.game);
    localStorage.clear();
    localStorage.setItem(STORAGE[check.game], JSON.stringify(seed));
    media.get = media.refuse;
    patches.rates = check.rates ?? null;
    const page = pageFor(errs, popups);
    t.ok(await page.open(`/${check.game}${check.hash}`, `/${check.game}`), "error listeners in place before the app ran");
    await Promise.race([check.run(t, seed, page),
      new Promise((ok, fail) => setTimeout(() => fail(new Error(`timed out after ${CHECK_MS / 1000} s`)), CHECK_MS))]);
  } catch (err) {
    t.ok(false, "ran to the end", `${err}${err?.stack && !err.stack.startsWith(String(err)) ? `\n${err.stack}` : ""}`);
  }
  for (const win of popups) win.close();
  t.eq(errs, [], "no JS errors");
  errors.push(...errs.map((error) => ({ check: name, error })));
}
localStorage.clear();
const failed = results.filter((r) => !r.ok).length;
const summary = Object.assign(document.createElement("li"), { textContent: failed ? `${failed} FAILED` : "all passed" });
list.append(summary);
document.title = failed ? "FAILED" : "all passed";
Object.assign(window.pageChecks, { done: true, ms: Math.round(performance.now() - started) });
