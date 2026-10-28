// Snip reader tests (SPEC.md §4.7). Browser only (it decodes the PNGs in snips/): open snip.html.
// Also builds html/data/glyphs.json and tests/lines.json from the snips: run buildGlyphs() in the console, or click the button.
import { packModel, takeMasters } from "../html/js/rows.js";
import {
  AT, AT2, bannerOf, clean, cropLum, findWindow, groups, headsOf, learn, learnNames, nameOf, nameText, packGlyphs, packNames, toLum,
  unpackGlyphs, unpackNames,
} from "../html/js/snip.js";

let failed = 0;
function eq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

// --- the lists in each snip ---
const omenAvailable = ["1:142 2", "1:150 6", "1:159 14", "1:160 2", "1:164 5", "<1:164 19"];
const omenCompeting = ["1:106 2,544", "1:103 206", "1:101 505", "1:100 2,900", "1:95 665", ">1:95 8,583"];
const scarabAvailable = ["1:2.90 19", "1:3 23", "1:3.11 9", "1:3.22 9", "1:3.33 3", "<1:3.33 182"];
const scarabCompeting = ["1:2.50 4,270", "1:2.10 21", "1:2 2,708", "1:1.50 798", "1:1.15 46", ">1:1.15 448"];
// Shown "x : 1", small (digits about 9 pixels): dim colons, decimal points touching the next digit.
const valdoAvailable = ["1.33:1 4", "1.30:1 264", "1.27:1 105", "1.25:1 245", "1.20:1 264", "<1.20:1 17,704"];
const valdoCompeting = ["1.63:1 27", "1.66:1 58", "1.67:1 186", "1.75:1 12", "2:1 878", ">2:1 1"];
// Ratios over 999 without a comma; the longest drawn smaller than the stock beside them.
const bigAvailable = ["2501:1 897,859", "2500.10:1 250,010", "2500:1 1,782,500", "2494.12:1 42,400", "2470:1 24,700", "<2470:1 35,308,335"];
const bigCompeting = ["2632:1 18", "2633:1 10", "2634:1 45", "2635:1 21", "2640:1 28", ">2640:1 3,466"];
// A pinned window moved over the scenery: the small "worse than" row too.
const movedAvailable = ["2600:1 26,000", "2501:1 280,112", "2500.10:1 250,010", "2500:1 1,800,000", "2494.12:1 42,400", "<2494.12:1 35,333,035"];
const movedCompeting = ["2620:1 2", "2628:1 57", "2630:1 8", "2632:1 200", "2633:1 95", ">2633:1 3,568"];
// A thin market: Competing Trades has only three prices and no worse-than row; Available goes from x : 1 to 1 : x.
const thinAvailable = ["1.50:1 12", "1.30:1 13", "1:1 562", "1:1.15 13", "1:1.43 7", "<1:1.43 79"];
const thinCompeting = ["3.50:1 6", "3.60:1 5", "4:1 168"];
// The same market the other way round: now Available Trades is the short one.
const thin2Available = ["1:3.50 6", "1:3.60 5", "1:4 168"];
const thin2Competing = ["1:1.50 12", "1:1.30 13", "1:1 562", "1.15:1 13", "1.43:1 7", ">1.43:1 79"];
// The alphabet batch (each against Chaos).
const tattooA = ["1:50 4", "1:69 63", "1:70 23", "1:73 22", "1:74 14", "<1:74 107"];
const tattooC = ["1:25 6,550", "1:24 3,552", "1:23 736", "1:22 1,342", "1:21 1,029", ">1:21 752"];
const glassA = ["1:1 139", "1:2 1,208", "1:2.29 1,721", "1:3 200", "1:5 39"]; // exactly 5 prices: no worse-than row
const glassC = ["16:1 232", "17:1 16", "18:1 29", "20:1 62", "40:1 10", ">40:1 1"];
const whetA = ["1:1.07 252", "1:1.88 16", "1:4 245", "1:5.06 178", "1:5.50 18", "<1:5.50 340"];
const whetC = ["1:1 44"];
const imperialA = ["1:10 11", "1:14.93 67", "1:19 75", "1:28 154", "1:33 7", "<1:33 24"];
const imperialC = ["1:6 4,824", "1:3 279", "1:1 10", "6:1 129", "8:1 8", ">8:1 93"]; // a 6x step, 1 : 1 to 6 : 1
const alchemyA = ["48.95:1 18,369", "48:1 240", "44:1 440", "40:1 6,280", "39:1 78", "<39:1 107,263"]; // hover view, a dark window
const jewellerA = ["41:1 7,339", "40:1 21,480", "38:1 380", "35:1 119,245", "29.41:1 10,000", "<29.41:1 50,382"];
const jewellerC = ["123:1 966", "124:1 54", "125:1 162", "150:1 1", "175:1 175", ">175:1 14"];
const regalA = ["17.50:1 5,075", "17:1 7,004", "15:1 75", "2:1 64", "1.80:1 180", "<1.80:1 162"]; // a 7.5x step
const regalC = ["18:1 329", "19:1 859", "20:1 3,267", "23:1 2,873", "24:1 1,818", ">24:1 400"];
// No available trades at all: Competing moves up into Available's place, and steps 13x.
const mirrorC = ["1:65000 195,000", "1:5001 5,001", "1:5000 5,000", "1:3500 3,500", "1:1300 1,300", ">1:1300 16,476"];
const unmakingA = ["2.44:1 19,071", "2.41:1 101", "2.11:1 356", "2.10:1 294", "2:1 396", "<2:1 2,016"];
const unmakingC = ["2.50:1 30"];
const exaltedA = ["1:3.85 1,509", "1:3.89 85", "1:3.90 960", "1:4 12,423", "1:4.50 804", "<1:4.50 5,513"];
const exaltedC = ["1:2.20 2,673", "1:2.12 106", "1:2.01 201", "1:2 9,378", "1:1.80 305", ">1:1.80 32,136"];
const armourA = ["1:5 100", "1:6 1,188", "1:8 109", "1:10 751", "1:15 200", "<1:15 74"];
const armourC = ["1:1 2,111"];
const valdoBigA = ["1:196 2", "1:200 8", "1:204 9", "1:205 1", "1:207 25", "<1:207 305"];
const valdoBigC = ["1:195 975", "1:193 1,544", "1:191 1,719", "1:170 11,900", "1:116 23,200", ">1:116 476"];
const lifeA = ["7.84:1 21,171", "7.65:1 24,489", "7.53:1 9,944", "7.50:1 68,850", "7.50:1 12,500", "<7.50:1 551,110"]; // two levels shown alike
const lifeC = ["8.28:1 52,666", "8.50:1 19,556", "8.79:1 9,300", "9:1 776", "9.45:1 1,500", ">9.45:1 54,501"];
const smallA = ["7.96:1 7,904", "7.96:1 7,959", "7.88:1 2,128", "7.84:1 18,000", "7.65:1 24,489", "<7.65:1 642,495"]; // a whole desktop
const smallC = ["8.25:1 484", "8.28:1 47,922", "8.50:1 14,440", "8.79:1 9,300", "9:1 757", ">9:1 56,001"];

