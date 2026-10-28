// Saved states for the page checks (checks.js), as js/store.js keeps them, built at run time relative to `now` (ms):
// every scan's verifiedAt is minutes before it. The prices are SPEC.md §8's; the volumes behind them are rates.json here.
export const C = "CurrencyRerollRare", D = "CurrencyModValues", E = "CurrencyAddModToRare";
export const CHROM = "CurrencyRerollSocketColours", VIVID = "HarvestSeedGreen", SULPHUR = "CurrencyDeepwater";
export const ALCH = "CurrencyUpgradeToRare", ANNUL = "CurrencyRemoveMod";
// Alchemy Shard: the one-list captures' currency, which data/catalog.json doesn't list (checks.js adds it).
export const SHARD = "CurrencyUpgradeToRareShard";
export const LEAGUE = { poe1: "Allflame", poe2: "Forbidden Rites" };
export const STORAGE = { poe1: "rainofchaos:v1", poe2: "rainofchaos:poe2:v1" };

const rows = (pairs) => pairs.map(([a, b, ab, ba]) => [[`${a}>${b}`, ab], [`${b}>${a}`, ba]]).flat();
// Chaos ↔ Divine; Chromatic fast and profitable; Vivid profitable but slow; Sulphur's pairs had no trades
// in the last 4 hours (fill time unknown); Alchemy at a loss.
const HUBS1 = rows([[C, D, [380, 1], [1, 370]]]);
const ITEMS1 = rows([
  [CHROM, C, [1, 3.4], [3.69, 1]], [CHROM, D, [99, 1], [1, 68]],
  [VIVID, C, [8.5, 1], [1, 8.27]], [VIVID, D, [2889, 1], [1, 2810]],
  [SULPHUR, C, [113, 1], [1, 90.1]], [SULPHUR, D, [35000, 1], [1, 33333]],
  [ALCH, C, [1, 1.5], [1, 1]], [ALCH, D, [100, 1], [1, 300]],
]);
const HUBS2 = rows([[E, C, [66, 1], [1, 64]], [E, D, [690, 1], [1, 680]], [C, D, [11, 1], [1, 10.5]]]);
const ITEMS2 = rows([[ANNUL, E, [1, 148], [152, 1]], [ANNUL, C, [1, 2.2], [2.4, 1]], [ANNUL, D, [5, 1], [1, 4.6]]]);

const SHARD1 = rows([[SHARD, C, [1.4, 1], [1, 1.2]]]);
const OLD_SHARD = { [`${SHARD}>${C}`]: 90, [`${C}>${SHARD}`]: 90 };

// Each scan read 2 minutes before now, or `ages[key]` minutes.
const scans = (list, now, ages = {}) => Object.fromEntries(list.map(([key, value]) => [key, {
  value, digits: value.map((x) => (Number.isInteger(x) ? 0 : 2)), verifiedAt: now - (ages[key] ?? 2) * 60000,
}]));
const state = (game, ratios = {}, more = {}) => ({ league: LEAGUE[game], leagues: { [LEAGUE[game]]: { ratios } }, ...more });
const poe1 = (list, now, ages) => state("poe1", scans(list, now, ages), { base: C, start: { [C]: 10000, [D]: 25 } });

// The oldest scans: Chromatic's Chaos:Chromatic and Vivid's Vivid:Divine (an item first, to show hubs lead in titles).
const FRESH_AGES = { [`${C}>${CHROM}`]: 5, [`${VIVID}>${D}`]: 6 };
export const EXPIRED_KEY = `${CHROM}>${C}`;

