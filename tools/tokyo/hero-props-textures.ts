// Textures for the hero district's procedural props (scene/hero/props.ts): chalk menus for A-boards, drink labels
// for the vending machine's cans and bottles, its header, price strip and side graphic, and the recycling bin's label.
// Drawn as SVG through sharp with the system's Japanese fonts; brand-free and made up.
//
//   node tools/tokyo/hero-props-textures.ts   -> assets/city/hero/tex/{menus,cans,vend-header,vend-price,vend-side,bin-label}.png
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { repoRoot } from "../lib/paths.ts";

const dir = join(repoRoot, "assets/city/hero/tex");
mkdirSync(dir, { recursive: true });
const GOTHIC = "Hiragino Kaku Gothic ProN, Hiragino Sans, sans-serif";
const HEAVY = "Hiragino Kaku Gothic StdN, Hiragino Kaku Gothic Std, Hiragino Sans, sans-serif";
const MARU = "Hiragino Maru Gothic ProN, Hiragino Maru Gothic Pro, sans-serif";
const MINCHO = "Hiragino Mincho ProN, Hiragino Mincho Pro, serif";
let seed = 23;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const png = (svg: string, file: string) => sharp(Buffer.from(svg)).png().toFile(join(dir, file));

/** Chalk menus: 4 cells of 512 x 704 (portrait), a slate with chalk lettering, a little crooked. */
async function menus() {
  const W = 512, H = 704;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${4 * W}" height="${H}"><defs><filter id="chalk"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -0.8 1.25"/><feComposite in="SourceGraphic" operator="in"/></filter></defs>`;
  const titles = ["本日のおすすめ", "MENU", "お品書き", "Today's"];
  const items = ["ハイボール", "生ビール", "レモンサワー", "焼酎ロック", "日本酒 一合", "梅酒", "ウーロンハイ", "おでん盛り", "枝豆", "冷奴", "ポテトサラダ", "チャージ", "ジントニック", "ラムコーク"];
  const chalk = ["#f4f1e6", "#ffd9e4", "#d9f2ff", "#fff3b0", "#c9f5c9"];
  for (let i = 0; i < 4; i++) {
    const x = i * W;
    svg += `<rect x="${x}" y="0" width="${W}" height="${H}" fill="#1d2420"/>`;
    // smudges of old chalk
    for (let k = 0; k < 14; k++) svg += `<ellipse cx="${x + rnd() * W}" cy="${rnd() * H}" rx="${40 + rnd() * 90}" ry="${10 + rnd() * 30}" fill="#fff" opacity="${0.02 + rnd() * 0.04}"/>`;
    svg += `<g filter="url(#chalk)">`;
    svg += `<text x="${x + W / 2}" y="92" font-family="${MARU}" font-size="56" font-weight="700" fill="${pick(chalk)}" text-anchor="middle" transform="rotate(${(rnd() - 0.5) * 4} ${x + W / 2} 80)">${esc(titles[i])}</text>`;
    svg += `<line x1="${x + 60}" y1="118" x2="${x + W - 60}" y2="${114 + rnd() * 8}" stroke="${pick(chalk)}" stroke-width="4"/>`;
    const order = [...items].sort(() => rnd() - 0.5);
    for (let r = 0; r < 7; r++) {
      const y = 182 + r * 62, it = order[r], price = pick([380, 450, 500, 550, 600, 700, 800]);
      svg += `<text x="${x + 46}" y="${y}" font-family="${MARU}" font-size="36" fill="${pick(chalk)}" transform="rotate(${(rnd() - 0.5) * 3} ${x + 46} ${y})">${esc(it)}</text>`;
      svg += `<text x="${x + W - 40}" y="${y}" font-family="${MARU}" font-size="34" fill="${pick(chalk)}" text-anchor="end">¥${price}</text>`;
    }
    // a doodle: a little beer glass
    svg += `<rect x="${x + W - 120}" y="${H - 110}" width="50" height="70" rx="6" fill="none" stroke="#fff3b0" stroke-width="4"/><path d="M${x + W - 70} ${H - 95} q 22 0 22 20 q 0 20 -22 20" fill="none" stroke="#fff3b0" stroke-width="4"/><ellipse cx="${x + W - 95}" cy="${H - 112}" rx="30" ry="10" fill="#f4f1e6"/>`;
    svg += `</g>`;
  }
  await png(svg + "</svg>", "menus.png");
}

/** Drink labels: 16 cells of 128 x 256, wrapped round cans and bottles (u round, v up). */
async function cans() {
  const W = 128, H = 256;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${16 * W}" height="${H}">`;
  const words = ["お茶", "緑茶", "麦茶", "COFFEE", "微糖", "SODA", "みかん", "コーラ", "水", "WATER", "乳酸", "ほうじ茶", "BLACK", "ジンジャー", "LEMON", "スポーツ"];
  for (let i = 0; i < 16; i++) {
    const x = i * W, hue = Math.floor(rnd() * 360), dark = rnd() < 0.3;
    const bg = dark ? `hsl(${hue},30%,15%)` : `hsl(${hue},${50 + rnd() * 40}%,${40 + rnd() * 25}%)`;
    svg += `<rect x="${x}" y="0" width="${W}" height="${H}" fill="${bg}"/>`;
    svg += `<rect x="${x}" y="${H * 0.3}" width="${W}" height="${H * 0.4}" fill="${dark ? "#c9a46a" : "#fff"}" opacity="0.9"/>`;
    const w = words[i];
    svg += `<text x="${x + W / 2}" y="${H * 0.55}" font-family="${w.match(/[A-Z]/) ? HEAVY : MINCHO}" font-size="${Math.min(40, 120 / w.length)}" font-weight="700" fill="${dark ? "#1a120c" : bg}" text-anchor="middle">${esc(w)}</text>`;
    // stripes and a drop of colour, as drinks' cans have
    svg += `<rect x="${x}" y="${H * 0.18}" width="${W}" height="6" fill="#fff" opacity="0.6"/><rect x="${x}" y="${H * 0.78}" width="${W}" height="10" fill="hsl(${(hue + 40) % 360},70%,50%)"/>`;
    svg += `<circle cx="${x + W * 0.7}" cy="${H * 0.88}" r="10" fill="#fff" opacity="0.5"/>`;
  }
  await png(svg + "</svg>", "cans.png");
}