// --- the snips: the line reader's examples (tests/lines.json, built below) ---
const SNIPS = [
  { file: "omen-hover.png", available: omenAvailable, competing: null },
  { file: "omen-alt.png", available: omenAvailable, competing: omenCompeting },
  { file: "scarab-large.png", available: scarabAvailable, competing: scarabCompeting },
  { file: "scarab-small.png", available: scarabAvailable, competing: scarabCompeting },
  { file: "valdo-small.png", available: valdoAvailable, competing: valdoCompeting },
  { file: "big-ratios.png", available: bigAvailable, competing: bigCompeting },
  { file: "moved-window.png", available: movedAvailable, competing: movedCompeting },
  { file: "thin-market.png", available: thinAvailable, competing: thinCompeting },
  { file: "thin-available.png", available: thin2Available, competing: thin2Competing },
  { file: "tattoo.png", available: tattooA, competing: tattooC },
  { file: "glassblower.png", available: glassA, competing: glassC },
  { file: "tainted-whetstone.png", available: whetA, competing: whetC },
  { file: "imperial.png", available: imperialA, competing: imperialC },
  { file: "alchemy.png", available: alchemyA, competing: null },
  { file: "jeweller.png", available: jewellerA, competing: jewellerC },
  { file: "regal.png", available: regalA, competing: regalC },
  { file: "mirror.png", available: null, competing: mirrorC },
  { file: "unmaking.png", available: unmakingA, competing: unmakingC },
  { file: "exalted.png", available: exaltedA, competing: exaltedC },
  { file: "tainted-armourer.png", available: armourA, competing: armourC },
  { file: "valdo-big.png", available: valdoBigA, competing: valdoBigC },
  { file: "lifeforce-chaos.png", available: lifeA, competing: lifeC },
  { file: "lifeforce-small.png", available: smallA, competing: smallC },
];
const load = (src) => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = src; });
async function lumOf(file) {
  const img = await load(`snips/${file}`);
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  return toLum(g.getImageData(0, 0, c.width, c.height));
}
const imgs = await Promise.all(SNIPS.map((s) => lumOf(s.file)));
const known = (s) => [s.available, s.competing].filter(Boolean); // what learn() is told a snip shows
const shipped = unpackGlyphs(await (await fetch("lines.json", { cache: "no-cache" })).json());

