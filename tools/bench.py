"""Time the readers on the test frames (tests/bench.html) in headless browsers, against another version. Stdlib only.

    python3 tools/bench.py [--against REF] [--browser firefox|chrome|firefox,chrome|all] [--runs N] [--only file,...] [--json PATH]

Serves this working tree's site, with REF's html/js and html/data (any git ref: main, a commit, a branch) beside it,
on a free port, and opens /tests/bench.html?vs=... in Firefox (the owner's browser; others with --browser, one at
a time so they don't share the machine). Each frame is read by both versions, run for run in turn. Prints each frame
as it's done, then the medians (and 10th to 90th percentiles) per frame and in total, the change, and any frame whose
names differ; --json saves it all. It's run on demand only, and reports, never fails a run. Browsers
need the command sandbox disabled.
"""

import argparse
import io
import json
import os
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

from drivers import DRIVERS, free_port

ROOT = pathlib.Path(__file__).resolve().parent.parent
BROWSERS = json.loads((ROOT / "tools" / "browsers.json").read_text())


def extract(ref, into):
    """REF's html/js and html/data into `into`."""
    got = subprocess.run(["git", "-C", str(ROOT), "archive", ref, "html/js", "html/data"], capture_output=True)
    if got.returncode:
        sys.exit(f"{ref}: no html/js ({got.stderr.decode().strip()})")
    with tarfile.open(fileobj=io.BytesIO(got.stdout)) as t:
        try:
            t.extractall(into, filter="data")
        except TypeError:  # Python before 3.12 (macOS's python3 is 3.9) has no extraction filters
            t.extractall(into)


def run(name, url, timeout):
    driver = DRIVERS[BROWSERS[name]["driver"]](BROWSERS[name])
    try:
        driver.start()
        driver.goto(url)
        end, shown = time.time() + timeout, 0
        print(f"\n== {name}: timing", flush=True)
        while True:
            state = driver.js("window.bench ? { done: window.bench.done, total: window.bench.total, frames: window.bench.frames.slice(%d) } : null" % shown)
            for f in (state or {}).get("frames", []):
                shown += 1
                print(f"   {shown}/{state['total']} {progress(f)}", flush=True)
            if state and state["done"]:
                return driver.js("window.bench")
            if time.time() > end:
                raise RuntimeError(f"not done after {timeout} s")
            time.sleep(0.5)
    except Exception as err:
        return {"error": f"{type(err).__name__}: {err}"}
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def progress(f):
    """One frame's line while it runs: each version's median whole read."""
    if f.get("skipped"):
        return f"{f['file']}: skipped ({f['skipped']})"
    times = (f"{k} failed" if f[k].get("error") else f"{k} {f[k]['full']['median']:.0f} ms" for k in ("this", "vs") if k in f)
    return f"{f['file']}: " + ", ".join(times)


def report(name, r, ref):
    print(f"\n== {name}: results")
    if r.get("error"):
        print(f"   couldn't run: {r['error']}")
        return
    vs = "vs" in r["versions"]
    print(f"   whole read, median ms (10th-90th percentile), {r['runs']} runs" + (f"; this vs {ref}" if vs else ""))
    tot = {k: 0.0 for k in r["versions"]}
    names = {k: 0.0 for k in r["versions"]}
    for f in r["frames"]:
        if f.get("skipped"):
            print(f"   {f['file']:<36} skipped: {f['skipped']}")
            continue
        cells = []
        for k in r["versions"]:
            v = f[k]
            if v.get("error"):
                cells.append(f"{k}: {v['error']}")
                continue
            tot[k] += v["full"]["median"]
            names[k] += v["names"]["median"]
            cells.append(f"{v['full']['median']:7.1f} ({v['full']['p10']:.0f}-{v['full']['p90']:.0f})")
        if vs and not f["this"].get("error") and not f["vs"].get("error"):
            a, b = f["this"]["full"]["median"], f["vs"]["full"]["median"]
            cells.append(f"{(a - b) / b * 100:+5.0f}%")
            if f["this"]["read"] != f["vs"]["read"]:
                cells.append(f"names differ: this {f['this']['read']}, {ref} {f['vs']['read']}")
        print(f"   {f['file']:<36} " + "  ".join(cells))
    label = {"this": "this", "vs": ref}
    line = "   total: " + ", ".join(f"{label[k]} {tot[k]:.0f} ms (names {names[k]:.0f})" for k in r["versions"])
    if vs and tot["vs"]:
        line += f", {(tot['this'] - tot['vs']) / tot['vs'] * 100:+.1f}%"
    print(line)


def main():
    p = argparse.ArgumentParser(description="Time the readers on the test frames, against another version.")
    p.add_argument("--against", metavar="REF", help="git ref to compare with (default: none, this version alone)")
    p.add_argument("--browser", default="firefox", help=f"comma-separated, from {', '.join(BROWSERS)}; or all")
    p.add_argument("--runs", type=int, default=15, help="timed runs per frame and version")
    p.add_argument("--only", help="comma-separated frame files")
    p.add_argument("--json", help="save the results here")
    p.add_argument("--timeout", type=float, default=900, help="seconds per browser")
    args = p.parse_args()
    names = list(BROWSERS) if args.browser == "all" else args.browser.split(",")
    if unknown := [n for n in names if n not in BROWSERS]:
        p.error(f"unknown browser: {', '.join(unknown)} (tools/browsers.json has {', '.join(BROWSERS)})")
    with tempfile.TemporaryDirectory(prefix="rainofchaos-bench-") as tmp:
        for folder in ("html", "tests"):
            os.symlink(ROOT / folder, os.path.join(tmp, folder))
        query = f"runs={args.runs}" + (f"&only={args.only}" if args.only else "")
        if args.against:
            extract(args.against, os.path.join(tmp, "vs"))
            query += "&vs=/vs/html"
        port = free_port()
        server = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", tmp],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            url = f"http://127.0.0.1:{port}/tests/bench.html?{query}"
            for _ in range(100):
                try:
                    urllib.request.urlopen(url)
                    break
                except OSError:
                    time.sleep(0.05)
            out = {}
            for n in names:
                out[n] = run(n, url, args.timeout)
                report(n, out[n], args.against)
                if args.json:  # after each browser, so a run stopped early keeps what's done
                    pathlib.Path(args.json).write_text(json.dumps({"against": args.against, "browsers": out}, indent=1))
        finally:
            server.terminate()
            server.wait()


if __name__ == "__main__":
    main()