// seed(now, game) is the saved state for that game.
export const SEEDS = {
  empty: (now, game) => state(game),
  fresh: (now) => poe1([...HUBS1, ...ITEMS1], now, FRESH_AGES),
  // As fresh, but one direction of Chromatic read 90 minutes ago.
  expired: (now) => poe1([...HUBS1, ...ITEMS1], now, { ...FRESH_AGES, [EXPIRED_KEY]: 90 }),
  // As expired, starting from Divine: Divine → Chromatic → Divine doesn't use the expired price.
  expiredFromDivine: (now) => ({ ...poe1([...HUBS1, ...ITEMS1], now, { ...FRESH_AGES, [EXPIRED_KEY]: 90 }), base: D }),
  // As fresh, with a million of what each order offers already posted at every Chromatic price.
  queued: (now) => {
    const seed = poe1([...HUBS1, ...ITEMS1], now, FRESH_AGES);
    for (const [key, r] of Object.entries(seed.leagues[seed.league].ratios)) if (key.includes(CHROM)) r.stock = 1e6;
    return seed;
  },
  // As fresh, with 250 div posted at Chaos:Divine's Competing price (a quarter of an hour at the fixture's 1,000 div an hour).
  stocked: (now) => {
    const seed = poe1([...HUBS1, ...ITEMS1], now, FRESH_AGES);
    seed.leagues[seed.league].ratios[`${C}>${D}`].stock = 250;
    return seed;
  },
  // As stocked, with Chaos:Divine's Competing Trades read 30, 22, 14 and 6 minutes ago, each time with orders posted ahead of
  // the read before's best price (30 div at 378, 30 at 377, 40 at 376): 100 div in 24 minutes is 250 div an hour of
  // undercutting, as much as the 250 div an hour that fills its side.
  undercut: (now) => {
    const seed = SEEDS.stocked(now), lg = seed.leagues[seed.league];
    const read = (m, levels) => ({ at: now - m * 60000, levels: levels.map(([chaos, stock]) => ({ ratio: [chaos, 1], stock })) });
    lg.reads = { [`${C}>${D}`]: [read(30, [[380, 250]]), read(22, [[378, 30], [380, 250]]), read(14, [[377, 30], [378, 30]]),
      read(6, [[376, 40], [377, 30]])] };
    return seed;
  },
  // As stocked, with Chaos:Divine's Competing Trades read 30, 22, 14 and 6 minutes ago, 20 div fewer at 380 : 1 each time:
  // 60 div bought in 24 minutes is 150 div an hour.
  bought: (now) => {
    const seed = SEEDS.stocked(now), lg = seed.leagues[seed.league];
    const read = (m, stock) => ({ at: now - m * 60000, levels: [{ ratio: [380, 1], stock }] });
    lg.reads = { [`${C}>${D}`]: [read(30, 250), read(22, 230), read(14, 210), read(6, 190)] };
    return seed;
  },
  // As fresh, with Chaos:Vivid's Competing Trades read empty: nobody else selling Vivid for Chaos.
  noCompeting: (now) => {
    const seed = poe1([...HUBS1, ...ITEMS1], now, FRESH_AGES);
    seed.leagues[seed.league].ratios[`${C}>${VIVID}`] = { value: null, empty: true, verifiedAt: now - 2 * 60000 };
    return seed;
  },
  // Only Chaos ↔ Divine read.
  gap: (now) => poe1(HUBS1, now),
  // Only Chaos ↔ Divine, read 90 minutes ago (expired).
  gapOld: (now) => poe1(HUBS1, now, { [`${C}>${D}`]: 90, [`${D}>${C}`]: 90 }),
  poe2: (now) => state("poe2", scans([...HUBS2, ...ITEMS2], now)),
  // As poe2, saved while Chaos was picked to start with.
  poe2Chaos: (now) => state("poe2", scans([...HUBS2, ...ITEMS2], now), { base: C }),
  // Alchemy Shard ↔ Chaos read 90 minutes ago, both ways (prices near the one-list captures' 1 : 1).
  shard: (now) => poe1(SHARD1, now, OLD_SHARD),
  // The same with Chaos:Shard at 1 : 10, 10x off the captures' price.
  shardFar: (now) => poe1(SHARD1.map(([key, v]) => [key, key === `${C}>${SHARD}` ? [1, 10] : v]), now, OLD_SHARD),
};