async function canvasOf(file) {
  const img = await load(`snips/${file}`);
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}
// --- a jump of over 30x between neighbouring prices ends a list (groups) ---
// An absurd order (10000 : 1 after 69 : 1) or a misread row: the rows above the jump are the list when there are at least
// two, without the rest or the "worse than" row; with fewer, nothing is read.
{
  const rowsAt = (texts) => texts.map((text, i) => ({ text, y: 100 + 25 * i }));
  const listed = (found, kind) => found[kind]?.map((r) => `${r.want.text}:${r.have.text} ${r.stock.toLocaleString("en-US")}`) ?? null;
  const outlier = groups(rowsAt(["60:1 7,324", "68:1 830", "69:1 510", "10000:1 1", "30000:1 1", ">30000:1 1"]));
  eq([listed(outlier, "competing"), outlier.rest?.competing ?? null], [["60:1 7,324", "68:1 830", "69:1 510"], null],
    "an absurd order ends the list before it, the worse-than row left out");
  const misreadThird = groups(rowsAt(["1:2.45 10", "1:2.50 20", "1:255 30", "1:2.60 40", "1:2.65 50", "<1:2.65 60"]));
  eq(listed(misreadThird, "available"), ["1:2.45 10", "1:2.50 20"], "a misread third row: the two rows above it are the list");
  const misreadSecond = groups(rowsAt(["1:2.45 10", "1:245 20", "1:2.55 30", "1:2.60 40", "1:2.65 50", "<1:2.65 60"]));
  eq([listed(misreadSecond, "available"), listed(misreadSecond, "competing")], [null, null], "a misread second row: nothing read");
  const thin = groups(rowsAt(["60:1 7,324", "68:1 830", "69:1 510", "10000:1 1"]), () => "competing");
  eq(listed(thin, "competing"), ["60:1 7,324", "68:1 830", "69:1 510"], "a thin list ends before its jump too");
  // One row before the jump (Competing's 68 : 1, then 10000): kept beside Available, its best price within 10x of it;
  // a misread best row (6800 for 68.00) is 100x off, and not kept; nor is one with no other list to check it against.
  // (Not kept, the rows after it are read as the list, as a header read as a row; in a frame they start a row too low
  // for a list, so nothing is read: rows.test.js.)
  const lists = (comp) => [...rowsAt(["41:1 29,233", "40.05:1 6,007", "40:1 1,219,880", "39.59:1 2,019", "37:1 14,800", "<37:1 736,406"]),
    ...comp.map((text, i) => ({ text, y: 100 + 25 * (8.45 + i) }))];
  const lone = groups(lists(["68:1 702", "10000:1 1", "30000:1 1", "50000:1 1"]));
  eq([listed(lone, "available")?.length, listed(lone, "competing")], [5, ["68:1 702"]], "one row before a jump, near Available's best: kept");
  const far = groups(lists(["6800:1 702", "68.50:1 1", "69:1 1", "70:1 1"]));
  eq([listed(far, "available")?.length, listed(far, "competing")?.[0]], [5, "68.50:1 1"], "one row 100x off Available's best: not kept");
  const alone = groups(rowsAt(["68:1 702", "10000:1 1", "30000:1 1", "50000:1 1"]), () => "competing");
  eq(listed(alone, "competing")?.[0], "10000:1 1", "one row before a jump with no other list: not kept");
}

