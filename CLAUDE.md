# rainofchaos

Path of Exile 1 currency-exchange flip calculator (Div → Item → Chaos → Div and variants).
**SPEC.md is the source of truth** for the rules (ratios, lots, routes, fill time, filters, UI).
Read the relevant section before changing behaviour, and update SPEC.md in the same change.

## Layout
- `html/`: static site, plain HTML/CSS/JS ES modules (deployed as is to the bucket's `html/`, which CloudFront serves).
  No build step, no frameworks, no npm deps.
  `js/calc.js` (route math), `js/undercut.js` (how fast orders are posted ahead and bought, for fill times), `js/rates.js` (rates.json helpers), `js/store.js` (localStorage
  `rainofchaos:v1`), `js/history.js` (2 weeks of list reads in IndexedDB, for analysis), `js/app.js` (pages), `js/items.js` (ids, names, icons, gold, the game's hub
  currencies), `js/game.js` (per-game config: hubs, data files, starting options, storage key),
  `js/snip.js` (finds the game's window in a frame and the lists' places in it; its line reader, for learning the font;
  and the currency names), `js/rows.js` (reads each row in its slot by drawing reference characters at the row's size; the
  references are in `data/glyphs.json`, `rows`), `js/reader.js` (the price reader: a worker that reads each watched frame with
  those two, so the page never waits on a read, sharing each read with a helper worker of itself), `js/debug/watch.js` (`?debug` only: what watching the game sees).
- `tests/`: the browser and JavaScriptCore tests (they import `../html/js/…`), the page checks and the test frames
  (`tests/snips/`). Not deployed.
- `job/rates.py`: hourly Lambda (Python, stdlib only) that turns GGG's public currency-exchange
  digests into `html/rates.json` (and `html/poe2/rates.json`) in the bucket, keeping its state in `job/` and every hour's markets in `history/` (a file per hour, kept for good). The API has no CORS, so the browser can't call it directly.
- `tools/catalog.py`: rebuilds `html/data/catalog.json` (names and icons). `tools/gold.py [poe1|poe2]`: adds the gold fees
  `html/data/gold.json` (PoE2: `poe2/gold.json`) doesn't have, from poedb (the game's own data), keeping the rest.
- Infrastructure: Terraform in a separate private repo (where it lives locally is in the global CLAUDE.md).

## Commands
- Calc tests: `tests/index.html` in Firefox and Chrome (`python3 tools/pagecheck.py --suite calc`, below), and
  `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/calc.test.js`
  (all three, see the global CLAUDE.md). No Node.
