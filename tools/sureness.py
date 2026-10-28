"""How sure the readers are of what they read on the test frames (tests/sureness.html), against another version.
Stdlib only.

    python3 tools/sureness.py [--against REF] [--browser firefox|chrome|...] [--only file,...] [--json PATH]

Serves this working tree's site, with REF's html/js and html/data beside it (as tools/bench.py does), opens
/tests/sureness.html in each browser asked for, and prints, per frame and version, the lists read, the least sure
list row and the names' costs, then a summary: rows read, their sureness (lowest, 10th percentile, median), how many
are under 0.15 and under 0.09 (the reader's SURE: such a row isn't read), names certain, and the smallest gap between a
name and the next nearest; and any frame whose lists or names differ between the versions. Timing is bench.py's.
Reports, never fails. Browsers need the command sandbox disabled.
"""

import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.request

from bench import extract
from drivers import DRIVERS, free_port

ROOT = pathlib.Path(__file__).resolve().parent.parent
BROWSERS = json.loads((ROOT / "tools" / "browsers.json").read_text())
CLOSE, SURE = 0.15, 0.09


def run(name, url, timeout):
    driver = DRIVERS[BROWSERS[name]["driver"]](BROWSERS[name])
    try:
        driver.start()
        driver.goto(url)
        end = time.time() + timeout
        print(f"\n== {name}: measuring", flush=True)
        while True:
            if (state := driver.js("window.sureness?.done ? window.sureness : null")):
                return state
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


def pct(xs, p):
    s = sorted(xs)
    return s[min(len(s) - 1, int(p * len(s)))] if s else None


def f2(v):
    return "-" if v is None else f"{v:.2f}"


def report(name, r, ref):
    print(f"\n== {name}: results")
    if r.get("error"):
        print(f"   couldn't run: {r['error']}")
        return
    label = {"this": "this", "vs": ref}
    for f in r["frames"]:
        cells = []
        for k in r["versions"]:
            m = f[k]
            if m.get("error"):
                cells.append(f"{label[k]} failed: {m['error']}")
                continue
            s = [x["sure"] for x in m["rows"] if x["sure"] is not None]
            names = " / ".join(f"{n['name'] or 'none'} {f2(n['cost'])} x{f2(n['gap'])}" for n in m["names"] or []) or "no names"
            cells.append(f"{label[k]}: {'/'.join(map(str, m['lists']))}, least {f2(min(s) if s else None)}, {names}")
        print(f"   {f['file']:<36} " + "  |  ".join(cells))
    print("   summary:")
    for k in r["versions"]:
        ms = [f[k] for f in r["frames"] if not f[k].get("error")]
        s = [x["sure"] for m in ms for x in m["rows"] if x["sure"] is not None]
        names = [n for m in ms for n in (m["names"] or [])]
        gaps = [n["gap"] for n in names if n["gap"] is not None]
        print(f"   {label[k]}: {len(s)} rows, sureness lowest {f2(min(s) if s else None)}, 10th percentile {f2(pct(s, 0.1))}, "
              f"median {f2(pct(s, 0.5))}; {sum(v < CLOSE for v in s)} under {CLOSE}, {sum(v < SURE for v in s)} under {SURE}; "
              f"names {sum(1 for n in names if n['name'])} of {len(names)} certain, smallest gap x{f2(min(gaps) if gaps else None)}")
    if "vs" in r["versions"]:
        differ = [f["file"] for f in r["frames"] if not f["this"].get("error") and not f["vs"].get("error")
                  and ([x["text"] for x in f["this"]["rows"]], [n["name"] for n in f["this"]["names"] or []])
                  != ([x["text"] for x in f["vs"]["rows"]], [n["name"] for n in f["vs"]["names"] or []])]
        print(f"   lists or names differ on: {', '.join(differ) if differ else 'none'}")


def main():
    p = argparse.ArgumentParser(description="Measure the readers' sureness on the test frames, against another version.")
    p.add_argument("--against", metavar="REF", help="git ref to compare with (default: none, this version alone)")
    p.add_argument("--browser", default="firefox", help=f"comma-separated, from {', '.join(BROWSERS)}; or all")
    p.add_argument("--only", help="comma-separated frame files")
    p.add_argument("--json", help="save the results here")
    p.add_argument("--timeout", type=float, default=600, help="seconds per browser")
    args = p.parse_args()
    names = list(BROWSERS) if args.browser == "all" else args.browser.split(",")
    if unknown := [n for n in names if n not in BROWSERS]:
        p.error(f"unknown browser: {', '.join(unknown)} (tools/browsers.json has {', '.join(BROWSERS)})")
    with tempfile.TemporaryDirectory(prefix="rainofchaos-sureness-") as tmp:
        for folder in ("html", "tests"):
            os.symlink(ROOT / folder, os.path.join(tmp, folder))
        query = f"only={args.only}" if args.only else ""
        if args.against:
            extract(args.against, os.path.join(tmp, "vs"))
            query += ("&" if query else "") + "vs=/vs/html"
        port = free_port()
        server = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", tmp],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            url = f"http://127.0.0.1:{port}/tests/sureness.html?{query}"
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
                if args.json:
                    pathlib.Path(args.json).write_text(json.dumps({"against": args.against, "browsers": out}, indent=1))
        finally:
            server.terminate()
            server.wait()


if __name__ == "__main__":
    main()
