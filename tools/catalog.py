"""Build a game's catalog.json: name and icon URL for every currency id in its rates.json.

Names come from RePoE's base_items.json (metadata id -> name); the few cards missing from it are
matched from their ids against the trade site's card list. Icons are GGG CDN URLs
from the trade site's static data (name -> image); otherwise from the item's art file in RePoE, which
the CDN also serves (/image/Art/...png); cards without either share the generic card icon.

Path of Exile 2 uses the same sources for its game (RePoE's poe2 export, the trade2 site); it has no
divination cards, and the CDN doesn't serve its art files by path, so items without a trade-site image
get no icon (the site shows its "?" placeholder).

Currencies already in the catalog stay in it, so one that isn't trading this hour keeps its name.
Run again when new currencies show up (unknown ids fall back to a name derived from the id):
    python3 tools/catalog.py [poe1|poe2] [rates.json path or URL]      (default poe1)
"""

import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = {"User-Agent": "rainofchaos/1.0 (+https://rainofchaos.app)"}
CDN = "https://web.poecdn.com"
GAMES = {
    "poe1": {"rates": "https://rainofchaos.app/rates.json", "repoe": "https://repoe-fork.github.io/base_items.json",
             "static": "https://www.pathofexile.com/api/trade/data/static", "out": "html/data/catalog.json",
             "art": True},
    "poe2": {"rates": "https://rainofchaos.app/poe2/rates.json",
             "repoe": "https://repoe-fork.github.io/poe2/base_items.json",
             "static": "https://www.pathofexile.com/api/trade2/data/static", "out": "html/data/poe2/catalog.json",
             "art": False},
}
CARD_ICON = CDN + "/image/Art/2DItems/Divination/InventoryIcon.png?scale=1"


def get_json(src):
    if not src.startswith("http"):
        return json.loads(pathlib.Path(src).read_text())
    with urllib.request.urlopen(urllib.request.Request(src, headers=UA), timeout=60) as r:
        return json.load(r)


def squash(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def main():
    args = sys.argv[1:]
    game = GAMES[args.pop(0) if args and args[0] in GAMES else "poe1"]
    rates = get_json(args[0] if args else game["rates"])
    ids = sorted({x for lg in rates["leagues"].values() for p in lg["pairs"].values() for x in (p["a"], p["b"])})

    names, art = {}, {}
    for metadata_id, item in get_json(game["repoe"]).items():
        short = metadata_id.rsplit("/", 1)[-1]
        names.setdefault(short, item.get("name"))
        dds = (item.get("visual_identity") or {}).get("dds_file")
        if dds and game["art"]:
            art.setdefault(short, f"{CDN}/image/{dds.removesuffix('.dds')}.png?scale=1")

    images, cards = {}, {}
    for group in get_json(game["static"])["result"]:
        for entry in group["entries"]:
            if entry.get("image"):
                images.setdefault(entry["text"], CDN + entry["image"])
            if group["id"] == "Cards":
                cards[squash(entry["text"])] = entry["text"]

    out = ROOT / game["out"]
    catalog = json.loads(out.read_text()) if out.exists() else {}
    unnamed, no_icon = [], []
    for id_ in ids:
        is_card = id_.startswith("DivinationCard")
        name = names.get(id_)
        if not name and is_card:  # a few cards are missing from RePoE; match them by name instead
            card = squash(id_.removeprefix("DivinationCard"))
            name = cards.get(card) or cards.get(card.removeprefix("the"))  # ids sometimes add "The"
        icon = images.get(name) or art.get(id_) or (CARD_ICON if is_card else None)
        if not name:
            unnamed.append(id_)
            continue
        if not icon:
            no_icon.append(name)
        catalog[id_] = {"name": name, "icon": icon}

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(catalog, indent=0, sort_keys=True, ensure_ascii=False) + "\n")
    print(f"{len(catalog)} currencies -> {out.relative_to(ROOT)}")
    if unnamed:
        print(f"no name for {len(unnamed)}: {', '.join(unnamed)}")
    if no_icon:
        print(f"no icon for {len(no_icon)}: {', '.join(no_icon)}")


if __name__ == "__main__":
    main()