// --- currency names (which pair a frame shows) ---
// Name boxes as nameBoxes() cuts them (name-<shot>-want.png, -have.png), with what they say. Those marked `learn`
// teach data/glyphs.json its letters; the rest are only read: the same names smaller, the hubs at every size.
const NAMES = [
  ["omen-alt", "Omen of Amelioration", "Chaos Orb", 1], ["scarab-large", "Horned Scarab of Bloodlines", "Divine Orb", 1],
  ["scarab-small", "Horned Scarab of Bloodlines", "Divine Orb"], ["valdo-small", "Valdo's Puzzle Box", "Divine Orb"],
  ["thin-market", "Harvest Scarab of Cornucopia", "Divine Orb", 1], ["thin-available", "Divine Orb", "Harvest Scarab of Cornucopia"],
  ["tattoo", "Tattoo of the Ngamahu Firewalker", "Chaos Orb", 1], ["glassblower", "Glassblower's Bauble", "Chaos Orb", 1],
  ["tainted-whetstone", "Tainted Blacksmith's Whetstone", "Chaos Orb", 1], ["imperial", "Imperial Enshrouding Crystal", "Chaos Orb", 1],
  ["alchemy", "Orb of Alchemy", "Chaos Orb", 1], ["jeweller", "Jeweller's Orb", "Chaos Orb", 1],
  ["regal", "Regal Orb", "Chaos Orb", 1], ["mirror", "Mirror of Kalandra", "Chaos Orb", 1], ["unmaking", "Orb of Unmaking", "Chaos Orb", 1],
  ["exalted", "Exalted Orb", "Chaos Orb", 1], ["tainted-armourer", "Tainted Armourer's Scrap", "Chaos Orb", 1],
  ["valdo-big", "Valdo's Puzzle Box", "Chaos Orb", 1],
  ["verisium", "Expedition Scarab of Verisium Powder", "Chaos Orb", 1], ["kitava", "Tattoo of the Kitava Blood Drinker", "Chaos Orb", 1],
  ["al-hezmin", "Al-Hezmin's Crest", "Chaos Orb", 1], ["foulborn-regal", "Foulborn Regal Orb", "Chaos Orb", 1],
  ["zorath", "Zorath's Eye of the Inevitable", "Chaos Orb", 1], ["unrequited", "Unrequited Love", "Chaos Orb", 1],
  ["ngamahu-warrior", "Tattoo of the Ngamahu Warrior", "Chaos Orb", 1], ["journey-mind", "Journey Tattoo of the Mind", "Chaos Orb", 1],
  ["xesht", "Flesh of Xesht", "Chaos Orb", 1], ["brush", "Brush, Paint and Palette", "Chaos Orb", 1],
  ["dialla", "Dialla's Subjugation", "Chaos Orb", 1], ["bad-luck", "Seven Years Bad Luck", "Chaos Orb", 1],
  ["gemling", "Gift of the Gemling Queen", "Divine Orb", 1], ["side-quest", "The Side Quest", "Chaos Orb", 1],
  ["verisium-small", "Expedition Scarab of Verisium Powder", "Chaos Orb"], ["kitava-small", "Tattoo of the Kitava Blood Drinker", "Chaos Orb"],
  ["al-hezmin-small", "Al-Hezmin's Crest", "Chaos Orb"], ["foulborn-regal-small", "Foulborn Regal Orb", "Chaos Orb"],
  ["zorath-small", "Zorath's Eye of the Inevitable", "Chaos Orb"],
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "full"].map((n) => [`size-${n}`, "Chaos Orb", "Divine Orb"]),
  ["share-1280", "Chaos Orb", "Divine Orb"], ["inv-1280", "Chaos Orb", "Divine Orb"], ["stash-2125", "Chaos Orb", "Divine Orb"],
  ["stash-inv-2125", "Chaos Orb", "Divine Orb"], ["vivid-wide", "Vivid Crystallised Lifeforce", "Divine Orb"],
  // A watched frame at 2502 x 1332, its I Have box with the game's favourite star beside it: "Stacked Deck" has three
  // letters taller than its capitals, so its letter height must come from the box (else it reads as Sacred Orb).
  ["stacked-deck", "Chaos Orb", "Stacked Deck"],
  // A watched frame at 1689 x 1146 (the window resized), its I Want box 40 px: the same letters still measure 14 where
  // the name reads at 12, so it's only certain when read again smaller (nameOf).
  ["stacked-1689", "Stacked Deck", "Chaos Orb"],
];
const whole = (img) => ({ x0: 0, y0: 0, x1: img.w - 1, y1: img.h - 1 });
const nameTexts = {}; // each box's text, null where nameBoxes found none (size-4's I Have)
for (const [shot] of NAMES) for (const side of ["want", "have"]) {
  const img = await lumOf(`name-${shot}-${side}.png`).catch(() => null);
  nameTexts[`${shot}-${side}`] = img && nameText(img, whole(img));
}
const catalog = await (await fetch("../html/data/catalog.json")).json();
const allNames = [...new Set(Object.values(catalog).map((c) => c.name).filter(Boolean))];
// Letters learned from the `learn` boxes, leaving out every box of the name `unseen` (so it's read unseen).
const namesModel = (unseen = null) => learnNames(NAMES.filter(([, want, , learn]) => learn && want !== unseen)
  .flatMap(([shot, want, have]) => [{ text: nameTexts[`${shot}-want`], name: want }, { text: nameTexts[`${shot}-have`], name: have }]));
