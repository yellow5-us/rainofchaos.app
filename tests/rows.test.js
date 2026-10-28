// Row reader tests (SPEC.md §4.7): js/rows.js and the window path of js/snip.js (findWindow, findListsIn),
// with data/glyphs.json as shipped. Browser only (it decodes the PNGs in snips/): open rows.html.
// Each screenshot of the game window, at its size, is read as it is and as eight variants made from it, by the window
// alone (as watching reads it): one list painted over, thin lists (4 prices, no arrow row), Competing moved up with the
// game's "no available trades" message, and a stand-in mouse cursor in three places beside the rows; and Path of Exile 1's
// window is found in it darker and brighter. A list read wrong
// fails; so does one not read. A list alone must say whether the game shows the other side has no trades (`empty`): only
// with Competing moved up under the message, or Available with no banners in its higher place.
import { AT, findWindow, nameBoxes, nameOf, rankNames, readNames, toLum, unpackNames } from "../html/js/snip.js";
import { findAll, unpackModel } from "../html/js/rows.js";

let failed = 0;
function eq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

// Each screenshot's lists, best price first (the "worse than" row left out).
const SHOTS = {
  wide: { file: "size-9.png", // 2384 x 960
    available: ["365:1 2,555", "362:1 10,136", "361:1 14,079", "360:1 6,480", "359:1 1,795"],
    competing: ["369:1 3", "370:1 92", "373:1 111", "375:1 170", "376:1 123"] },
  // A real one with no Available trades: Competing moved up into Available's place, a message over the title bar.
  noavail: { file: "size-small-no-available.png", only: true, empty: "available", // 800 x 600
    available: null, competing: ["1:1 1", "2.62:1 16", "3:1 18", "5:1 19", "5.33:1 15"] },
  s1176: { file: "size-4.png", // 1176 x 664
    available: ["368:1 1,840", "365:1 1,095", "361:1 14,079", "360:1 7,560", "359:1 1,795"],
    competing: ["369:1 13", "370:1 207", "373:1 111", "375:1 170", "376:1 123"] },
  // A real one with no Competing trades: Available alone, the box with no banner and higher up.
  nocomp: { file: "size-small-no-competing.png", only: true, empty: "competing", // 800 x 600
    available: ["1:1 1", "1:2.62 16", "1:3 18", "1:5 19", "1:5.33 15"], competing: null },
  s1280: { file: "size-5.png", // 1280 x 720
    available: ["368:1 4,784", "365:1 1,095", "361:1 14,079", "360:1 7,560", "359:1 1,795"],
    competing: ["370:1 111", "373:1 111", "375:1 170", "376:1 123", "377:1 551"] },
  s1024: { file: "size-2.png", // 1024 x 768
    available: ["368:1 4,416", "365:1 1,095", "361:1 14,079", "360:1 7,560", "359:1 1,795"],
    competing: ["369:1 16", "370:1 207", "373:1 111", "375:1 170", "376:1 123"] },
  s1152: { file: "size-3.png", // 1152 x 864
    available: ["368:1 4,784", "365:1 1,095", "361:1 14,079", "360:1 7,560", "359:1 1,795"],
    competing: ["369:1 13", "370:1 207", "373:1 111", "375:1 170", "376:1 123"] },
  s1280x768: { file: "size-6.png", // 1280 x 768
    available: ["368:1 4,784", "365:1 1,095", "361:1 14,079", "360:1 7,560", "359:1 1,795"],
    competing: ["370:1 100", "373:1 111", "375:1 170", "376:1 123", "377:1 551"] },
  s1280x800: { file: "size-7.png", // 1280 x 800
    available: ["368:1 368", "365:1 1,095", "362:1 6,154", "361:1 14,079", "360:1 7,560"],
    competing: ["370:1 93", "373:1 111", "375:1 170", "376:1 123", "377:1 551"] },
  s1280x960: { file: "size-8.png", // 1280 x 960
    available: ["362:1 3,982", "361:1 14,079", "360:1 6,480", "359:1 1,795", "358:1 358"],
    competing: ["365:1 1", "369:1 5", "370:1 92", "373:1 111", "375:1 170"] },
  s1703: { file: "size-10.png", // 1703 x 1243
    available: ["363:1 363", "362:1 10,136", "361:1 14,079", "360:1 6,480", "359:1 1,795"],
    competing: ["370:1 58", "373:1 111", "375:1 170", "376:1 123", "377:1 551"] },
  sfull: { file: "size-full.png", // 2544 x 1353: the masters come from it, so not an unseen size
    available: ["363:1 1,089", "362:1 18,824", "360:1 11,160", "356:1 36,668", "355:1 20,590"],
    competing: ["366:1 181", "366.50:1 10", "367:1 97", "368:1 9", "369:1 5"] },
  // A real one with four-digit ratios, some of them in the smaller font (2210.60) between whole ones (2189).
  vivid: { file: "wide-vivid-lifeforce.png", // 2017 x 925
    available: ["2210.60:1 11,053", "2189:1 10,945", "2188.50:1 17,508", "2166.67:1 6,500", "2145.40:1 10,727"],
    competing: ["2400:1 47", "2490:1 59", "2579:1 10", "2583:1 10", "2593:1 93"] },
  // A frame from Firefox's share of the game's window at 1280 x 960 (with Windows' title bar), the mouse's cursor on
  // the Available banner. The HUD's orange Menu arrow and (i) button, at the foot, are as far apart as the window's.
  share: { file: "firefox-share-1280x960.png", // 1288 x 994
    available: ["362:1 1,448", "360:1 15,840", "357:1 357", "356:1 18,868", "355:1 26,980"],
    competing: ["367:1 4", "368:1 138", "369:1 121", "370:1 612", "371:1 1"] },
  // The window pushed aside by the stash (right), the inventory (left) or both (centred between them), at two sizes.
  // With both open and wide, a socket in the inventory and the window's "x" are a pair the finder must pass over.
  invS: { file: "inv-open-1280x960.png",
    available: ["362:1 11,584", "361:1 18,050", "360:1 16,560", "359:1 20,104", "358:1 31,862"],
    competing: ["365:1 27", "367:1 15", "368:1 6", "369:1 54", "370:1 612"] },
  invW: { file: "inv-open-2125x960.png",
    available: ["362:1 1,810", "361:1 21,660", "360:1 16,560", "359:1 21,181", "358:1 31,862"],
    competing: ["366:1 20", "367:1 15", "368:1 6", "369:1 54", "370:1 612"] },
  stashS: { file: "stash-open-1280x960.png",
    available: ["362:1 8,688", "361:1 18,050", "360:1 16,560", "359:1 21,181", "358:1 31,862"],
    competing: ["364:1 24", "367:1 15", "368:1 6", "369:1 54", "370:1 612"] },
  stashW: { file: "stash-open-2125x960.png",
    available: ["366:1 2,562", "364:1 3,640", "361:1 9,386", "360:1 16,560", "359:1 21,181"],
    competing: ["367:1 7", "368:1 6", "369:1 54", "370:1 612", "371:1 1"] },
  bothS: { file: "stash-inv-open-1280x960.png",
    available: ["362:1 35,838", "361:1 18,050", "360:1 16,560", "359:1 21,181", "358:1 31,862"],
    competing: ["364:1 24", "366:1 20", "367:1 15", "368:1 6", "369:1 54"] },
  bothW: { file: "stash-inv-open-2125x960.png",
    available: ["362:1 26,788", "361:1 18,050", "360:1 16,560", "359:1 21,181", "358:1 31,862"],
    competing: ["364:1 5", "366:1 20", "367:1 15", "368:1 6", "369:1 54"] },
  // A row with little ink right under its list's header (Competing's "3 : 1  1"): erasing the header mustn't stretch
  // the panel's texture into shapes. A 2371 x 1334 share.
  sparse: { file: "sparse-row-2371x1334.png",
    available: ["2.73:1 41", "2.67:1 592", "2.50:1 1,110", "2.38:1 31", "2.33:1 7"],
    competing: ["3:1 1", "3.30:1 21", "3.80:1 20", "4:1 73", "4.20:1 50"] },
  // A hover without Alt, the cursor over Available's first stock: nothing read, and quickly (rows seen but no list
  // made of them is the answer, not a reason to read again). A 2416 x 1431 share, cut to the window.
  cursorHover: { file: "cursor-over-stock-hover-window.png", only: true, under: 1000, available: null, competing: null },
  // Short prices ("1 : 31", stocks of two digits) make the lists narrow, far from the name boxes ("Grand Eldritch Ember";
  // names below). A 2416 x 1431 share, cut to the window.
  emberShort: { file: "ember-short-prices-window.png", only: true,
    available: ["1:31 32", "1:32 30", "1:33 27", "1:34 38", "1:35 2"], competing: ["1:28 364", "1:27 27", "1:26 442", "1:25 1,950", "1:23 897"] },
  // A long ratio drawn smaller still ("1 : 16666.67", its "1" two thirds of a digit tall), a stock that runs up
  // against its ratio ("> 1 : 15750 7,072,720"), and an Available list of 5 rows with no arrow row: a
  // 2502 x 1332 share, cut to the window.
  // Its row with the smaller ratio is set further right: the cursor "between ratio and stock" covers that stock's
  // "50,", so Competing can't be read then (left unread, not misread as "0").
  wild: { file: "wild-lifeforce-window.png", covered: ["cursor between ratio and stock"],
    available: ["1:20000 4", "1:21000 2", "1:22000 40", "1:23000 5", "1:65000 1"],
    competing: ["1:17000 153,000", "1:16666.67 50,000", "1:16001 144,009", "1:16000 160,000", "1:15750 960,750"] },
  // Two ratios in the smaller font among full-size ones ("1 : 2606.75", "1 : 2580.75"), read on their own line (level
  // with the full size at the top). An eight-digit stock in the arrow row.
  vividSmall: { file: "vivid-small-ratios-window.png", covered: ["cursor between ratio and stock"],
    available: ["1:2637 3", "1:2639 50", "1:2750 363", "1:2799 100", "1:2888 79"],
    competing: ["1:2633 5,266", "1:2606.75 10,427", "1:2580.75 10,323", "1:2555 145,635", "1:2550 7,650"] },
  // Path of Exile 2 (a 2152 x 1243 share, inventory open): its buttons are dark discs with light glyphs and
  // its hover box sits higher (AT2). Four-digit ratios in Competing.
  poe2: { file: "poe2-exalted-2152x1243.png", style: "poe2",
    available: ["67:1 9,380", "66:1 1,782", "63:1 4,788", "62.50:1 6,250", "60:1 360"],
    competing: ["200:1 5", "207:1 1", "330:1 2", "500:1 66", "1800:1 1"] },
  // Competing's stocks in the millions (Divine Orb / Dead Man's Sulphur, 2416 x 1431 shares, cropped round the window): a
  // stock that long comes nearer its ratio than its commas' gaps are wide.
  millions: { file: "sulphur-millions-window.png", only: true,
    available: ["1:42997 9", "1:43000 15", "1:43199 5", "1:43200 8", "1:43897 36"],
    competing: ["1:40009 1,400,315", "1:40000 840,000", "1:39500 158,000", "1:39005 39,005", "1:39004 1,638,168"] },
  millions2: { file: "sulphur-millions-2-window.png", only: true,
    available: ["1:42888 6", "1:42893 16", "1:42900 23", "1:43000 5", "1:43199 5"],
    competing: ["1:39001 39,001", "1:38810 2,095,740", "1:38800 465,600", "1:38710 387,100", "1:38700 193,500"] },
  // An absurd order in Competing (10000 : 1 after 69 : 1, a 145x jump) ends the list there: Wild Crystallised Lifeforce /
  // Chaos Orb, a 2294 x 1241 share cut to the window.
  outlier: { file: "outlier-competing-window.png",
    available: ["50:1 5,900", "49.71:1 3,480", "47:1 24,816", "41:1 73,718", "40.05:1 6,007"],
    competing: ["60:1 7,324", "68:1 830", "69:1 510"] },
  // Specks of the box's texture under Competing's first "99", between its digits and well below the line: not a dropped
  // decimal point, so "1 : 99  99" reads. Divine Orb / Chromatic Orb, a 2564 x 1406 share cut to the window.
  lowSpecks: { file: "low-specks-window.png",
    available: ["1:149 2", "1:150 1", "1:158.75 80", "1:159 30", "1:160 17"],
    competing: ["1:99 99", "1:98 196", "1:97 194", "1:96 14,688", "1:95 4,560"] },
  // An 8-digit stock all but touching its ratio ("> 1 : 16667 10,639,024", 0.35 of a digit apart), split where the other
  // rows' ratios end; Available thin (4 prices). Divine Orb / Wild Crystallised Lifeforce, a 2294 x 1241 share cut to the window.
  // The cursor "between ratio and stock" covers the "1" of "16,837": its stock off the list's centre, Competing is left
  // unread (not misread as "6,837").
  stockTouching: { file: "stock-touching-ratio-window.png", covered: ["cursor between ratio and stock"],
    available: ["1:22950 4", "1:23000 10", "1:23950 17", "1:43200 20"],
    competing: ["1:17007 17,007", "1:16837 16,837", "1:16669 50,007", "1:16668 216,684", "1:16667 33,334"] },
  // An 8 in a small ratio ("158.68", "159.98"): read right but too unsurely with size-full's 8 shrunk; with the small
  // 8 learned from this frame (snip.test.js), surely. Dead Man's Sulphur / Chaos Orb, a 2294 x 1241 share cut to the window.
  smallEights: { file: "small-eights-window.png",
    available: ["130:1 29,250", "129.20:1 50,000", "128.21:1 40,000", "128.11:1 545,100", "124:1 405,852"],
    competing: ["158.68:1 334", "159:1 843", "159.98:1 850", "162.70:1 140", "162.79:1 10,320"] },
  // A 4 in a small ratio ("94.12"), where the small 4 comes from (snip.test.js). Orb of Transmutation / Chaos Orb, a
  // 2294 x 1241 share cut to the window. As captured only: Competing is a single price, and a list of fewer than three
  // rows with nothing else in the box isn't taken for a list.
  smallFour: { file: "small-four-window.png", only: true,
    available: ["103:1 309", "102.17:1 47,000", "100:1 20,200", "98.67:1 888", "94.12:1 9,318"],
    competing: ["500:1 119"] },
  // Competing has one price before a jump (68 : 1, then 10000 : 1): kept, as it's near Available's best (41 : 1). As
  // captured only: with Available painted over it has nothing to be checked against, and isn't read. Wild Crystallised
  // Lifeforce / Chaos Orb, a 2294 x 1241 share cut to the window.
  oneRowHead: { file: "one-row-head-window.png", only: true,
    available: ["41:1 29,233", "40.05:1 6,007", "40:1 1,219,880", "39.59:1 2,019", "37:1 14,800"], competing: ["68:1 702"] },
  // The same pair flipped (Chaos Orb / Wild Crystallised Lifeforce): the one price before the jump is Available's
  // (1 : 68, then 1 : 10000), kept beside Competing's 1 : 41. As captured only, as above.
  oneRowHeadFlipped: { file: "one-row-head-flipped-window.png", only: true,
    available: ["1:68 702"], competing: ["1:41 29,233", "1:40.05 6,007", "1:40 1,219,880", "1:39.59 2,019", "1:37 14,800"] },
  // Available has a single trade (a thin market, no "worse than" row) and a wide hover box: Divine Orb / Wild Crystallised
  // Lifeforce, a 2335 x 1284 share cut to the window, with two of the player's orders listed. Its names are read below.
  // Competing's 7- and 8-digit stocks all but touching their ratios ("1 : 42201  1,645,839", 0.61 of a digit apart; "> 1 :
  // 42000  78,397,883", 0.41), with four of the player's orders listed round the box: Divine Orb / Dead Man's Sulphur, a
  // 2335 x 1284 share cut to the window.
  closeStock: { file: "sulphur-close-stock-window.png", only: true,
    available: ["1:49793 19", "1:49794 38", "1:49795 20", "1:49800 5", "1:49900 17"],
    competing: ["1:42501 467,511", "1:42300 380,700", "1:42201 1,645,839", "1:42100 1,094,600", "1:42000 42,000"] },
  oneAvailable: { file: "one-available-row-window.png", only: true,
    available: ["1:39500 1"], competing: ["1:20005 20,005", "1:19805 217,855", "1:19804 39,608", "1:19606 58,818", "1:19605 235,260"] },
  // The window's "x" darker than in the other frames (fewer of its pixels orange): Chaos Orb / Vivid Crystallised
  // Lifeforce, a 2277 x 1183 share cut to the window. Its stocks sit close to their ratios: the cursor "between ratio and
  // stock" covers the "2" of "25,000", so Competing is left unread then.
  darkX: { file: "dark-x-window.png", covered: ["cursor between ratio and stock"],
    available: ["1:6.90 200", "1:6.99 4,600", "1:7 5,381", "1:7.20 32,835", "1:7.40 9,760"],
    competing: ["1:5.70 34,749", "1:5.68 25,000", "1:5.66 4,248", "1:5.52 31,243", "1:5.51 9,276"] },
  // A hover without Alt with the player's order listings below it: colons in them sit six row spacings under the "worse
  // than" row, and aren't part of Available. Dead Man's Sulphur / Divine Orb, a 2335 x 1284 share cut to the window.
  listingsBelow: { file: "listings-below-window.png", only: true, empty: "competing",
    available: ["47102:1 47,102", "47101:1 1,413,030", "47100:1 282,600", "47000:1 799,000", "46670:1 140,010"], competing: null },
  // A sliver of the player's order card (right of the hover box, its ratio "8.30 : 1" a few pixels higher) inside
  // Competing's fifth row's strip: it doesn't set the row's line. Vivid Crystallised Lifeforce / Chaos Orb, a 2366 x 1242
  // share cut to the window; the second a moment later, with a new first Competing price.
  orderCardEdge: { file: "order-card-edge-window.png", only: true,
    available: ["7.66:1 2,107", "7.63:1 15,343", "6.90:1 3,800", "6.60:1 34,044", "6.56:1 400"],
    competing: ["8.20:1 744", "8.30:1 7,400", "8.50:1 20,298", "8.55:1 1,480", "8.65:1 2,000"] },
  orderCardEdge2: { file: "order-card-edge-2-window.png", only: true,
    available: ["7.66:1 2,107", "7.63:1 15,343", "6.90:1 3,800", "6.60:1 34,044", "6.56:1 400"],
    competing: ["8.19:1 11,000", "8.20:1 689", "8.30:1 7,400", "8.50:1 20,298", "8.55:1 1,480"] },
  // A streak in the box's texture right of Competing's fifth stock, taller than a digit and a few pixels higher: it
  // doesn't set the row's line. Stacked Deck / Divine Orb, a 2347 x 1332 share cut to the window.
  textureStreak: { file: "texture-streak-window.png",
    available: ["54:1 54", "50:1 7,800", "48:1 1,680", "47:1 4,700", "46.67:1 280"],
    competing: ["58:1 74", "59:1 300", "60:1 480", "64:1 93", "65:1 197"] },
  // A sliver of the box's left edge, cut by the side of Competing's third row's strip and arrow-sized: not a "worse than"
  // arrow, so the list goes on past it. Dead Man's Sulphur / Divine Orb, a 2347 x 1332 share cut to the window.
  edgeArrow: { file: "edge-arrow-window.png",
    available: ["38000:1 38,000", "37000:1 2,701,000", "36000:1 612,000", "35665:1 713,300", "35000:1 1,225,000"],
    competing: ["41000:1 55", "42000:1 10", "44000:1 8", "44999:1 1", "45000:1 50"] },
  // A sliver of the box's edge, cut by the side of the empty slot under Competing's third and last row: not an unread
  // row, so the list ends there. Divine Orb / Tailoring Orb, a 2347 x 1332 share cut to the window. As captured only:
  // with Available painted over, the box's levels drop and that slot's texture is stretched into a digit-sized shape.
  emptySlotEdge: { file: "empty-slot-edge-window.png", only: true,
    available: ["1.50:1 138", "1.25:1 5", "1.20:1 6", "1:1 855", "1:1.40 5"],
    competing: ["2:1 3", "2.50:1 4", "3:1 52"] },
  // No hover box: the window's own ratio field ("1 : 5.96", between the I Want and I Have amounts) sits just above
  // Available's bare place, with no column heads over it, and isn't a list. Chaos Orb / Vivid Crystallised Lifeforce,
  // a 2557 x 1406 share cut to the window.
  ratioField: { file: "ratio-field-window.png", only: true, available: null, competing: null },
  // A smaller ratio ("328.89 : 1") whose digits make a colon-like pair of marks inside it: the colon is the ratio's one
  // wide gap. Chaos Orb / Divine Orb, a 2335 x 1284 share cut to the window.
  falseColon: { file: "false-colon-window.png",
    available: ["329:1 4,935", "328.89:1 2,960", "328.14:1 48,237", "328:1 984", "327:1 2,289"],
    competing: ["345:1 50", "346:1 20", "347:1 1", "348:1 157", "349:1 21"] },
  smallest: { file: "size-1.png", // 800 x 600
    available: ["361:1 15,884", "360:1 7,560", "359:1 1,795", "358:1 358", "355:1 37,985"],
    competing: ["368:1 7", "369:1 27", "370:1 207", "373:1 111", "375:1 170"] },
};

