"""Fill a game's gold fees (html/data/gold.json, PoE2: html/data/poe2/gold.json) from poedb.

The game's data has each currency's exchange fee (gold per unit received, the CurrencyExchange table's
GoldPurchaseFee). poedb lists that table on one page per game, a row per currency: its name, then the fee
("Chaos Orb 15", "Vivid Crystallised Lifeforce 1/8"). Names are matched to ids through the game's catalog.json.

Only fees the list doesn't have are added: a fee already there is kept, and a poedb fee that differs from it is
reported. A page with no rows (its layout changed) stops the script before anything is written.
    python3 tools/gold.py [poe1|poe2] [--dry-run]      (default poe1)
"""

import html
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAMES = {
    "poe1": {"page": "https://poedb.tw/us/Currency_Exchange", "data": ROOT / "html/data"},
    "poe2": {"page": "https://poe2db.tw/us/Currency_Exchange", "data": ROOT / "html/data/poe2"},
}
UA = "rainofchaos/1.0 (+https://rainofchaos.app)"


def fee(text):
    """"6,250" -> 6250, "1/8" -> 0.125; None for anything else."""
    text = text.strip().replace(",", "")
    if re.fullmatch(r"\d+", text):
        return int(text)
    if m := re.fullmatch(r"(\d+)/(\d+)", text):
        return int(m[1]) / int(m[2])
    return None


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    game = next((a for a in args if a in GAMES), "poe1")
    cfg = GAMES[game]
    req = urllib.request.Request(cfg["page"], headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        page = r.read().decode("utf-8", "replace")
    # Each row: <a ...>Name</a><span>fee</span>
    listed = {}
    for name, text in re.findall(r'href="[^"]*">([^<]+)</a><span>([^<]*)</span>', page):
        listed.setdefault(html.unescape(name).strip(), text)
    if not listed:
        sys.exit(f"{cfg['page']}: no fees found (has the page changed?)")
    catalog = json.loads((cfg["data"] / "catalog.json").read_text())
    path = cfg["data"] / "gold.json"
    gold = json.loads(path.read_text())
    added, missing = {}, []
    for cid, item in sorted(catalog.items()):
        text = listed.get(item["name"])
        value = None if text is None else fee(text)
        if value is None:
            missing.append(f"{item['name']}" + ("" if text is None else f" ({text!r})"))
        elif cid not in gold:
            added[cid] = value
        elif gold[cid] != value:
            print(f"differs: {item['name']}: kept {gold[cid]}, poedb says {value}")
    for name in missing:
        print(f"no fee on poedb: {name}")
    rel = path.relative_to(ROOT)
    print(f"{len(listed)} fees on poedb; {len(added)} to add to {rel}" if dry else f"added {len(added)} fees to {rel}")
    if not dry and added:
        gold.update(added)
        path.write_text(json.dumps(gold, indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