const builtNames = namesModel();
eq(builtNames.skipped, [], "every learning box's letters can be laid out");
const shippedNames = unpackNames(await (await fetch("../html/data/glyphs.json", { cache: "no-cache" })).json());
// Each box named right among every catalog name, with its own name's letters unseen, then as shipped. Letters under
// 8 px (the smallest window) may leave it unsure (null), but never another name.
const unseenModels = {};
const named = (text, model, name) => { const got = nameOf(text, model, allNames); return got === null && text.lh < 8 ? name : got; };
for (const [shot, want, have] of NAMES) {
  const model = (unseenModels[want] ??= namesModel(want));
  for (const [side, name] of [["want", want], ["have", have]]) {
    const text = nameTexts[`${shot}-${side}`];
    if (!text) continue;
    eq(named(text, model, name), name, `name-${shot}-${side}: ${name}, unseen`);
    eq(named(text, shippedNames, name), name, `name-${shot}-${side}: the same with data/glyphs.json`);
  }
}
// The box half under the hover box (the name's second line hidden) is no name for certain; its I Have still is.
const hover = { want: await lumOf("name-omen-hover-want.png"), have: await lumOf("name-omen-hover-have.png") };
eq(nameOf(nameText(hover.want, whole(hover.want)), shippedNames, allNames), null, "a name half covered is no name");
eq(nameOf(nameText(hover.have, whole(hover.have)), shippedNames, allNames), "Chaos Orb", "its other box still reads");
// data/glyphs.json: the names' letters, and the row reader's (js/rows.js) masters, header banners and column heads,
// taken from the game at its largest (size-full.png): the lists' characters, the smaller ratio size's too ("366.50 : 1"),
// the two banners' first words, and the heads (PoE2's from its own frame).
const FULL = { file: "size-full.png", box: [1109, 261, 327, 533],
  rows: ["363:1 1,089", "362:1 18,824", "360:1 11,160", "356:1 36,668", "355:1 20,590", "<355:1 4,009,739",
    "366:1 181", "366.50:1 10", "367:1 97", "368:1 9", "369:1 5", ">369:1 3,028"] };
