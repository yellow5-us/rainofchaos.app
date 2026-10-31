// The game this page is for (SPEC.md §1), from its address: /poe2 is Path of Exile 2, anything else
// (/poe1) Path of Exile 1. Each game has its hub currencies, data files, start options and saved state.
import { CHAOS, DIVINE, EXALTED } from "./items.js";

export const GAMES = {
  poe1: {
    id: "poe1",
    name: "Path of Exile 1",
    hubs: [CHAOS, DIVINE], // display order, e.g. on Market Ratios and in an item page's volume
    end: DIVINE, // every route ends in Divine: the goal is always more div
    sellTo: CHAOS, // extra items are sold for Chaos
    starts: [DIVINE, CHAOS], // the Starting Amount toggle, in order; the first is the default
    defaultAmounts: { [CHAOS]: 1000, [DIVINE]: 25 },
    example: "DivinationCardDeck", // Stacked Deck: the currency the steps for scanning a trade use as their example
    window: "poe1", // how the Currency Exchange window looks, for finding it in the game (js/snip.js, WINDOWS)
    files: { rates: "/rates.json", catalog: "/data/catalog.json", gold: "/data/gold.json" },
    storageKey: "rainofchaos:v1",
  },
  poe2: {
    id: "poe2",
    name: "Path of Exile 2",
    hubs: [EXALTED, DIVINE], // Chaos trades as an item
    end: DIVINE,
    sellTo: EXALTED, // the busiest hub
    starts: [DIVINE, EXALTED],
    defaultAmounts: { [EXALTED]: 2000, [DIVINE]: 3 }, // about 3 div each (1 div ≈ 684 ex)
    example: "CurrencyRemoveMod", // Orb of Annulment
    window: "poe2", // dark buttons with light glyphs, the hover box higher
    files: { rates: "/poe2/rates.json", catalog: "/data/poe2/catalog.json", gold: "/data/poe2/gold.json" },
    storageKey: "rainofchaos:poe2:v1",
  },
};

export const game = GAMES[location.pathname.startsWith("/poe2") ? "poe2" : "poe1"];

// The root address (/) goes to the last game used.
export const GAME_KEY = "rainofchaos:game";
try {
  localStorage.setItem(GAME_KEY, game.id);
} catch {
  /* storage blocked: / goes to PoE1 */
}
