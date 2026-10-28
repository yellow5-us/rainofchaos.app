"""Hourly job: fold GGG currency-exchange digests into rates.json (SPEC.md §6).

Runs once per game (GAMES): Path of Exile 1 (the PC realm) and Path of Exile 2 (the poe2 realm).
Tracks every currency that traded against one of the game's hub currencies within the last DAYS days.
The per-hour volume history lives in a separate state file; rates.json is the slim copy the site loads.
Every hour's markets are also kept for good in private history files, one per hour, for trends by hour and weekday.
"""

import gzip
import json
import os
import time
import urllib.error
import urllib.request

API = "https://web.poecdn.com/api/currency-exchange/{}"  # /<realm>/<id>, or /<id> for the PoE1 PC realm
HOUR = 3600
DAYS = 1                       # keep pairs that traded within this many days
LOOKBACK = DAYS * 24 * HOUR    # also the window for the dayA/dayB totals
MAX_PAGES = 30                 # catch-up limit per run
RECENT_HOURS = 4               # window for the "recent" volume totals (fill-time estimates)

CHAOS = "CurrencyRerollRare"
DIVINE = "CurrencyModValues"
EXALTED = "CurrencyAddModToRare"
BASES = {CHAOS, DIVINE}  # PoE1's hubs, the default everywhere below
SKIPPED_KINDS = {"private", "ruthless"}  # leagues the site never offers
# A history market: these digest fields, each but the first as [a, b] in market_pair's order.
HISTORY_FIELDS = ["market_pair", "volume_traded", "lowest_stock", "highest_stock", "lowest_ratio", "highest_ratio"]

# Per game: the API realm ("" is PoE1 PC), its hub currencies, and where its output goes (env overrides).
GAMES = {
    "poe1": {"realm": "", "hubs": BASES, "rates_key": ("RATES_KEY", "html/rates.json"),
             "state_key": ("STATE_KEY", "job/state.json")},
    "poe2": {"realm": "poe2", "hubs": {CHAOS, DIVINE, EXALTED}, "rates_key": ("POE2_RATES_KEY", "html/poe2/rates.json"),
             "state_key": ("POE2_STATE_KEY", "job/poe2/state.json")},
}


def wanted(a, b, hubs=BASES):
    """Any currency vs a hub (including hub vs hub). Item-to-item pairs aren't used."""
    return a != b and (a in hubs or b in hubs)


def short_id(metadata_id):
    return metadata_id.rsplit("/", 1)[-1]


def league_kind(name):
    if name == "Standard":
        return "standard"
    if "(PL" in name:
        return "private"
    if "Ruthless" in name:  # e.g. "Ruthless Allflame", "HC Ruthless Allflame"
        return "ruthless"
    if name.startswith(("Hardcore", "HC ")):
        return "hardcore"
    return "challenge-softcore"


def fetch_page(change_id, user_agent, realm=""):
    path = f"{realm}/{change_id}" if realm else f"{change_id}"
    req = urllib.request.Request(API.format(path), headers={"User-Agent": user_agent})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        # An unfinished hour is a 404 whose body is still a valid "caught up" page.
        if e.code == 404:
            return json.load(e)
        raise


def merge_page(state, hour, page, hubs=BASES):
    """Fold one hourly digest into state.

    Each pair keeps its newest hour that had trades (volA/volB) plus a per-hour volume history
    ("history": [[hour, volA, volB], ...]) used for the dayA/dayB totals."""
    for market in page.get("markets", []):
        name = market["league"]
        if league_kind(name) in SKIPPED_KINDS:
            continue
        a, b = (short_id(x) for x in market["market_pair"])
        if not wanted(a, b, hubs):
            continue
        vol = {short_id(k): v for k, v in market["volume_traded"].items()}
        if not vol.get(a) or not vol.get(b):
            continue
        league = state["leagues"].setdefault(name, {"kind": league_kind(name), "chaosVolume": 0, "pairs": {}})
        key = "|".join(sorted((a, b)))
        current = league["pairs"].get(key)
        if current:
            history = current.setdefault("history", [])
            if all(h != hour for h, _, _ in history):
                history.append([hour, vol[current["a"]], vol[current["b"]]])  # in the stored a/b order
            if current["hour"] > hour:
                continue
        else:
            history = [[hour, vol[a], vol[b]]]
        pa, pb = (current["a"], current["b"]) if current else (a, b)
        league["pairs"][key] = {"a": pa, "b": pb, "volA": vol[pa], "volB": vol[pb], "hour": hour, "history": history}