/** The vending machine's lit header (1024 x 256), its price strip (1024 x 64: 8 slots), its side graphic
 *  (512 x 1024) and the recycling bin's label (512 x 256). */
async function vending() {
  await png(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1f6fd1"/><stop offset="1" stop-color="#3fb6f0"/></linearGradient></defs><rect width="1024" height="256" fill="url(#g)"/>` +
    `<text x="512" y="150" font-family="${HEAVY}" font-size="118" fill="#fff" text-anchor="middle">つめた〜い</text><text x="512" y="222" font-family="${GOTHIC}" font-size="44" fill="#e6f5ff" text-anchor="middle">COLD DRINKS · 冷たいお飲み物</text>` +
    `<circle cx="80" cy="128" r="46" fill="#fff" opacity="0.25"/><circle cx="950" cy="80" r="30" fill="#fff" opacity="0.2"/></svg>`, "vend-header.png");
  let p = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="64"><rect width="1024" height="64" fill="#15171a"/>`;
  for (let k = 0; k < 8; k++) p += `<text x="${k * 128 + 64}" y="44" font-family="${GOTHIC}" font-size="32" font-weight="700" fill="#ffd23a" text-anchor="middle">${pick([110, 130, 140, 160, 180, 200])}</text>`;
  await png(p + "</svg>", "vend-price.png");
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="1024"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a8de0"/><stop offset="1" stop-color="#0c3f8a"/></linearGradient></defs><rect width="512" height="1024" fill="url(#s)"/>`;
  for (let k = 0; k < 22; k++) s += `<circle cx="${rnd() * 512}" cy="${rnd() * 1024}" r="${6 + rnd() * 40}" fill="#fff" opacity="${0.06 + rnd() * 0.18}"/>`;
  s += `<path d="M0 760 Q 128 700 256 760 T 512 760 V 1024 H 0 Z" fill="#fff" opacity="0.18"/><text x="256" y="430" font-family="${HEAVY}" font-size="96" fill="#fff" text-anchor="middle" opacity="0.92">冷たい</text><text x="256" y="540" font-family="${HEAVY}" font-size="96" fill="#fff" text-anchor="middle" opacity="0.92">ひと休み</text></svg>`;
  await png(s, "vend-side.png");
  await png(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="256"><rect width="512" height="256" fill="#f4f4f0"/><rect x="0" y="0" width="512" height="70" fill="#2a7a3a"/><text x="256" y="50" font-family="${HEAVY}" font-size="40" fill="#fff" text-anchor="middle">リサイクル</text><text x="256" y="150" font-family="${GOTHIC}" font-size="44" font-weight="700" fill="#222" text-anchor="middle">空き缶・ペットボトル</text><text x="256" y="215" font-family="${GOTHIC}" font-size="28" fill="#555" text-anchor="middle">ここに入れてください</text></svg>`, "bin-label.png");
}

await menus();
await cans();
await vending();
console.log(`-> ${dir}`);
