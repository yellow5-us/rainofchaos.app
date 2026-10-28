// Every list read for HISTORY_FOR, in IndexedDB, per game (SPEC.md §7): kept for analysis (retuning the undercutting,
// §3.6, and prices by hour of the day and day of the week), not used by the page. One record per read, added and never rewritten. Storage that's blocked or fails leaves the page as it is.
import { game } from "./game.js";

const DB = `${game.storageKey}:reads`;
const STORE = "reads";
export const HISTORY_FOR = 14 * 24 * 60 * 60 * 1000;

let opened = null;
function db() {
  return (opened ??= new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { autoIncrement: true });
      s.createIndex("at", "at");
      s.createIndex("league", ["league", "at"]);
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      ok(req.result);
    };
    req.onerror = () => fail(req.error);
  }).catch(() => null));
}

// One transaction on the store: `fn(store)` makes its requests; the last request's result once it's done, or null.
async function use(mode, fn) {
  try {
    const d = await db();
    if (!d) return null;
    return await new Promise((ok, fail) => {
      const tx = d.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => ok(req?.result ?? null);
      tx.onerror = tx.onabort = () => fail(tx.error);
    });
  } catch {
    return null;
  }
}
// Deletes every record a cursor over `source` and `range` walks.
const sweep = (source, range) => {
  const req = source.openCursor(range);
  req.onsuccess = () => {
    const cursor = req.result;
    if (cursor) { cursor.delete(); cursor.continue(); }
  };
};

export const addRead = (league, key, levels, rest, at) => use("readwrite", (s) => s.add({ league, key, at, levels, rest }));
export const allReads = () => use("readonly", (s) => s.getAll());
export const clearReads = (league) =>
  use("readwrite", (s) => sweep(s.index("league"), IDBKeyRange.bound([league, -Infinity], [league, Infinity])));
const pruneReads = (now = Date.now()) => use("readwrite", (s) => sweep(s.index("at"), IDBKeyRange.upperBound(now - HISTORY_FOR, true)));

// Done once, as the page loads; `pruned` settles when it's done.
export const pruned = pruneReads();
