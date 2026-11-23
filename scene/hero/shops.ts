// The hero district's shops: one made-up identity per bar (name, kind, floor, colours, lettering), the same on all its
// signs. tools/tokyo/hero-textures.ts draws every shop's signs into one 512 x 512 slot of a 2048 x 2048 page
// (assets/city/hero/tex/shops-<page>.png), and `shopCells` says where. The names are invented; none is a real bar's.
//
// Slot layout (px, within the shop's 512 x 512 slot):
//   lightbox  0..384 x   0..192   (2 : 1, the backlit box over the door)
//   noren     0..384 x 192..384   (2 : 1, the curtain's cloth across its panels)
//   plate     0..384 x 384..512   (3 : 1, the plate on the door / a small wall sign)
//   blade   384..512 x   0..512   (1 : 4, the vertical sign out from the wall; also the standing sign)

export const PAGE = 2048;
export const SLOT = 512;
export const SLOTS_PER_ROW = PAGE / SLOT;
export const SHOPS_PER_PAGE = SLOTS_PER_ROW * SLOTS_PER_ROW;
/** Pixels each cell keeps clear at its edges (filtering and mips stay inside the sign). */
export const PAD = 6;

export type Cell = [number, number, number, number];
export type SignStyle = "plain" | "border" | "inverse" | "pictogram" | "hand" | "split";
export type Pictogram = "glass" | "cat" | "moon" | "note" | "star" | "bottle" | "fish" | "none";

export interface Shop {
  index: number;
  name: string;
  /** Down the blade sign: a Japanese name's glyphs (at most 6), a Latin name whole (turned). */
  vertical: string;
  kind: string;
  floor: string;
  /** A third line: a phone number, the charge, the hours... */
  extra: string;
  /** Face colour, lettering colour, accent colour (sRGB hex). */
  face: string;
  ink: string;
  accent: string;
  /** Noren cloth and its lettering. */
  cloth: string;
  clothInk: string;
  font: string;
  style: SignStyle;
  pictogram: Pictogram;
  /** 0 new .. 1 old: yellowed plastic, dirt, faded colours. */
  age: number;
  latin: boolean;
}

const MINCHO = "Hiragino Mincho ProN";
const KAKU = "Hiragino Kaku Gothic ProN";
const HEAVY = "Hiragino Kaku Gothic StdN";
const MARU = "Hiragino Maru Gothic ProN";
const UDG = "BIZ UDGothic";
const UDM = "BIZ UDMincho";
export const FONTS = { MINCHO, KAKU, HEAVY, MARU, UDG, UDM };