def no_orders(page, hubs=BASES):
    """Directed rows with no open orders in this digest, per league: {league: ["A>B", ...]}, plus
    {league: {pair key: {id: stock}}} for the pairs present (lowest stock over the hour, i.e. what was
    on offer throughout). Pairs missing from the digest had no listings at all.

    The digest's stock is how much of each currency was on offer. Row "A>B" (receive A, give B) is
    made of orders offering B, so it has none when B's stock was 0 all hour. In game, for Want A /
    Have B that's "no competing trades", and for Want B / Have A it's "no available trades"."""
    out, present = {}, {}
    for market in page.get("markets", []):
        name = market["league"]
        if league_kind(name) in SKIPPED_KINDS:
            continue
        a, b = (short_id(x) for x in market["market_pair"])
        if not wanted(a, b, hubs):
            continue
        low = {short_id(k): v for k, v in market["lowest_stock"].items()}
        present.setdefault(name, {})["|".join(sorted((a, b)))] = {a: low.get(a, 0), b: low.get(b, 0)}
        stock = {short_id(k): v for k, v in market["highest_stock"].items()}
        rows = out.setdefault(name, [])
        if not stock.get(b):
            rows.append(f"{a}>{b}")
        if not stock.get(a):
            rows.append(f"{b}>{a}")
    return out, present


def chaos_volume(page):
    """Total chaos traded per league in one digest, used to pick the default league. Chaos is a busy hub
    in both games, so it works as a measure of league activity for PoE2 too."""
    totals = {}
    for market in page.get("markets", []):
        for k, v in market["volume_traded"].items():
            if short_id(k) == CHAOS:
                totals[market["league"]] = totals.get(market["league"], 0) + v
    return totals


