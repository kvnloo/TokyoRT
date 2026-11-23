// The streamed city's near levels, baked: every 128 m cell of a compiled area dressed by scene/hero/dress.ts at
// two levels — L1 (mid distance: windows, signs, roofs, poles, trees) and L0 (street level: everything) — and written
// as one binary per cell and level that scene/city.game.ts reads (`readAsset`) and adds as meshes in place.
//
//   node --max-old-space-size=16384 tools/tokyo/city-bake.ts [--area=shinjuku] [--only=i_j,...] [--levels=0,1]
//     -> assets/city/baked/<area>/L<level>/c_<i>_<j>.bin, assets/city/baked/<area>/index.json
//
// A cell file: "TKC1", u32 header bytes, the header (JSON: its meshes — material name, vertex and index counts — and
// its placements), padded to 4 bytes; then per mesh positions (3 x f32), normals (3 x f32), UVs (2 x f32), indices (u32).
// Derived from PLATEAU / OSM / GSI: ODbL, kept out of git like the tiles.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeTile } from "../city/shared/tileformat.js";
import { makeSurface } from "../city/shared/decks.js";
import { repoRoot } from "../lib/paths.ts";
import { dressDistrict, type HeroData, type Placement } from "../../scene/hero/dress.ts";
import { heroMaterials } from "../../scene/hero/materials.ts";

const arg = (k: string, d: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=")[1];
const area = arg("area", "shinjuku"), only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1].split(",");
const levels = arg("levels", "0,1").split(",").map(Number);
export const CELL = 128;
const MARGIN = 40;
const tilesDir = join(repoRoot, "assets/city/tiles", area);
const manifest = JSON.parse(readFileSync(join(tilesDir, "manifest.json"), "utf8"));
const t = manifest.terrain, tb = readFileSync(join(tilesDir, t.file));
const grid = { x0: t.x0, z0: t.z0, step: t.step, w: t.w, h: t.h, data: new Float32Array(tb.buffer, tb.byteOffset, tb.byteLength / 4) };
const surface = makeSurface(grid, manifest.decks ?? []);
const outDir = join(repoRoot, "assets/city/baked", area);

// ---------------------------------------------------------------- the area's buildings, props and wires
type B = HeroData["buildings"][number] & { cx: number; cz: number };
const buildings: B[] = [], props: HeroData["props"] = [], wires: number[][] = [];
let id = 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
for (const f of readdirSync(tilesDir).filter((f) => /^t_.*\.bin$/.test(f)).sort()) {
  const b = readFileSync(join(tilesDir, f));
  const tile = decodeTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  for (const bd of tile.buildings) {
    for (const p of bd.polygons) {
      if (!p[0]) continue;
      let cx = 0, cz = 0;
      for (let i = 0; i < p[0].length; i += 2) { cx += p[0][i]; cz += p[0][i + 1]; }
      cx /= p[0].length / 2; cz /= p[0].length / 2;
      buildings.push({ id: id++, usage: bd.usage, storeys: bd.storeys, flags: bd.flags, base: r2(bd.base), height: r2(bd.height), ring: Array.from(p[0], r2), holes: [], cx, cz });
    }
  }
  for (const p of tile.props) props.push({ kind: p.kind, variant: p.variant, rot: p.rot, x: p.x, z: p.z, scale: p.scale });
  for (let i = 0; i < tile.wires.length; i += 4) wires.push(Array.from(tile.wires.subarray(i, i + 4)));
}
// a coarse index for the neighbours of a cell
const near = new Map<string, B[]>();
for (const b of buildings) {
  const k = `${Math.floor(b.cx / CELL)}_${Math.floor(b.cz / CELL)}`;
  (near.get(k) ?? near.set(k, []).get(k)!).push(b);
}
const cells = [...near.keys()].map((k) => k.split("_").map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

// ---------------------------------------------------------------- materials (names are what the scene looks up)
const M = heroMaterials(true);

function cellData(i: number, j: number): HeroData {
  const x0 = i * CELL, z0 = j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  const bs: B[] = [];
  for (let a = i - 1; a <= i + 1; a++) for (let c = j - 1; c <= j + 1; c++) for (const b of near.get(`${a}_${c}`) ?? []) if (b.cx > x0 - MARGIN && b.cx < x1 + MARGIN && b.cz > z0 - MARGIN && b.cz < z1 + MARGIN) bs.push(b);
  const tx0 = Math.floor(x0 - MARGIN), tz0 = Math.floor(z0 - MARGIN), w = CELL + 2 * MARGIN + 1, h = w;
  const y: number[] = [];
  for (let q = 0; q < h; q++) for (let p = 0; p < w; p++) y.push(r2(surface(tx0 + p, tz0 + q, -2)));
  const inside = (x: number, z: number, m: number) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;
  return {
    box: [x0, z0, x1, z1], hero: [x0, z0, x1, z1],
    buildings: bs,
    areas: [],
    props: props.filter((p) => inside(p.x, p.z, 20)),
    wires: wires.filter((w) => inside(w[0], w[1], 20) || inside(w[2], w[3], 20)),
    terrain: { x0: tx0, z0: tz0, step: 1, w, h, y },
  };
}

function write(file: string, entries: ReturnType<ReturnType<typeof dressDistrict>["batches"]["entries"]>, placements: Placement[]) {
  const meshes = entries.map((e) => ({ material: e.material.name, v: e.positions.length / 3, i: e.index.length }));
  const head = Buffer.from(JSON.stringify({ meshes, placements: placements.map((p) => ("m" in p ? { m: p.m, at: p.at.map(r2), ry: +p.ry.toFixed(3), s: +p.s.toFixed(3) } : { p: p.p, v: p.v, at: p.at.map(r2), ry: +p.ry.toFixed(3) })) }));
  const pad = (4 - ((8 + head.length) % 4)) % 4;
  const parts: Buffer[] = [Buffer.from("TKC1"), Buffer.alloc(4), head, Buffer.alloc(pad)];
  parts[1].writeUInt32LE(head.length + pad);
  for (const e of entries) for (const a of [e.positions, e.normals, e.uvs, e.index]) parts.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  const buf = Buffer.concat(parts);
  writeFileSync(file, buf);
  return { bytes: buf.length, tris: entries.reduce((s, e) => s + e.index.length / 3, 0), placements: placements.length };
}

for (const L of levels) mkdirSync(join(outDir, `L${L}`), { recursive: true });
const indexFile = join(outDir, "index.json");
let index: { cell: number; cells: Record<string, Record<string, { tris: number; bytes: number; placements: number }>> } = { cell: CELL, cells: {} };
try { index = JSON.parse(readFileSync(indexFile, "utf8")); } catch { /* new */ }
const t0 = Date.now();
let n = 0, tris = [0, 0];
for (const [i, j] of cells) {
  const key = `${i}_${j}`;
  if (only && !only.includes(key)) continue;
  const data = cellData(i, j);
  for (const L of levels) {
    const record: Placement[] = [];
    const d = dressDistrict(data, M, true, 11, { cell: data.box, full: L === 0, record });
    const r = write(join(outDir, `L${L}`, `c_${key}.bin`), d.batches.entries(), record);
    (index.cells[key] ??= {})[`L${L}`] = r;
    tris[L] += r.tris;
  }
  if (++n % 25 === 0) console.log(`  ${n} cells, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
writeFileSync(indexFile, JSON.stringify(index));
console.log(`${area}: ${n} cells baked (L0 ${(tris[0] / 1e6).toFixed(1)} M, L1 ${(tris[1] / 1e6).toFixed(1)} M triangles) in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outDir}`);