const WOMEN = ["ひろみ", "まゆみ", "けい子", "ゆかり", "和子", "洋子", "ミチ", "ナナ", "ルミ", "サチ", "まり", "千代", "あけみ", "みどり", "ちえ", "トモ", "マキ", "文", "里美", "かおる", "ユキ", "レイ", "しのぶ", "睦美", "なぎさ", "絹代", "はる", "エミ", "百合", "リエ", "さゆり", "ジュン", "弥生", "マリ子", "ともえ", "キヨ", "照代", "あや", "ミドリ", "静香", "ノリコ", "紀子", "真弓", "サエ", "かよ", "瑠璃", "アキ", "富士子", "ちあき", "はつ", "ヨシ江", "ゆり子", "トシ", "つる", "ハナ", "冬美", "ケイ", "鈴子", "みさお", "ひとみ"];
const WORDS = ["灯", "月影", "夜光", "路地", "迷子", "酔いどれ", "猫町", "雨音", "夜汽車", "渡り鳥", "一番星", "三日月", "銀河", "朝まで", "止まり木", "ほたる", "宵待", "風見", "しずく", "旅の途中", "小雨", "夜更け", "はしご", "ひとりごと", "花冷え", "薄明", "灯台守", "隠れ家", "古時計", "鈴虫", "とんぼ", "やどりぎ", "ねこじゃらし", "夜長", "白夜", "竹とんぼ", "おぼろ", "椿", "紫陽花", "金魚", "からす", "ふくろう", "蝸牛", "千鳥足", "まどろみ", "ゆらぎ", "夕焼け", "残響", "余白", "うたかた", "木漏れ日", "夜想", "糸電話", "風鈴", "紙ひこうき", "汽笛", "灯り", "夢見", "宵の口", "あまやどり", "ちょうちん", "かげろう", "夜明け前", "月見草", "ささやき", "揺り籠", "とまりぎ", "群青", "琥珀", "藍", "茜", "鈍色", "瑠璃色", "宵闇", "雪見", "花火", "らくだ", "くじら", "ペンギン", "こうもり", "黒板", "万華鏡", "砂時計", "蓄音機", "文鳥", "ひまわり", "ひなげし", "すずらん", "おかめ", "ひょっとこ", "だるま", "てるてる", "あめふり", "かくれんぼ", "おはじき", "ビー玉", "とおりゃんせ", "でんでん", "ぶらんこ", "まわり道", "ほろ酔い", "しゃぼん玉"];
const LATIN = ["NIGHTJAR", "Little Owl", "Moonshine", "SLOW BOAT", "Kitsune", "LAMP", "Tsuki", "OASIS", "Blue Hour", "Tin Drum", "Velvet", "ECHO", "Satellite", "Mole", "Lantern", "RUST", "Paper Crane", "Nocturne", "LOOP", "Tumbler", "Driftwood", "Static", "Cinder", "Marmalade", "Gin Fizz", "Night Owl", "Inkwell", "Sparrow", "Low Tide", "Vinyl", "Juniper", "Moth", "Harbor Light", "Quiet Storm", "Rabbit Hole", "Bluebird", "Copper Kettle", "Foghorn", "Starling", "Midnight Tram", "Tangerine", "Brass Key", "Small Hours", "Ferris", "Ivory", "Lost Glove", "Ember", "Sundown", "Wren", "Second Floor"];
const ODD = ["深夜二時半", "あと一杯", "終電まで", "まだ帰らない", "二階の奥", "ちょっと一杯", "地下一階", "三丁目", "七番目", "仮営業", "準備中", "鍵っ子", "4畳半", "夜の図書室", "人生劇場", "ぼちぼち", "猫と月", "もう一軒", "空席あり", "雨の日だけ", "ひと休み", "四十八番", "閉店未定", "裏口", "階段の上", "あしたは休み", "八時から", "金曜日", "月曜休み", "三人まで"];
const KINDS = ["BAR", "スナック", "酒場", "居酒屋", "小料理", "バー", "ライブバー", "喫茶", "Bar", "酒処", "呑み処", "炉端", "おでん", "Snack", "Pub", "立呑み"];
const EXTRA = ["TEL 03-3209-%%%%", "TEL 03-3200-%%%%", "チャージ ¥%00", "OPEN 20:00〜", "19:00 - 05:00", "会員制", "どなたでも", "Since 19%%", "日曜定休", "お一人様歓迎", "カラオケ", "Music & Drinks", "2F へどうぞ", "朝まで営業"];
const SCHEMES: [string, string, string][] = [
  ["#f4f1e6", "#b0141c", "#1d1d1d"], ["#f6f3ea", "#151515", "#b0141c"], ["#f2efe2", "#14398a", "#3a3a3a"],
  ["#161616", "#f3d23c", "#f0ece0"], ["#a3121a", "#fbf6ea", "#f3d23c"], ["#f6e6b8", "#3a1d0e", "#8a2a10"],
  ["#0d2a4f", "#f6f1e3", "#9fd0ff"], ["#f5f5f0", "#2c6e2f", "#222222"], ["#efe6d2", "#5a1e6e", "#333333"],
  ["#1e4a2a", "#f4efdc", "#e8c05a"], ["#f3c6d4", "#5a1030", "#222222"], ["#e8e2d0", "#7a1f10", "#2a2a2a"],
  ["#2a2a2e", "#ff6fa0", "#f2f2f2"], ["#f8f4e8", "#d2591a", "#222222"], ["#fffaf0", "#20206a", "#b0141c"],
];
const CLOTHS: [string, string][] = [["#1d2a4a", "#f2efe6"], ["#efeadc", "#1d2a4a"], ["#8e1a1a", "#f6efe0"], ["#1a1a1a", "#e8e0cc"], ["#3c4a2e", "#efe9d6"], ["#5a2a46", "#f3e9e0"], ["#c48a2a", "#2a1608"]];
const STYLES: SignStyle[] = ["plain", "plain", "border", "border", "inverse", "pictogram", "hand", "split"];
const PICTOS: Pictogram[] = ["glass", "cat", "moon", "note", "star", "bottle", "fish"];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The district's shops, always the same list. */
export const SHOP_COUNT = 240;
export const SHOPS: Shop[] = (() => {
  const r = rng(20261122);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const used = new Set<string>();
  const out: Shop[] = [];
  for (let i = 0; out.length < SHOP_COUNT && i < 10000; i++) {
    const roll = r();
    const latin = roll < 0.2;
    let name = latin ? pick(LATIN) : roll < 0.48 ? pick(WOMEN) : roll < 0.88 ? pick(WORDS) : pick(ODD);
    // a few names get a prefix or suffix, as bars often do (ひろみ's, BAR 灯, 第二椿)
    // (each base name once, so the decorated ones do not crowd in on the re-rolls)
    if (used.has(name)) continue;
    used.add(name);
    const deco = r();
    if (!latin && deco < 0.04) name = `第二${name}`;
    else if (!latin && deco < 0.09 && name.length <= 2) name = `${name}屋`;
    else if (latin && deco < 0.15) name = `${name}'s`;
    const kind = latin ? pick(["BAR", "Bar", "Pub", "Snack", "LIVE BAR", "Cafe & Bar"]) : pick(KINDS);
    const [face, ink, accent] = pick(SCHEMES);
    const [cloth, clothInk] = pick(CLOTHS);
    const fontRoll = r();
    const font = latin ? pick([KAKU, HEAVY, UDG, MINCHO]) : fontRoll < 0.34 ? MINCHO : fontRoll < 0.55 ? KAKU : fontRoll < 0.7 ? HEAVY : fontRoll < 0.82 ? MARU : fontRoll < 0.92 ? UDM : UDG;
    const extra = pick(EXTRA).replace(/%+/g, (m) => Array.from({ length: m.length }, () => Math.floor(r() * 10)).join(""));
    out.push({
      index: out.length, name, vertical: latin ? name : name.replace(/[\s']/g, "").slice(0, 6), kind, floor: r() < 0.3 ? "2F" : "1F", extra,
      face, ink, accent, cloth, clothInk, font, style: pick(STYLES), pictogram: r() < 0.35 ? pick(PICTOS) : "none",
      // (kept up, 1980: a little yellowing and dust at most)
      age: Math.min(0.55, r() * r() * 0.7 + 0.05), latin,
    });
  }
  return out;
})();

export const SHOP_PAGES = Math.ceil(SHOP_COUNT / SHOPS_PER_PAGE);
/** The page file of page p. */
export const shopPage = (p: number) => `assets/city/hero/tex/shops-${p}.png`;

/** Pixel rectangles of the cells within a slot (x0, y0, x1, y1). */
export const SLOT_CELLS = {
  lightbox: [0, 0, 384, 192],
  noren: [0, 192, 384, 384],
  plate: [0, 384, 384, 512],
  blade: [384, 0, 512, 512],
} as const;

/** Where shop i's signs are: its page, and each sign's cell in image terms [u0, top, u1, bottom] (0..1 of the page),
 *  as Batches.box's frontUV / backUV take them. Indices past SHOP_COUNT wrap. */
export function shopCells(i: number): { page: number; shop: Shop; lightbox: Cell; noren: Cell; plate: Cell; blade: Cell; standing: Cell } {
  const k = ((i % SHOP_COUNT) + SHOP_COUNT) % SHOP_COUNT;
  const page = Math.floor(k / SHOPS_PER_PAGE), s = k % SHOPS_PER_PAGE;
  const sx = (s % SLOTS_PER_ROW) * SLOT, sy = Math.floor(s / SLOTS_PER_ROW) * SLOT;
  const cell = (c: readonly [number, number, number, number]): Cell => [(sx + c[0] + PAD) / PAGE, (sy + c[1] + PAD) / PAGE, (sx + c[2] - PAD) / PAGE, (sy + c[3] - PAD) / PAGE];
  const blade = cell(SLOT_CELLS.blade);
  return { page, shop: SHOPS[k], lightbox: cell(SLOT_CELLS.lightbox), noren: cell(SLOT_CELLS.noren), plate: cell(SLOT_CELLS.plate), blade, standing: blade };
}
