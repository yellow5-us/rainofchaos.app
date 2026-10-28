// User state in localStorage, per game and per league (SPEC.md §7). Falls back to memory when storage is
// unavailable. Each game has its own key (both games have a "Standard" league).
import { game } from "./game.js";
import { addRead } from "./history.js";
import { READS_FOR } from "./undercut.js";

const KEY = game.storageKey;

// base: the hub routes start in (a currency id, game.starts); start: the starting amount per hub.
let memory = { league: null, base: game.starts[0], start: { ...game.defaultAmounts }, leagues: {} };

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = { ...memory, ...JSON.parse(raw) };
  } catch {
    /* private mode or blocked storage: keep in-memory state */
  }
  if (!game.starts.includes(memory.base)) memory.base = game.starts[0];
  memory.start = { ...game.defaultAmounts, ...memory.start };
  return memory;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* see read() */
  }
}

export const state = read();

export function save() {
  write();
}

// A league's prices, `ratios: { [rowKey]: { value:[l,r], digits:[l,r], stock, verifiedAt } }` (or `{ value: null, empty,
// verifiedAt }`): only prices read from the game (scans, SPEC.md §2), each with the stock on offer at it (in what row
// l>r's orders offer, r) and when it was read (ms); a scan is verified for an hour, then expired (app.js). Also each row's
// orders as last read (`lists`) and its reads of the last hour (`reads`), below.
export function leagueState(name) {
  return (state.leagues[name] ??= { ratios: {} });
}

// Plain { [rowKey]: [l, r] } for the calculation.
export function ratioValues(name) {
  const out = {};
  for (const [key, r] of Object.entries(leagueState(name).ratios)) if (r.value) out[key] = r.value;
  return out;
}

// Imported Ratios' Clear All: every price in the league read before `before`, with its row's orders and reads (the read history
// stays).
export const expiredCount = (name, before) => Object.values(leagueState(name).ratios).filter((r) => r.verifiedAt < before).length;
export function removeExpired(name, before) {
  const ls = leagueState(name);
  for (const [key, r] of Object.entries(ls.ratios)) {
    if (r.verifiedAt >= before) continue;
    delete ls.ratios[key];
    delete ls.lists?.[key];
    delete ls.reads?.[key];
  }
  save();
}

// A row's orders as last read from the game (SPEC.md §3.2a), from whichever list showed them (a pair's Available Trades
// are the reverse pair's Competing Trades): every price with its stock (`levels`), the "worse than" row's stock (`rest`,
// or null) and when it was read. Hidden from the user; used for Instant and Advanced steps while it's recent and its
// best price is still the row's ratio (app.js listFor).
// Each read is also kept for an hour (READS_FOR) in the row's `reads`, oldest first, for its undercutting (undercut.js),
// and for HISTORY_FOR in the read history (history.js).
export function setList(name, key, levels, rest, at = Date.now()) {
  const ls = leagueState(name);
  (ls.lists ??= {})[key] = { levels, rest, at };
  const reads = (ls.reads ??= {});
  reads[key] = [...(reads[key] ?? []).filter((r) => at - r.at <= READS_FOR), { at, levels }];
  save();
  addRead(name, key, levels, rest, at);
}
export const listOf = (name, key) => leagueState(name).lists?.[key] ?? null;
export const readsOf = (name, key) => leagueState(name).reads?.[key] ?? [];

// A price read from the game. `digits` is the number of decimals the game showed on each side, so 8.30 stays 8.30;
// `stock` is how much is on offer at it.
export function setRatio(name, key, value, digits, stock) {
  leagueState(name).ratios[key] = { value, digits, stock, verifiedAt: Date.now() };
  save();
}

// A box the game showed with no trades: read, with no price.
export function setEmpty(name, key) {
  leagueState(name).ratios[key] = { value: null, empty: true, verifiedAt: Date.now() };
  save();
}