- Snip reader tests: `tests/snip.html` and `tests/rows.html` in Firefox and Chrome
  (`python3 tools/pagecheck.py --suite snip,rows`, below; they decode PNGs, so not in JavaScriptCore). snip.html's button rebuilds `html/data/glyphs.json` (the names' letters and the row reader's references) and
  `tests/lines.json` (the line reader's examples, which the references are read with) from `tests/snips/`; do that after adding snips or changing how either reader reads, then run both.
- Job tests: `python3 -m unittest discover -s job -q`
- Local site: `python3 tools/serve.py` (serves `html/` at `/`, `/poe1` and `/poe2` like S3 does, and `/tests/` and `/html/`
  as those folders). It needs `html/rates.json`
  and `html/poe2/rates.json` (gitignored; `curl -o html/poe2/rates.json https://rainofchaos.app/poe2/rates.json`):
  `curl -o html/rates.json https://rainofchaos.app/rates.json`.
- Browser checks (headless Firefox and Chrome, see the global CLAUDE.md): first check for a server already on 8765
  (`lsof -nP -iTCP:8765 -sTCP:LISTEN`) and use it; the owner often has one running. Otherwise start
  `python3 tools/serve.py` in the background yourself and stop it when done.
- Page checks (the common checks of a test round, every page in both games, against fixed data): `python3 tools/pagecheck.py`
  (command sandbox disabled) runs `tests/pages.html` and the calc tests in headless Firefox and Chrome at once, on its
  own server and port (never 8765), in about 40 seconds; `--suite pages,calc,snip,rows|all` (default `pages,calc`; snip and
  rows add about a minute and a half), `--browser firefox|chrome|all`, `--only name,...` (page checks), `--shots DIR`.
  Use it for every browser test page: don't write Marionette or DevTools scripts for them. By hand: start
  `python3 tools/serve.py <port> --fixtures` and open `/tests/pages.html` (`?only=name,...`) in any browser. The checks are
  `tests/pages/checks.js`, the saved states they start from `seeds.js`, the rates `rates.json` and `poe2/rates.json`
  there. Add a check there when a round checks something new by hand. A browser is one entry in `tools/browsers.json`:
  `driver` (`marionette` for Firefox's family, `cdp` for any Chromium, `webdriver` for a W3C WebDriver server such as
  safaridriver), `binary`, `args` (`{port}` and `{profile}` filled in) and, for `webdriver`, `capabilities`.
- Reader timings: `python3 tools/bench.py --against main` (command sandbox disabled) times this working tree's readers against
  another git ref's on the test frames with the window (`tests/bench.html`), in headless Firefox (`--browser` for others), and
  prints medians per frame and in total; `--json PATH` saves it. Run it only on demand: not in test rounds, PRs or the design and practice pages. It reports, never fails.
- Reader sureness: `python3 tools/sureness.py --against main` (command sandbox disabled) measures how sure this working tree's
  readers are of each list row and name on the test frames (`tests/sureness.html`) against another git ref's, and prints
  per frame and a summary (rows under 0.15 and under 0.09, names certain, the smallest name gap) and any frame whose lists or
  names differ; `--json PATH` saves it. Separate from timings; on demand only, like bench.py. It reports, never fails.
- CI, by hand only (nothing runs on pushes), for the owner: sessions run every test round locally and don't start it.
  `gh workflow run tests.yml --ref <branch>` (or the Actions tab's Run workflow) runs
  `.github/workflows/tests.yml` on GitHub's Ubuntu runners (pagecheck.py with
  `--browsers tools/browsers.ci.json` in Firefox and Chrome, pages and calc, plus snip and rows when image-reading code,
  its data or the test frames changed, and without importOffPage, which times pauses the runners cause; the calc tests in
  JavaScriptCore, run by Bun; the job tests). Failed runs keep screenshots.
- Deploy: merging to main deploys automatically (`.github/workflows/deploy.yml`: changes under job/
  → job, html/ or deploy.sh → site). Each site deploy is a release: git tag and GitHub release `YYYY-MM-DD-N` (UTC
  date, N from 1 each day), with a `version.json` (version and commit) that `?debug`'s log names; the page doesn't
  show it. Manual: `AWS_PROFILE=<profile> ./deploy.sh job [backfill] | site`, the profile named in the global CLAUDE.md (its
  version.json says `local-<commit>`).

## Conventions
- Work on a branch and open a PR. The owner merges; never push to main.
- Ratios are entered exactly as the game displays them (two decimals, rounded half up). Don't
  "normalise" them.
- Keep the code style as is: small modules, few comments, no new dependencies.
- After an edit, check the diff for collateral removals. Scripted edits have deleted adjacent code
  here before.
- `deploy.sh site` syncs `html/` to the bucket's `html/` with `--delete` but must keep excluding `rates.json` and
  `poe2/rates.json`, which the Lambda owns, and what the deploy and the owner write there (`version.json`, `poe1`,
  `poe2`, `debug-algorithm/*`).
- Never put the owner's email or other personal data in requests (User-Agent etc.). The User-Agent is
  `rainofchaos/1.0 (+https://rainofchaos.app)`.
- The owner uses Firefox; Chrome-only CSS niceties are acceptable.
- Pages are called by their nav name everywhere: UI text, links, hovers, the home guide, SPEC.md, comments and checks.
  Renaming a nav item renames every reference to that page, and its address follows the new name (`#/<name-in-kebab-case>`,
  e.g. Volumes is `#/volumes`). Old addresses aren't kept: no redirects or fallbacks for them.