const dataOf = async (file) => {
  const img = await new Promise((ok, err) => { const m = new Image(); m.onload = () => ok(m); m.onerror = err; m.src = `snips/${file}`; });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
};
// The screenshot with one list painted over (the panel's own colour: the median of a patch between the lists' rows), from
// row `from` (or from `start` rows above the first) to row `to`.
const blank = (data, win, which, from = 0, to = 5.6, start = from ? from - 0.6 : -0.8) => {
  const at = win.at ?? AT, span = win.right - win.left, mid = (win.left + win.right) / 2, P = at.pitch * span;
  const top = win.y + (which === "competing" ? at.competing : at.available) * span;
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  const sx = Math.round(mid - 0.15 * span), sy = Math.round(win.y + at.available * span + 6.4 * P); // between the lists
  const med = (c) => {
    const v = [];
    for (let y = sy - 2; y <= sy + 2; y++) for (let x = sx - 2; x <= sx + 2; x++) v.push(data.data[4 * (y * data.width + x) + c]);
    return v.sort((p, q) => p - q)[12];
  };
  const [r, g, b] = [med(0), med(1), med(2)];
  for (let y = Math.round(top + start * P); y < top + to * P; y++) for (let x = Math.round(mid - 0.2 * span); x < mid + 0.2 * span; x++) {
    const i = 4 * (y * data.width + x); out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b;
  }
  return out;
};
// Competing moved up into Available's place (as with no Available trades): its block (banner to last row) copied
// over Available's, and the whole of its own place painted over, banner and column heads too (none of it is left).
const moveUp = (data, win) => {
  const at = win.at ?? AT, span = win.right - win.left, mid = (win.left + win.right) / 2, P = at.pitch * span;
  const a = win.y + at.available * span, c = win.y + at.competing * span, dy = Math.round(c - a);
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  for (let y = Math.round(a - 2.8 * P); y < a + 5.6 * P; y++) for (let x = Math.round(mid - 0.2 * span); x < mid + 0.2 * span; x++) {
    const i = 4 * (y * data.width + x), j = 4 * ((y + dy) * data.width + x);
    for (let k = 0; k < 3; k++) out.data[i + k] = data.data[j + k];
  }
  // And the game's message, as in the real capture: white letters on a dark strip just under the title. Bold, so it's as
  // white as the game's whatever serif font the system has.
  const cv = document.createElement("canvas"); cv.width = data.width; cv.height = data.height;
  const g = cv.getContext("2d"); g.putImageData(blank(out, win, "competing", 0, 5.6, -2.8), 0, 0);
  const cy = win.y + 0.02 * span, fs = 0.026 * span;
  g.fillStyle = "#0b0b0b"; g.fillRect(mid - 0.3 * span, cy - 0.7 * fs, 0.6 * span, 1.4 * fs);
  g.fillStyle = "#f2f2f2"; g.font = `bold ${fs}px serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("There are no available trades for these two items", mid, cy, 0.57 * span);
  return g.getImageData(0, 0, cv.width, cv.height);
};

// Cursors beside rows, never over a digit: left of Available's first ratio, right of its third stock, and in the
// gap between ratio and stock on Competing's second row. Sized like the game's at its default, about 1.6 rows.
const cursors = (data, win) => {
  const at = win.at ?? AT, span = win.right - win.left, mid = (win.left + win.right) / 2, P = at.pitch * span;
  const a = win.y + at.available * span, c = win.y + at.competing * span;
  return [
    ["cursor left of a ratio", cursor(data, mid - 0.145 * span, a - 0.9 * P, 1.4 * P)],
    ["cursor right of a stock", cursor(data, mid + 0.115 * span, a + 2 * P - 1.2 * P, 1.6 * P)],
    ["cursor between ratio and stock", cursor(data, mid - 0.012 * span, c + P - 1.2 * P, 1.6 * P)],
  ];
};
// A stand-in mouse cursor: a bright arrow, outlined dark, its tip at (x, y), `size` tall.
const cursor = (data, x, y, size) => {
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  const c = document.createElement("canvas"); c.width = data.width; c.height = data.height;
  const g = c.getContext("2d"); g.putImageData(out, 0, 0);
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + size); g.lineTo(x + size * 0.28, y + size * 0.75); g.lineTo(x + size * 0.5, y + size * 1.05);
  g.lineTo(x + size * 0.62, y + size); g.lineTo(x + size * 0.4, y + size * 0.7); g.lineTo(x + size * 0.72, y + size * 0.7); g.closePath();
  g.fillStyle = "#e8e0c8"; g.fill(); g.lineWidth = Math.max(1, size / 16); g.strokeStyle = "#111"; g.stroke();
  return g.getImageData(0, 0, c.width, c.height);
};
// The game's brightness setting, or a capture's colours, as far as Path of Exile 1's window is found through it: darker
// and brighter, by level and by gamma.
const BRIGHTNESS = [["40% darker", (v) => 0.6 * v], ["50% brighter", (v) => 1.5 * v],
  ["at gamma 0.7", (v) => 255 * (v / 255) ** (1 / 0.7)], ["at gamma 1.25", (v) => 255 * (v / 255) ** (1 / 1.25)]];
const shade = (data, f) => {
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  for (let i = 0; i < out.data.length; i += 4) for (let k = 0; k < 3; k++) out.data[i + k] = f(data.data[i + k]);
  return out;
};
// Time limits, loose enough for a slow moment of the machine (each is about three times the slowest seen, in Firefox on
// the owner's Mac: 785 ms for a whole read, 150 ms for both names), tight enough to catch a read gone seconds long (a
// line-by-line search of rows that made no list once took 3.7 s). tools/bench.py measures closely.
const UNDER = 2500, NAMES_UNDER = 1000;
const json = await (await fetch("../html/data/glyphs.json", { cache: "no-cache" })).json();
const model = unpackModel(json.rows);
const txt = (l) => l && l.map((r) => `${r.want.text}:${r.have.text} ${r.stock.toLocaleString("en-US")}`);
for (const [shot, z] of Object.entries(SHOTS)) {
  // The window as the reader takes it (the first candidate whose hover box gives rows), for making the variants.
  const data = await dataOf(z.file), win = findAll(data, toLum(data), model, null, z.style).window ?? findWindow(data, z.style);
  eq(!!win, true, `${z.file}: the window is found`);
  if (!win) continue; // its variants are made from the window's place
  if (!z.style) for (const [name, f] of BRIGHTNESS) {
    const w = findWindow(shade(data, f));
    eq(!!w && Math.abs(w.left - win.left) < 3 && Math.abs(w.right - win.right) < 3, true, `${z.file}: the window is found ${name}`);
  }
  const cases = z.only ? [["as captured", data, z.available, z.competing, z.empty]] : [
    ["both lists", data, z.available, z.competing],
    ["Available only", blank(data, win, "competing"), z.available, null],
    ["Competing only", blank(data, win, "available"), null, z.competing],
    ["Available only, thin", blank(blank(data, win, "competing"), win, "available", 4), z.available.slice(0, 4), null],
    ["Competing only, thin", blank(blank(data, win, "available"), win, "competing", 4), null, z.competing.slice(0, 4)],
    ["Competing moved up, thin", moveUp(blank(data, win, "competing", 4), win), null, z.competing.slice(0, 4), "available"],
    ...cursors(data, win).map(([n, d]) => [n, d, z.available, z.covered?.includes(n) ? null : z.competing]),
  ];
  let slowest = 0;
  for (const [name, d, A, C, empty = null] of cases) {
    const t = performance.now();
    const got = findAll(d, toLum(d), model, null, z.style);
    slowest = Math.max(slowest, performance.now() - t);
    const a = txt(got.available) ?? null, c = txt(got.competing) ?? null;
    eq([a, c, got.empty ?? null], [A, C, empty], `${z.file} (${shot}), ${name}`);
  }
  console.log(`     ${z.file}: slowest ${Math.round(slowest)} ms`);
  eq(slowest < (z.under ?? UNDER), true, `${z.file}: read in under ${z.under ?? UNDER} ms`);
}

// The names over the lists, as watching reads them (readNames, nameOf): each box reaching to its button (the I Want box
// with its whole icon; the I Have box to its frame, and on 1024 x 768 without joining the dark below it near its frame),
// a list of one row among them (its spacing from the window's),
// and the same names were the prices 6 row spacings narrower each side (the search set by the window, not the lists).
{
  const nameModel = unpackNames(json), catalog = await (await fetch("../html/data/catalog.json")).json();
  const names = [...new Set(Object.values(catalog).map((c) => c.name).filter(Boolean))];
  for (const [file, want, have, style = "poe1"] of [["ember-short-prices-window.png", "Divine Orb", "Grand Eldritch Ember"],
    ["size-8.png", "Chaos Orb", "Divine Orb"], ["one-available-row-window.png", "Divine Orb", "Wild Crystallised Lifeforce"],
    ["sulphur-close-stock-window.png", "Divine Orb", "Dead Man's Sulphur"],
    ["one-row-head-flipped-window.png", "Chaos Orb", "Wild Crystallised Lifeforce"], ["size-2.png", "Chaos Orb", "Divine Orb"], ["size-full.png", "Chaos Orb", "Divine Orb"],
    ["poe2-exalted-2152x1243.png", "Exalted Orb", "Chaos Orb", "poe2"], ["sulphur-millions-window.png", "Divine Orb", "Dead Man's Sulphur"],
    // Two lines, mostly lowercase: its letter height measures 11 where the name reads at 13.
    ["two-line-name-window.png", "Divination Scarab of The Cloister", "Chaos Orb"]]) {
    const d = await dataOf(file), img = toLum(d), got = findAll(d, img, model, null, style), win = got.window;
    const t = performance.now(), r = readNames(img, got.place, nameModel), read = [nameOf(r.left, nameModel, names), nameOf(r.right, nameModel, names)];
    const ms = performance.now() - t;
    eq(read, [want, have], `${file}: names`);
    eq(ms < NAMES_UNDER, true, `${file}: names read in under ${NAMES_UNDER} ms (${Math.round(ms)})`);
    const { left, right } = nameBoxes(img, got.place), near = (x, at) => x != null && Math.abs(x - at) <= 0.15 * win.button;
    eq([near(left?.x0, win.left), near(right?.x1, win.right)], [true, true], `${file}: the boxes reach their buttons`);
    const p = got.place, narrow = readNames(img, { ...p, x0: p.x0 + 6 * p.pitch, x1: p.x1 - 6 * p.pitch }, nameModel);
    eq([nameOf(narrow.left, nameModel, names), nameOf(narrow.right, nameModel, names)], [want, have], `${file}: names with the lists narrower`);
  }
}

// A thin or broken icon has dark columns through it, which a search for the gap after it can take for that gap: the
// game's icons of Mortal Hope and Orb of Annulment pasted into a frame's I Have box. With the window found, the text
// starts at the gap where the window puts it, and the name reads as with the box's own icon.
{
  const nameModel = unpackNames(json), catalog = await (await fetch("../html/data/catalog.json")).json();
  const names = [...new Set(Object.values(catalog).map((c) => c.name).filter(Boolean))];
  for (const [file, want, have, style] of [["icon-mortal-hope-window.png", "Divine Orb", "Grand Eldritch Ember", "poe1"],
    ["icon-annulment-poe2-window.png", "Exalted Orb", "Chaos Orb", "poe2"]]) {
    const d = await dataOf(file), img = toLum(d), got = findAll(d, img, model, null, style);
    const r = readNames(img, got.place, nameModel), [best] = rankNames(r.right, nameModel, names, 1);
    eq([nameOf(r.left, nameModel, names), nameOf(r.right, nameModel, names), best?.cost < 0.25], [want, have, true], `${file}: names, the I Have name read cleanly`);
  }
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
if (failed) document.title = "FAILED";