def prune(state, now, hubs=BASES):
    cutoff = now - LOOKBACK
    # The latest finished hour starts one hour before nextChangeId; "recent" is it and the 3 before.
    recent_from = (state.get("nextChangeId") or now // HOUR * HOUR) - RECENT_HOURS * HOUR
    for name in list(state["leagues"]):
        league = state["leagues"][name]
        if league["kind"] in SKIPPED_KINDS:
            del state["leagues"][name]
            continue
        league["pairs"] = {k: p for k, p in league["pairs"].items()
                           if p["hour"] >= cutoff and wanted(p["a"], p["b"], hubs)}
        for p in league["pairs"].values():
            p["history"] = sorted(h for h in p.get("history", []) if h[0] >= cutoff)
            p["dayA"] = sum(h[1] for h in p["history"])
            p["dayB"] = sum(h[2] for h in p["history"])
            p["recentA"] = sum(h[1] for h in p["history"] if h[0] >= recent_from)
            p["recentB"] = sum(h[2] for h in p["history"] if h[0] >= recent_from)
        if not league["pairs"]:
            del state["leagues"][name]


def history_hour(page):
    """One digest as the history keeps it: {league: [[market_pair, volume_traded, ...], ...]} (HISTORY_FIELDS),
    every market in it with short ids, skipping the same leagues as the rates."""
    out = {}
    for market in page.get("markets", []):
        name = market["league"]
        if league_kind(name) in SKIPPED_KINDS:
            continue
        pair = market["market_pair"]
        row = [[short_id(x) for x in pair]] + [[market[f].get(x, 0) for x in pair] for f in HISTORY_FIELDS[1:]]
        out.setdefault(name, []).append(row)
    return out


def history_key(prefix, game, hour):
    """<prefix><game>/<YYYY-MM-DD>/<HH>.json.gz, the hour's UTC day and hour."""
    return f"{prefix}{game}/{time.strftime('%Y-%m-%d/%H', time.gmtime(hour))}.json.gz"


def history_file(game, hour, leagues):
    return {"game": game, "hour": hour, "fields": HISTORY_FIELDS, "leagues": leagues}


def update(state, fetch, now, hubs=BASES, hours=None):
    """Fetch every finished hour since state["nextChangeId"] and merge it. Returns pages fetched.
    Each merged hour is also put in `hours` ({hour: history_hour(page)}) when given."""
    change_id = state.get("nextChangeId") or (now // HOUR * HOUR - LOOKBACK)
    pages = 0
    while pages < MAX_PAGES:
        page = fetch(change_id)
        next_id = page.get("next_change_id")
        if not next_id or next_id == change_id:
            break  # caught up: the current hour isn't finished yet
        merge_page(state, change_id, page, hubs)
        if hours is not None:
            hours[change_id] = history_hour(page)
        state["noOrders"], state["presentPairs"] = no_orders(page, hubs)  # only the latest hour matters
        state["noOrdersHour"] = change_id
        for name, volume in chaos_volume(page).items():
            if name in state["leagues"]:
                state["leagues"][name]["chaosVolume"] = volume
        change_id = next_id
        pages += 1
    state["nextChangeId"] = change_id
    state["generatedAt"] = now
    prune(state, now, hubs)
    return pages


def rates_view(state):
    """What the site loads: the state without the per-hour histories."""
    no = state.get("noOrders", {})
    present = state.get("presentPairs", {})

    def slim(p, stock):
        # Drop the history; add the latest hour's stock as [a, b] when the pair was listed then.
        out = {f: v for f, v in p.items() if f != "history"}
        if stock:
            out["stock"] = [stock.get(p["a"], 0), stock.get(p["b"], 0)]
        return out

    def none_for(name, league):
        # A pair missing from the latest digest had no listings at all, so neither direction has orders.
        missing = [k for k, p in league["pairs"].items() if k not in present.get(name, ())]
        rows = set(no.get(name, []))
        for k in missing:
            p = league["pairs"][k]
            rows |= {f"{p['a']}>{p['b']}", f"{p['b']}>{p['a']}"}
        return sorted(rows)

    return {
        "generatedAt": state["generatedAt"],
        "nextChangeId": state["nextChangeId"],
        "noOrdersHour": state.get("noOrdersHour"),
        "leagues": {
            name: {
                **league,
                "pairs": {k: slim(p, present.get(name, {}).get(k)) for k, p in league["pairs"].items()},
                "noOrders": none_for(name, league),
            }
            for name, league in state["leagues"].items()
        },
    }


def empty_state():
    return {"generatedAt": 0, "nextChangeId": None, "leagues": {}}


def handler(event, context):
    """Updates each game in turn. A game that fails (e.g. no permission yet) is logged and skipped, so the
    others still update. Its history files are written last, and failing there leaves the rates and state written
    (reported as "<game>/history"). event: {"backfill": true} re-reads the last day; {"games": ["poe2"]} limits it."""
    import boto3  # provided by the Lambda runtime

    event = event or {}
    bucket = os.environ["BUCKET"]
    user_agent = f"rainofchaos/1.0 (+{os.environ['SITE_URL']})"
    history_prefix = os.environ.get("HISTORY_PREFIX", "history/")
    s3 = boto3.client("s3")

    def load(key):
        try:
            return json.load(s3.get_object(Bucket=bucket, Key=key)["Body"])
        except s3.exceptions.NoSuchKey:
            return empty_state()
        except s3.exceptions.ClientError as e:
            # Without s3:ListBucket a missing key surfaces as AccessDenied.
            if e.response["Error"]["Code"] != "AccessDenied":
                raise
            return empty_state()

    def put(key, data, cache):
        s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(data, separators=(",", ":")).encode(),
                      ContentType="application/json", CacheControl=cache)

    def save_history(game, hours):
        """Writes each hour to its own file (an hour read again overwrites its file); returns False if any
        couldn't be written (logged)."""
        ok = True
        for hour, leagues in sorted(hours.items()):
            key = history_key(history_prefix, game, hour)
            body = json.dumps(history_file(game, hour, leagues), separators=(",", ":")).encode()
            try:
                s3.put_object(Bucket=bucket, Key=key, Body=gzip.compress(body),
                              ContentType="application/gzip", CacheControl="no-store")
            except Exception as e:  # noqa: BLE001 - the rates and state are already written
                print(json.dumps({"game": game, "history": key, "error": repr(e)}))
                ok = False
        return ok

    result, failed = {}, []
    for game, cfg in GAMES.items():
        if event.get("games") and game not in event["games"]:
            continue
        rates_key, state_key = os.environ.get(*cfg["rates_key"]), os.environ.get(*cfg["state_key"])
        try:
            state = load(state_key)
            if event.get("backfill"):
                # Re-read the last LOOKBACK, e.g. after a change in what's tracked. Newer data is kept.
                state["nextChangeId"] = None
            hours = {}
            pages = update(state, lambda cid: fetch_page(cid, user_agent, cfg["realm"]), int(time.time()), cfg["hubs"], hours)
            put(state_key, state, "no-store")
            put(rates_key, rates_view(state), "max-age=300")
        except Exception as e:  # noqa: BLE001 - one game failing mustn't stop the others
            print(json.dumps({"game": game, "error": repr(e)}))
            failed.append(game)
            continue
        if not save_history(game, hours):
            failed.append(f"{game}/history")
        leagues = {n: len(l["pairs"]) for n, l in state["leagues"].items()}
        print(json.dumps({"game": game, "pages": pages, "nextChangeId": state["nextChangeId"], "pairs": leagues}))
        result[game] = pages
    if failed and not result:
        raise RuntimeError(f"every game failed: {failed}")
    return {"pages": result, "failed": failed}


if __name__ == "__main__":
    # Local dry run without touching S3:  python3 job/rates.py [rates.json] [state.json] [poe1|poe2]
    import sys

    rates_path = sys.argv[1] if len(sys.argv) > 1 else "rates.json"
    state_path = sys.argv[2] if len(sys.argv) > 2 else "state.json"
    cfg = GAMES[sys.argv[3] if len(sys.argv) > 3 else "poe1"]
    try:
        with open(state_path) as f:
            state = json.load(f)
    except FileNotFoundError:
        state = empty_state()
    ua = "rainofchaos/1.0 (+https://rainofchaos.app)"
    n = update(state, lambda cid: fetch_page(cid, ua, cfg["realm"]), int(time.time()), cfg["hubs"])
    with open(state_path, "w") as f:
        json.dump(state, f, separators=(",", ":"))
    with open(rates_path, "w") as f:
        json.dump(rates_view(state), f, separators=(",", ":"))
    print(f"fetched {n} pages -> {rates_path} (state: {state_path})")
