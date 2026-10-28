// Currencies (SPEC.md §1). There's no fixed list: an item is any id that trades against one of the game's
// hub currencies in the selected league's rates.json. Names and icon URLs come from the game's catalog
// (built by tools/catalog.py); gold fees from its gold list (filled by tools/gold.py). Ids are the API
// metadata ids' last segment.
export const CHAOS = "CurrencyRerollRare";
export const DIVINE = "CurrencyModValues";
export const EXALTED = "CurrencyAddModToRare";

// The game's currencies (set from game.js): the hubs every item trades against, in display order; the
// one every route ends in; and the hub extra items are sold into. Path of Exile 1 until set.
export const currencies = { hubs: [CHAOS, DIVINE], end: DIVINE, sellTo: CHAOS };
export function setCurrencies({ hubs, end, sellTo }) {
  Object.assign(currencies, { hubs, end, sellTo });
}
export const isBase = (id) => currencies.hubs.includes(id);

let catalog = {};
let gold = {};

export function setCatalog(data) {
  catalog = data;
}

// Gold per unit received, from the game's gold list. Unknown fees are null.
export function setGold(data) {
  gold = data;
}
export const goldOf = (id) => gold[id] ?? null;

// Ids missing from the catalog get a readable name from the id itself ("ScarabUber1" -> "Scarab Uber 1").
export const nameOf = (id) => catalog[id]?.name ?? id.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
export const iconUrl = (id) => catalog[id]?.icon ?? null;
// Gold isn't traded, so it isn't in the catalog: the game's coin pile from GGG's CDN.
export const GOLD_ICON = "https://web.poecdn.com/image/Art/2DItems/Currency/Ruthless/CoinPileTier2.png";
// Every currency name in the catalog: what a snip's names are told apart from.
export const catalogNames = () => [...new Set(Object.values(catalog).map((c) => c.name).filter(Boolean))];
// The id of a currency by its catalog name, or null.
export const idOfName = (name) => Object.keys(catalog).find((id) => catalog[id].name === name) ?? null;

export const itemOf = (id) => ({ id, slug: id, name: nameOf(id) });

// Every currency in a league that trades against a hub, sorted by name.
export function itemsIn(league) {
  const ids = new Set();
  for (const p of Object.values(league?.pairs ?? {})) for (const id of [p.a, p.b]) if (!isBase(id)) ids.add(id);
  return [...ids].map(itemOf).sort((x, y) => x.name.localeCompare(y.name));
}

// A directed ratio row: "A>B" is displayed in game as "A:B".
export const rowKey = (a, b) => `${a}>${b}`;
