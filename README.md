# rainofchaos

**[rainofchaos.app](https://rainofchaos.app)** finds profitable round trips on Path of Exile's Currency Exchange: start
with Chaos or Divine Orbs, buy a currency, sell it, and end with more of what you started with (Exalted or Divine Orbs
in Path of Exile 2), for Path of Exile 1 and Path of Exile 2 on the PC realm. Reading prices from Path of Exile 2 isn't
fully tested yet.

Its prices come from the game itself: Import Market Ratios watches the game's window (shared from the browser)
and reads each pair's prices off the Currency Exchange; a scan is used for 4 hours. The game's public currency-exchange
history, refreshed every hour, gives volumes, sanity checks and, for pairs not scanned, estimates (Estimated Trading).

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

## What it does

- **Recommendations:** every route of every tradable currency, sorted into Profitable, Unprofitable and
  Untradeable, for Competitive Trading (posting your own orders and waiting), Instant Trading (filling existing
  orders) or Estimated Trading (the trades not scanned, priced from the last hour's trades). Each currency's page shows its routes step by step, with gold fees and how long they should take to fill.
- **Listings:** the trades you've added with Add to Listings, followed step by step as you post and fill them,
  each step's price kept from the scans or typed in (Manual), with the profit projected and, once completed, made.
- **Getting prices:** prices come from the game. **Import Market Ratios** (top right) shares the game's window
  and fills in every pair you look at. The game is read in your browser; nothing is uploaded. Where importing doesn't
  work, **Estimated Trading** prices pairs from the last hour's trades instead, as a rough guide.
- **Market Ratios, Volumes:** every price you've read in the last 4 hours, and what traded last hour.
- **Gold fees** come from the game's own data, as listed on poedb, and are shown but never edited.

## How it's built

- `html/`: a static site, plain HTML, CSS and JavaScript ES modules, with no build step and no dependencies.
- `job/rates.py`: an hourly AWS Lambda (Python, standard library only) that turns GGG's public currency-exchange
  digests into `rates.json` on S3. The API has no CORS, so the browser can't read it directly.
- `tools/`: `serve.py` (local server), `pagecheck.py` (the page checks in headless Firefox and Chrome, with `drivers.py`
  and `browsers.json`), `bench.py` and `sureness.py` (the price reader's speed and sureness against another git ref),
  `catalog.py` (rebuilds the currency names and icons), `gold.py` (adds missing gold fees from poedb).
- Hosting is S3 behind CloudFront; the Terraform lives in a separate repository.

**[SPEC.md](SPEC.md) is the source of truth** for how everything works: ratios, lots, routes, fill time, filters, the
screenshot reader and the UI. Change it together with the code.

Built with [Claude Code](https://claude.com/claude-code); its working notes for this project (layout, commands,
conventions) are in [CLAUDE.md](CLAUDE.md).

## Running it locally

```sh
curl -o html/rates.json https://rainofchaos.app/rates.json
curl -o html/poe2/rates.json https://rainofchaos.app/poe2/rates.json
python3 tools/serve.py          # http://localhost:8765/ (/poe1 and /poe2 as in production)
```

Add `?debug` to the address (e.g. `/poe1?debug`) for what Import Market Ratios sees while it watches the game.

## Tests

There's no Node: the JavaScript tests run in browsers.

- **Route math:** open `tests/index.html`, or headless with macOS's JavaScriptCore:
  `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/calc.test.js`
- **Screenshot reader:** open `tests/snip.html` and `tests/rows.html` (they decode real screenshots of the
  game, in `tests/snips/`).
- **Pages:** `python3 tools/pagecheck.py` runs `tests/pages.html` (every page in both games, against fixed data) and the
  route math in headless Firefox and Chrome; `--suite snip,rows` adds the screenshot reader.
- **Rates job:** `python3 -m unittest discover -s job -q`
- **CI, by hand:** `gh workflow run tests.yml --ref <branch>` runs these on GitHub's runners; nothing runs on pushes.

## Deploying

Merging to `main` deploys automatically (`.github/workflows/deploy.yml`): changes under `job/` deploy the Lambda,
changes under `html/` or to `deploy.sh` deploy the site. By hand: `./deploy.sh job [backfill] | site`.

## Support

rainofchaos is free. If it's made you some Divines, you can support it on [Ko-fi](https://ko-fi.com/prinny5).

## License

Copyright (C) 2026 prinny5.

The rainofchaos code is free software: you can redistribute it and/or modify it under the terms of the GNU Affero
General Public License as published by the Free Software Foundation, version 3 (see [LICENSE](LICENSE)). It comes with
no warranty. If you run a modified version as a website, the AGPL asks you to offer its users your source.

Path of Exile and its content belong to Grinding Gear Games and aren't covered by this license: the game screenshots
under `tests/snips/`, the currency names and icon links in `html/data/catalog.json`, the gold fees in
`html/data/gold.json`, and the prices the rates job reads from GGG's API. This project isn't affiliated with or endorsed by Grinding Gear Games.