const fullCanvas = await canvasOf(FULL.file), fullData = fullCanvas.getContext("2d").getImageData(0, 0, fullCanvas.width, fullCanvas.height);
const fullLum = toLum(fullData), fullWin = findWindow(fullData), fullSpan = fullWin.right - fullWin.left;
const rowModel = {
  ...takeMasters(cropLum(fullLum, ...FULL.box), FULL.rows, shipped),
  banners: { available: bannerOf(fullLum, fullWin, fullWin.y + AT.available * fullSpan), competing: bannerOf(fullLum, fullWin, fullWin.y + AT.competing * fullSpan) },
};
// The column heads over Available's first row, from each game's window: size-full's, and the PoE2 frame's.
const poe2Canvas = await canvasOf("poe2-exalted-2152x1243.png"), poe2Data = poe2Canvas.getContext("2d").getImageData(0, 0, poe2Canvas.width, poe2Canvas.height);
const poe2Win = findWindow(poe2Data, "poe2"), poe2Span = poe2Win.right - poe2Win.left;
rowModel.heads = { poe1: headsOf(fullLum, fullWin, fullWin.y + AT.available * fullSpan), poe2: headsOf(toLum(poe2Data), poe2Win, poe2Win.y + AT2.available * poe2Span) };
eq(rowModel.masters.some((m) => m.small), true, "the reference has masters of the smaller ratio size");
// size-full's small ratio ("366.50") has no 2, 4, 7, 8 or 9, and shrunk full-size ones read too unsurely (an 8 of
// "158.68" at 0.085). They come from other frames (2294 x 1241, cut to the window), their small ratios read by the
// usual reader: only small digits size-full lacks, each from one frame, so every other character reads as before.
const SMALL = [
  { file: "small-eights-window.png", box: [320, 160, 280, 440], digits: ["2", "7", "8", "9"],
    rows: ["130:1 29,250", "129.20:1 50,000", "128.21:1 40,000", "128.11:1 545,100", "124:1 405,852", "<124:1 7,356,470",
      "158.68:1 334", "159:1 843", "159.98:1 850", "162.70:1 140", "162.79:1 10,320", ">162.79:1 14,469"] },
  { file: "small-four-window.png", box: [320, 160, 280, 440], digits: ["4"], // "94.12 : 1"
    rows: ["103:1 309", "102.17:1 47,000", "100:1 20,200", "98.67:1 888", "94.12:1 9,318", "<94.12:1 67,780", "500:1 119"] },
];
const smallOf = (m) => new Set(m.masters.filter((x) => x.small).map((x) => x.ch));
rowModel.more = [];
for (const s of SMALL) {
  const canvas = await canvasOf(s.file), lum = toLum(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height));
  const got = takeMasters(cropLum(lum, ...s.box), s.rows, shipped);
  rowModel.more.push({ ...got, masters: got.masters.filter((m) => m.small && s.digits.includes(m.ch)) });
  eq([...smallOf(rowModel.more.at(-1))].sort(), s.digits, `${s.file} gives small ${s.digits.join(", ")}`);
}
// tests/lines.json: every snip's glyphs, the line reader's examples (only for reading the frames above, not shipped).
window.buildGlyphs = () => {
  const glyphs = [];
  SNIPS.forEach((s, i) => learn(imgs[i], known(s), glyphs));
  return { "glyphs.json": JSON.stringify({ names: packNames(builtNames), rows: packModel(rowModel) }), "lines.json": JSON.stringify(packGlyphs(clean(glyphs))) };
};

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
if (failed) document.title = "FAILED";
