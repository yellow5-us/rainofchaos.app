"""Run the test pages in headless browsers. Python stdlib only.

    python3 tools/pagecheck.py [--suite pages,calc,snip,rows|all] [--browser firefox,chrome|all] [--only name,...]
                               [--skip name,...] [--port N] [--shots DIR] [--timeout S] [--browsers FILE]

Starts tools/serve.py with the fixture rates on a free port (or --port), opens each suite's page in each browser at
once (tools/browsers.json, or --browsers: name -> driver, binary, args; tools/drivers.py; tools/browsers.ci.json is
GitHub's Ubuntu runners'), one suite after another in the same
browser, waits for each to finish, prints each browser's results and a summary, and stops the browsers and the
server. The suites: pages (tests/pages.html, the page checks; --only picks some, --skip leaves some out), calc (tests/index.html, the
calculation tests), snip and rows (tests/snip.html and rows.html, the readers' tests). All the checking happens in
the pages, so opening one by hand gives the same results. Exits 1 if anything failed. Browsers need the command
sandbox disabled.
"""

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import threading
import time
import urllib.request

from drivers import DRIVERS, free_port

ROOT = pathlib.Path(__file__).resolve().parent.parent
BROWSERS = {}


# Each suite's page. The page checks report through window.pageChecks; the others print "ok   <name>" or
# "FAIL <name>: <detail>" lines and end with "all passed" or "<n> FAILED".
SUITES = {"pages": "pages.html", "calc": "index.html", "snip": "snip.html", "rows": "rows.html"}
LINE = re.compile(r"^(ok|FAIL)\s+(.*?)(?:: (.*))?$")
END = re.compile(r"(?:^|\n)(all passed|\d+ FAILED)\s*$")


def results_of(suite, driver, args):
    end = time.time() + args.timeout
    while True:
        if suite == "pages":
            if result := driver.js("window.pageChecks?.done ? window.pageChecks : null"):
                return result["results"]
        else:
            text = driver.js("document.body?.innerText") or ""
            if END.search(text):
                return [{"check": suite, "ok": m[1] == "ok", "name": m[2], "detail": m[3] or ""}
                        for m in map(LINE.match, text.splitlines()) if m]
        if time.time() > end:
            raise RuntimeError(f"{suite} not done after {args.timeout:.0f} s")
        time.sleep(0.25)


def run(name, base, suites, args, out):
    started = time.time()
    driver = DRIVERS[BROWSERS[name]["driver"]](BROWSERS[name])
    results = []
    try:
        driver.start()
        for suite in suites:
            query = "&".join(f"{k}={v}" for k, v in (("only", args.only), ("skip", args.skip)) if v) if suite == "pages" else ""
            driver.goto(f"{base}/tests/{SUITES[suite]}{f'?{query}' if query else ''}")
            results += results_of(suite, driver, args)
            if args.shots:
                os.makedirs(args.shots, exist_ok=True)
                driver.screenshot(os.path.join(args.shots, f"{name}-{suite}.png"))
        out[name] = {"results": results, "seconds": time.time() - started}
    except Exception as err:
        out[name] = {"error": f"{type(err).__name__}: {err}", "results": results, "seconds": time.time() - started}
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def report(name, r):
    print(f"\n== {name} ({r['seconds']:.0f} s)")
    checks = {}
    for x in r["results"]:
        checks.setdefault(x["check"], []).append(x)
    width = max(map(len, checks), default=0)
    for check, rows in checks.items():
        bad = [x for x in rows if not x["ok"]]
        print(f"   {'ok  ' if not bad else 'FAIL'} {check:<{width}}  {len(rows) - len(bad)}/{len(rows)}")
        for x in bad:
            print(f"        {x['name']}: {x['detail']}")
    if "error" in r:
        print(f"   couldn't run: {r['error']}")
    return sum(1 for x in r["results"] if not x["ok"]) + ("error" in r)


def main():
    p = argparse.ArgumentParser(description="Run the test pages in headless browsers.")
    p.add_argument("--suite", default="pages,calc", help=f"comma-separated, from {', '.join(SUITES)}; or all")
    p.add_argument("--browser", default="firefox,chrome", help="comma-separated names from the browsers' file; or all")
    p.add_argument("--only", help="comma-separated page check names (the pages suite)")
    p.add_argument("--skip", help="comma-separated page check names to leave out (the pages suite)")
    p.add_argument("--port", type=int, help="port for the fixture server (default: a free one)")
    p.add_argument("--shots", help="save a screenshot per browser and suite, when done, in this folder")
    p.add_argument("--timeout", type=float, default=600, help="seconds per suite")
    p.add_argument("--browsers", default=str(ROOT / "tools" / "browsers.json"), help="the browsers' file (default tools/browsers.json)")
    args = p.parse_args()
    BROWSERS.update(json.loads(pathlib.Path(args.browsers).read_text()))
    names = list(BROWSERS) if args.browser == "all" else args.browser.split(",")
    if unknown := [n for n in names if n not in BROWSERS]:
        p.error(f"unknown browser: {', '.join(unknown)} ({args.browsers} has {', '.join(BROWSERS)})")
    suites = list(SUITES) if args.suite == "all" else args.suite.split(",")
    if unknown := [s for s in suites if s not in SUITES]:
        p.error(f"unknown suite: {', '.join(unknown)} (from {', '.join(SUITES)})")
    port = args.port or free_port()
    if port == 8765:
        p.error("8765 is the owner's server; pick another port")
    server = subprocess.Popen([sys.executable, str(ROOT / "tools" / "serve.py"), str(port), "--fixtures"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f"http://127.0.0.1:{port}"
        for _ in range(100):
            try:
                urllib.request.urlopen(f"{base}/tests/pages.html")
                break
            except OSError:
                time.sleep(0.05)
        started, out = time.time(), {}
        threads = [threading.Thread(target=run, args=(n, base, suites, args, out)) for n in names]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        server.terminate()
        server.wait()
    failed = {n: report(n, out[n]) for n in names}
    print(f"\n{'all passed' if not any(failed.values()) else 'FAILED'}: "
          + ", ".join(f"{n} {'ok' if not f else f'{f} failed'}" for n, f in failed.items())
          + f" ({time.time() - started:.0f} s)")
    sys.exit(1 if any(failed.values()) else 0)


if __name__ == "__main__":
    main()
