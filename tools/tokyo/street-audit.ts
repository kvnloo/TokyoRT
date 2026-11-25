// The street level against the Japanese road-marking and overhead-line standards, measured (issue #28's table, the
// rows that can be read from data): a report to run before and after work on the ordinary street (ROADMAP 6h).
// It reads what the street is built from and changes nothing:
//   - the compiled tiles (tools/city): the paint quads (MARK_WHITE / MARK_YELLOW areas, from pipeline/markings.mjs),
//     the road symbols (DECAL props), the utility poles (POLE props) and their spans (wires, pipeline/landscape.mjs),
//     the carriageway polygons (to measure each road's width), and roads.json (road classes, signals);
//   - the symbols' painted shapes, traced from the decal atlas as the client traces them (tools/tokyo/decals.ts), laid
//     on the cell the mesher gives each symbol (tools/city/mesh/decals.js);
//   - the near pole rig (scene/hero/dress.ts) and the far pole model (scene/hero/streetprops.ts), read from their
//     source: conductor heights, sag, pole and lamp heights. If the rig's code changes shape, those rows say so.
// The standards are cited by name: 道路標識、区画線及び道路標示に関する命令 (標識令), 警察庁「交通規制基準」 (規制基準),
// 安全で快適な自転車利用環境創出ガイドライン (自転車GL), 有線電気通信設備令施行規則 第7条.
//   node tools/tokyo/street-audit.ts [--area=shinjuku] [--bbox=minX,minZ,maxX,maxZ] [--tiles=<dir>] [--json]
// (bbox in the area's own frame, metres east and south of its origin). Always exits 0: it is a report.
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "../lib/paths.ts";
import { AREA, PROP, DECAL, decodeTile } from "../city/shared/tileformat.js";
import { PolyIndex, forEachAlong } from "../city/pipeline/landscape.mjs";
import { decalMesh } from "../city/mesh/decals.js";

export type Box = { minX: number; minZ: number; maxX: number; maxZ: number };
export type Tile = { areas: { kind: number; polygons: ArrayLike<number>[][] }[]; props: { kind: number; variant: number; rot: number; x: number; z: number }[]; wires: ArrayLike<number> };
export type Edge = { highway: string; oneway?: number; bridge?: number; tunnel?: number; pts: number[] };
/** The near and far pole models, as their source builds them (null where the source no longer has that shape). */
export type Rig = { poleHeight: number | null; conductors: number[] | null; sag: [number, number] | null; nearLamp: number | null; farPoleHeight: number | null; farLamp: number | null };
export type Input = {
  tiles: Tile[]; edges: Edge[]; signals: [number, number][]; rig: Rig;
  /** each DECAL variant's painted triangles in cell texels (x across, y along, y = 0 the far end), or null */
  shapes: Map<number, { tris: number[] }> | null;
  /** a DECAL variant's cell on the road, [across, along] metres */
  cell: (variant: number) => [number, number];
  bbox?: Box | null;
};
export type Row = { id: string; item: string; standard: string; measured: string; value: number | null; verdict: string };
export type Report = { rows: Row[]; edgeLines: { cls: string; width: string; km: number; anySide: number; bothSides: number }[]; spacing: { bin: string; n: number }[]; decals: Record<string, number> };

const CELL_W = 256, CELL_H = 512; // the atlas cell in texels (tools/tokyo/decals.ts)
const MINOR = new Set(["residential", "unclassified", "living_street"]);
const MAJOR = new Set(["trunk", "primary", "secondary", "tertiary"]);
const WIDTHS: [number, number, string][] = [[0, 4, "< 4 m"], [4, 5.5, "4-5.5 m"], [5.5, 7, "5.5-7 m"], [7, 9, "7-9 m"], [9, 99, ">= 9 m"]];

const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
const pct = (a: number[], q: number) => { if (!a.length) return NaN; const s = [...a].sort((p, r) => p - r); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const inBox = (b: Box | null | undefined, x: number, z: number) => !b || (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);

/** A grid of points for neighbour queries. */
class Grid<T extends { x: number; z: number }> {
  cells = new Map<string, T[]>();
  cell: number;
  constructor(cell: number, items: T[]) { this.cell = cell; for (const it of items) { const k = this.key(it.x, it.z); if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k)!.push(it); } }
  key(x: number, z: number) { return Math.floor(x / this.cell) + "," + Math.floor(z / this.cell); }
  near(x: number, z: number, r: number): T[] {
    const out: T[] = [], c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++)
        for (const it of this.cells.get(i + "," + j) ?? []) if (Math.hypot(it.x - x, it.z - z) <= r) out.push(it);
    return out;
  }
}

// ---------------------------------------------------------------- the paint quads
type Quad = { x: number; z: number; ux: number; uz: number; len: number; wid: number; kind: number; ends: [string, string] };
export function paintQuads(tiles: Tile[], bbox?: Box | null): Quad[] {
  const out: Quad[] = [];
  for (const t of tiles) for (const a of t.areas) {
    if (a.kind !== AREA.MARK_WHITE && a.kind !== AREA.MARK_YELLOW) continue;
    for (const rings of a.polygons) {
      const r = rings[0];
      if (rings.length !== 1 || r.length !== 8) continue; // a quad: 4 points
      const p = [0, 1, 2, 3].map((i) => [r[i * 2], r[i * 2 + 1]]);
      const x = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, z = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4;
      if (!inBox(bbox, x, z)) continue;
      const s0 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), s1 = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
      const long = s0 >= s1 ? [p[0], p[1]] : [p[1], p[2]], len = Math.max(s0, s1), wid = Math.min(s0, s1);
      if (len < 1e-3) continue;
      const k = (q: number[]) => q[0].toFixed(2) + ":" + q[1].toFixed(2);
      const end = (q: number[], w: number[]) => [k(q), k(w)].sort().join("|");
      const ends: [string, string] = s0 >= s1 ? [end(p[1], p[2]), end(p[3], p[0])] : [end(p[0], p[1]), end(p[2], p[3])];
      out.push({ x, z, ux: (long[1][0] - long[0][0]) / len, uz: (long[1][1] - long[0][1]) / len, len, wid, kind: a.kind, ends });
    }
  }
  return out;
}
const isLine = (q: Quad) => q.wid >= 0.08 && q.wid <= 0.25 && q.len >= 0.5;
const isBar = (q: Quad) => q.wid >= 0.28 && q.wid <= 0.6;

/** Line pieces joined end to end (they share their end's two corners) into runs: [length, pieces, ends]. */
function chains(lines: Quad[]) {
  const byEnd = new Map<string, number[]>();
  lines.forEach((q, i) => q.ends.forEach((e) => { if (!byEnd.has(e)) byEnd.set(e, []); byEnd.get(e)!.push(i); }));
  const parent = lines.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const ids of byEnd.values()) for (const i of ids.slice(1)) parent[find(i)] = find(ids[0]);
  const runs = new Map<number, Quad[]>();
  lines.forEach((q, i) => { const r = find(i); if (!runs.has(r)) runs.set(r, []); runs.get(r)!.push(q); });
  return [...runs.values()].map((qs) => {
    const len = qs.reduce((s, q) => s + q.len, 0);
    // the run's free ends: end keys used once
    const count = new Map<string, number>();
    for (const q of qs) for (const e of q.ends) count.set(e, (count.get(e) ?? 0) + 1);
    const free = [...count].filter(([, n]) => n === 1).map(([e]) => { const [a, b] = e.split("|").map((s) => s.split(":").map(Number)); return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 }; });
    return { len, qs, free, ux: qs[0].ux, uz: qs[0].uz };
  });
}

// ---------------------------------------------------------------- the symbols' painted shapes
/** A symbol's triangles rasterised on its cell's texels (1 = paint). */
export function raster(tris: number[]): Uint8Array {
  const m = new Uint8Array(CELL_W * CELL_H);
  for (let i = 0; i + 5 < tris.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = tris.slice(i, i + 6);
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(CELL_H - 1, Math.ceil(Math.max(ay, by, cy))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(CELL_W - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
        const px = x + 0.5, py = y + 0.5;
        const u = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / det, v = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / det;
        if (u >= 0 && v >= 0 && u + v <= 1) m[y * CELL_W + x] = 1;
      }
  }
  return m;
}
/** Runs of indices where `on(i)` holds, gaps shorter than `merge` bridged: [start, end] inclusive. */
function segments(n: number, on: (i: number) => boolean, merge: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!on(i)) continue;
    const last = out.at(-1);
    if (last && i - last[1] <= merge) last[1] = i; else out.push([i, i]);
  }
  return out;
}
const rowOn = (m: Uint8Array, y: number, x0 = 0, x1 = CELL_W - 1) => { for (let x = x0; x <= x1; x++) if (m[y * CELL_W + x]) return true; return false; };
const colOn = (m: Uint8Array, x: number, y0 = 0, y1 = CELL_H - 1) => { for (let y = y0; y <= y1; y++) if (m[y * CELL_W + x]) return true; return false; };
function runLengths(m: Uint8Array, across: boolean): number[] {
  const out: number[] = [];
  const [n, k] = across ? [CELL_H, CELL_W] : [CELL_W, CELL_H];
  for (let a = 0; a < n; a++) {
    let run = 0;
    for (let b = 0; b <= k; b++) {
      const on = b < k && m[across ? a * CELL_W + b : b * CELL_W + a];
      if (on) run++; else if (run) { out.push(run); run = 0; }
    }
  }
  return out;
}

/** 止まれ: each character's extent across and along the road, and its strokes' widths, metres. */
export function stopGlyphs(m: Uint8Array, [w, len]: [number, number]) {
  const sx = w / CELL_W, sy = len / CELL_H;
  const rows = segments(CELL_H, (y) => rowOn(m, y), 6).filter(([a, b]) => b - a > 10);
  const chars = rows.map(([y0, y1]) => {
    const cols = segments(CELL_W, (x) => colOn(m, x, y0, y1), CELL_W);
    return { across: (cols.at(-1)![1] - cols[0][0] + 1) * sx, along: (y1 - y0 + 1) * sy };
  });
  const painted = rows.length ? (rows.at(-1)![1] - rows[0][0] + 1) * sy : 0;
  return { chars, painted, strokeAcross: median(runLengths(m, true)) * sx, strokeAlong: median(runLengths(m, false)) * sy };
}
/** Speed numerals: each digit's width and length, the gap between them and the whole number's width, metres. */
export function speedGlyphs(m: Uint8Array, [w, len]: [number, number]) {
  const sx = w / CELL_W, sy = len / CELL_H;
  let cols = segments(CELL_W, (x) => colOn(m, x), 3).filter(([a, b]) => b - a > 4);
  if (cols.length === 1) {
    // the digits touch (the font set them wider than their boxes): split at the thinnest column near the middle
    const [a, b] = cols[0], mid = (a + b) / 2, count = (x: number) => { let n = 0; for (let y = 0; y < CELL_H; y++) n += m[y * CELL_W + x]; return n; };
    let at = -1, least = Infinity;
    for (let x = Math.round(mid - (b - a) * 0.08); x <= Math.round(mid + (b - a) * 0.08); x++) { const n = count(x); if (n < least) { least = n; at = x; } }
    if (at > a && at < b) cols = [[a, at], [at + 1, b]];
  }
  const digits = cols.map(([x0, x1]) => { const r = segments(CELL_H, (y) => rowOn(m, y, x0, x1), CELL_H); return { across: (x1 - x0 + 1) * sx, along: r.length ? (r[0][1] - r[0][0] + 1) * sy : 0 }; });
  const gap = cols.length > 1 ? Math.max(0, cols[1][0] - cols[0][1] - 1) * sx : NaN;
  return { digits, gap, total: cols.length ? (cols.at(-1)![1] - cols[0][0] + 1) * sx : 0 };
}
/** The through arrow: painted length, shaft width, head length and width, metres. */
export function arrowGlyph(m: Uint8Array, [w, len]: [number, number]) {
  const sx = w / CELL_W, sy = len / CELL_H;
  const widths: number[] = [];
  for (let y = 0; y < CELL_H; y++) { let n = 0; for (let x = 0; x < CELL_W; x++) n += m[y * CELL_W + x]; widths.push(n * sx); }
  const painted = widths.map((v, y) => (v > 0 ? y : -1)).filter((y) => y >= 0);
  if (!painted.length) return { length: 0, shaft: NaN, head: NaN, headWidth: NaN };
  const y0 = painted[0], y1 = painted.at(-1)!;
  const shaft = median(widths.slice(Math.round((y0 + y1) / 2), y1 + 1).filter((v) => v > 0));
  // the head: from the tip down to the last row wider than the shaft by half again (the head's base)
  let base = y0;
  for (let y = y0; y <= y1; y++) if (widths[y] > shaft * 1.5) base = y;
  const head = (base - y0 + 1) * sy;
  return { length: (y1 - y0 + 1) * sy, shaft, head, headWidth: Math.max(...widths) };
}

// ---------------------------------------------------------------- the pole rig, from its source
export function parseRig(dress: string, streetprops: string): Rig {
  const num = (re: RegExp, s: string, g = 1) => { const m = re.exec(s); return m ? Number(m[g]) : null; };
  let conductors: number[] | null = null;
  const c = /for \(const \[yy, off, r\] of (\[\[[^\n]*?\]\]) as const\)/.exec(dress);
  if (c) try { conductors = (JSON.parse(c[1]) as number[][]).map((t) => t[0]); } catch { conductors = null; }
  const sag = /B\.wire\(M\.cable, add\(add\(A, sideA\)[^\n]*?span \* ([\d.]+) \+ ([\d.]+)/.exec(dress);
  const pole = /case PROP\.POLE:[\s\S]*?tube\([\d.]+, [\d.]+, ([\d.]+), 0, 0, 0\)/.exec(streetprops);
  const lamp = /case PROP\.POLE:[\s\S]*?mat: "lampHousing", tris: box\([^,]+, [^,]+, [^,]+, [^,]+, ([\d.]+)/.exec(streetprops);
  const h = num(/h = ([\d.]+);\s*\n\s*B\.cylinder\(M\.concretePole/, dress);
  const lampDrop = num(/lampAt = add\(top, add\(mul\(arm, [\d.]+\), \[0, (-?[\d.]+), 0\]\)\)/, dress);
  return {
    poleHeight: h, conductors, sag: sag ? [Number(sag[1]), Number(sag[2])] : null,
    nearLamp: h != null && lampDrop != null ? h + lampDrop : null,
    farPoleHeight: pole ? Number(pole[1]) : null, farLamp: lamp ? Number(lamp[1]) : null,
  };
}

// ---------------------------------------------------------------- the audit
export function audit(input: Input): Report {
  const { tiles, edges, signals, rig, shapes, cell, bbox } = input;
  const rows: Row[] = [];
  const row = (id: string, item: string, standard: string, measured: string, value: number | null, verdict: string) => rows.push({ id, item, standard, measured, value, verdict });
  const within = (v: number, lo: number, hi: number, tol = 0.005) => (!Number.isFinite(v) ? "no data" : v < lo - tol ? "under" : v > hi + tol ? "over" : "ok");

  // paint
  const quads = paintQuads(tiles, bbox);
  const lines = quads.filter(isLine), bars = quads.filter(isBar);
  const barGrid = new Grid(4, bars);
  const parallel = (a: Quad, b: Quad, cos = 0.98) => Math.abs(a.ux * b.ux + a.uz * b.uz) > cos;
  // zebra bars: 2.5-5 m long, with a parallel bar of the same length beside them at under 1.4 m
  const pitchOf = new Map<Quad, number>();
  for (const q of bars) {
    if (q.len < 2.5 || q.len > 5) continue;
    let best = Infinity;
    for (const o of barGrid.near(q.x, q.z, 1.4)) {
      if (o === q || !parallel(q, o) || Math.abs(o.len - q.len) > 0.3) continue;
      const along = Math.abs((o.x - q.x) * q.ux + (o.z - q.z) * q.uz);
      if (along < 0.3) best = Math.min(best, Math.hypot(o.x - q.x, o.z - q.z));
    }
    if (best < Infinity) pitchOf.set(q, best);
  }
  const zebra = [...pitchOf.keys()], stopLines = bars.filter((q) => !pitchOf.has(q) && q.len >= 1);
  // crossings: zebra bars grouped by neighbours
  const zGrid = new Grid(4, zebra), seen = new Set<Quad>(), crossings: { x: number; z: number; n: number }[] = [];
  for (const q of zebra) {
    if (seen.has(q)) continue;
    const group = [q]; seen.add(q);
    for (let i = 0; i < group.length; i++) for (const o of zGrid.near(group[i].x, group[i].z, 1.4)) if (!seen.has(o) && pitchOf.has(o)) { seen.add(o); group.push(o); }
    if (group.length >= 3) crossings.push({ x: group.reduce((s, g) => s + g.x, 0) / group.length, z: group.reduce((s, g) => s + g.z, 0) / group.length, n: group.length });
  }
  const sigGrid = new Grid(16, signals.map(([x, z]) => ({ x, z })));
  const unsignalled = crossings.filter((c) => !sigGrid.near(c.x, c.z, 30).length).length;

  const lw = median(lines.map((q) => q.wid));
  row("lane-width", "Lane line width (102)", "0.10-0.15 m (標識令 別表第四; 規制基準 p.94 市街地)", `${f(lw)} m median of ${lines.length} line pieces`, lw, within(lw, 0.1, 0.15));
  const runs = chains(lines), dashes = runs.filter((r) => r.len <= 8);
  const dashGrid = new Grid(8, dashes.flatMap((r) => r.free.map((p) => ({ ...p, r }))));
  const gaps: number[] = [];
  for (const r of dashes) {
    let best = Infinity;
    for (const p of r.free) for (const o of dashGrid.near(p.x, p.z, 15)) {
      if (o.r === r || Math.abs(o.r.ux * r.ux + o.r.uz * r.uz) < 0.97) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z), lat = Math.abs((o.x - p.x) * -r.uz + (o.z - p.z) * r.ux);
      if (d > 1 && lat < 0.15) best = Math.min(best, d);
    }
    if (best < Infinity) gaps.push(best);
  }
  const dl = median(dashes.map((r) => r.len)), dg = median(gaps);
  row("dash", "Lane line dash / gap", "6 m line, 9 m gap urban (規制基準 p.94); 標識令 allows l1 3-10 m, l2 (1-2) l1", `${f(dl, 1)} m / ${f(dg, 1)} m (median of ${dashes.length} dashes)`, dl,
    !Number.isFinite(dl) ? "no data" : Math.abs(dl - 6) < 0.5 && Math.abs(dg - 9) < 0.5 ? "ok" : dl >= 3 && dl <= 10 && dg >= dl * 0.95 && dg <= dl * 2.05 ? "within 標識令, not the urban standard" : "outside 標識令");

  // stop lines, with 止まれ's (within 8 m of a STOP symbol) apart
  const decals = tiles.flatMap((t) => t.props.filter((p) => p.kind === PROP.DECAL && inBox(bbox, p.x, p.z)));
  const stopText = new Grid(8, decals.filter((p) => p.variant === DECAL.STOP));
  const sw = median(stopLines.map((q) => q.wid)), swStop = median(stopLines.filter((q) => stopText.near(q.x, q.z, 8).length).map((q) => q.wid));
  row("stop-line", "Stop line width (203)", "0.30-0.45 m (標識令 別表第六)", `${f(sw)} m median of ${stopLines.length}; at 止まれ ${f(swStop)} m`, sw, within(sw, 0.3, 0.45));
  const zw = median(zebra.map((q) => q.wid)), zg = median(zebra.map((q) => pitchOf.get(q)! - q.wid)), zl = median(zebra.map((q) => q.len));
  row("zebra-bars", "Zebra bar width / gap (201)", "bar 0.45-0.50 m, gap 0.45-0.90 m (標識令 別表第六)", `${f(zw)} m / ${f(zg)} m (${zebra.length} bars, ${crossings.length} crossings)`, zw, within(zw, 0.45, 0.5) === "ok" && within(zg, 0.45, 0.9) === "ok" ? "ok" : "off");
  row("zebra-width", "Zebra crossing width (bar length)", ">= 4 m in principle, 3 m minimum (規制基準 p.77)", `${f(zl)} m`, zl, !Number.isFinite(zl) ? "no data" : zl >= 3.995 ? "ok" : zl >= 2.995 ? "short of 4 m" : "under 3 m");

  // edge line / 路側帯 line by road class and measured width
  const carriageway = new PolyIndex(24);
  for (const t of tiles) for (const a of t.areas) if (a.kind === AREA.CARRIAGEWAY) for (const rings of a.polygons) {
    carriageway.add(rings.map((r) => { const pts: [number, number][] = []; for (let i = 0; i + 1 < r.length; i += 2) pts.push([r[i], r[i + 1]]); return pts; }));
  }
  const lineGrid = new Grid(8, lines);
  const reach = (x: number, z: number, nx: number, nz: number, s: number) => { for (let d = 0.25; d <= 18; d += 0.25) if (!carriageway.has(x + nx * d * s, z + nz * d * s)) return d; return null; };
  const tally = new Map<string, { n: number; any: number; both: number }>();
  for (const e of edges) {
    const hw = e.highway;
    const cls = MINOR.has(hw) ? "minor" : MAJOR.has(hw) ? "major" : null;
    if (!cls || e.bridge || e.tunnel) continue;
    const pts: [number, number][] = [];
    for (let i = 0; i + 2 < e.pts.length; i += 3) pts.push([e.pts[i], e.pts[i + 2]]);
    forEachAlong(pts, 10, (x: number, z: number, dx: number, dz: number) => {
      if (!inBox(bbox, x, z) || !carriageway.has(x, z)) return;
      const nx = -dz, nz = dx, R = reach(x, z, nx, nz, 1), L = reach(x, z, nx, nz, -1);
      if (R == null || L == null) return;
      const w = R + L, cx = x + nx * (R - L) / 2, cz = z + nz * (R - L) / 2;
      if (w < 2.5) return;
      const sides = new Set<number>();
      for (const q of lineGrid.near(cx, cz, 7)) {
        if (Math.abs(q.ux * dx + q.uz * dz) < 0.96) continue;
        const t = (q.x - cx) * dx + (q.z - cz) * dz, o = (q.x - cx) * nx + (q.z - cz) * nz;
        if (Math.abs(t) <= 5.5 && Math.abs(o) >= Math.max(0.6, w / 2 - 2) && Math.abs(o) <= w / 2 + 0.3) sides.add(Math.sign(o));
      }
      const bucket = WIDTHS.find(([a, b]) => w >= a && w < b)![2], key = cls + "|" + bucket;
      const s = tally.get(key) ?? { n: 0, any: 0, both: 0 };
      s.n++; if (sides.size) s.any++; if (sides.size === 2) s.both++;
      tally.set(key, s);
    });
  }
  const edgeLines = [...tally].map(([k, s]) => { const [cls, width] = k.split("|"); return { cls, width, km: s.n * 10 / 1000, anySide: s.any / s.n, bothSides: s.both / s.n }; })
    .sort((a, b) => a.cls.localeCompare(b.cls) || WIDTHS.findIndex((w) => w[2] === a.width) - WIDTHS.findIndex((w) => w[2] === b.width));
  const minor = [...tally].filter(([k]) => k.startsWith("minor|")).reduce((s, [, v]) => ({ n: s.n + v.n, any: s.any + v.any }), { n: 0, any: 0 });
  const minorShare = minor.n ? minor.any / minor.n : NaN;
  row("rosoku", "路側帯 / edge line on minor roads (108 / 103)", "solid white 0.15-0.20 m, strip >= 0.5 m (標識令 別表第六; 規制基準 p.73)", `${f(minorShare * 100, 1)}% of ${f(minor.n * 10 / 1000, 1)} km sampled carry one`, minorShare,
    !Number.isFinite(minorShare) ? "no data" : minorShare < 0.05 ? "missing" : minorShare < 0.5 ? "partial" : "present");

  // symbols
  const names = Object.fromEntries(Object.entries(DECAL as Record<string, number>).map(([k, v]) => [v, k]));
  const decalCount: Record<string, number> = {};
  for (const p of decals) { const n = names[p.variant] ?? `variant ${p.variant}`; decalCount[n] = (decalCount[n] ?? 0) + 1; }
  const variantsLike = (re: RegExp) => Object.entries(DECAL as Record<string, number>).filter(([k]) => re.test(k)).map(([, v]) => v);
  const diamond = variantsLike(/DIAMOND|CROSSING_AHEAD|DIA/), yabane = variantsLike(/YABANE|CHEVRON|CYCLE|BIKE/);
  const nDiamond = decals.filter((p) => diamond.includes(p.variant)).length, nYabane = decals.filter((p) => yabane.includes(p.variant)).length;
  row("diamond", "◇ crossing-ahead marks (210)", "1.5 m wide; about 30 m before an unsignalled crossing, 1-2 more at 10-20 m (規制基準 p.79)",
    `${nDiamond}${diamond.length ? "" : " (no DECAL variant)"}; ${unsignalled} of ${crossings.length} crossings unsignalled (>= ${unsignalled * 2} expected)`, nDiamond, nDiamond >= unsignalled * 2 && unsignalled > 0 ? "ok" : nDiamond ? "partial" : "missing");
  row("yabane", "Cycle 矢羽根 marks", "0.75 m wide, >= 1.5 m long, every 10 m (自転車GL p.II-6-7)", `${nYabane}${yabane.length ? "" : " (no DECAL variant)"}`, nYabane, nYabane ? "present" : "missing");

  if (shapes) {
    const stop = shapes.get(DECAL.STOP), speed = shapes.get(DECAL.SPEED_30), arrow = shapes.get(DECAL.THROUGH);
    if (stop) {
      const g = stopGlyphs(raster(stop.tris), cell(DECAL.STOP)), across = median(g.chars.map((c) => c.across)), along = median(g.chars.map((c) => c.along));
      row("stop-text", "止まれ character (法定外表示)", "2.4 m along x 0.8 m across, 3:1 (規制基準 p.149 図例(1))", `${f(along)} m along x ${f(across)} m across, ${f(along / across)}:1 (${g.chars.length} characters)`, along / across,
        Math.abs(along / across - 3) < 0.3 ? "ok" : "aspect off");
      row("stop-strokes", "止まれ strokes", "0.15 m across, 0.30 m along (規制基準 p.149)", `about ${f(g.strokeAcross)} m across, ${f(g.strokeAlong)} m along (median runs)`, g.strokeAcross, Math.abs(g.strokeAcross - 0.15) < 0.04 && Math.abs(g.strokeAlong - 0.3) < 0.06 ? "ok" : "off");
      row("stop-length", "止まれ painted length", ">= 7.2 m (3 x 2.4 m)", `${f(g.painted)} m`, g.painted, g.painted >= 7.195 ? "ok" : "short");
    }
    if (speed) {
      const g = speedGlyphs(raster(speed.tris), cell(DECAL.SPEED_30)), d = g.digits[0];
      row("speed-digit", "Speed numeral digit (105)", "0.5 m wide x 5 m long, 0.2 m apart; \"30\" 1.2 m wide (標識令 別表第六)",
        d ? `${f(d.across)} x ${f(d.along)} m, ${f(g.gap)} m apart; "30" ${f(g.total)} m wide (${f(d.across / 0.5)}x)` : "no digits found", d ? d.across : null, d && Math.abs(d.across - 0.5) < 0.08 && Math.abs(d.along - 5) < 0.3 ? "ok" : "off");
    }
    if (arrow) {
      const g = arrowGlyph(raster(arrow.tris), cell(DECAL.THROUGH));
      row("arrow", "Through arrow (204 / 110)", "5 m long, shaft 0.15 m, head 2.5 m long (標識令 別表第六)", `${f(g.length)} m long, shaft ${f(g.shaft)} m, head ${f(g.head)} m long x ${f(g.headWidth)} m wide`, g.head,
        Math.abs(g.head - 2.5) < 0.2 && Math.abs(g.length - 5) < 0.3 ? "ok" : "head short");
    }
  } else row("glyphs", "Symbol shapes", "-", "not read (the decal atlas could not be drawn: needs sharp and its fonts)", null, "no data");

  // poles and spans
  const poles = tiles.flatMap((t) => t.props.filter((p) => p.kind === PROP.POLE && inBox(bbox, p.x, p.z)));
  const poleGrid = new Grid(16, poles), nn: number[] = [];
  for (const p of poles) { let best = Infinity; for (const o of poleGrid.near(p.x, p.z, 80)) if (o !== p) best = Math.min(best, Math.hypot(o.x - p.x, o.z - p.z)); if (best < Infinity) nn.push(best); }
  const spans: number[] = [];
  for (const t of tiles) for (let i = 0; i + 3 < t.wires.length; i += 4) if (inBox(bbox, t.wires[i], t.wires[i + 1])) spans.push(Math.hypot(t.wires[i + 2] - t.wires[i], t.wires[i + 3] - t.wires[i + 1]));
  const ms = median(spans);
  row("pole-spacing", "Pole spacing (span length)", "about 30 m (ROADMAP 6h; no public standard found)", `spans p10 ${f(pct(spans, 0.1), 1)} / median ${f(ms, 1)} / p90 ${f(pct(spans, 0.9), 1)} m (${spans.length} spans, ${poles.length} poles; nearest pole median ${f(median(nn), 1)} m)`, ms,
    !Number.isFinite(ms) ? "no data" : Math.abs(ms - 30) <= 5 ? "ok" : "off");
  const spacing: { bin: string; n: number }[] = [];
  for (let b = 0; b < 60; b += 5) spacing.push({ bin: `${b}-${b + 5} m`, n: spans.filter((s) => s >= b && s < b + 5).length });

  if (rig.poleHeight != null && rig.conductors) {
    const at = rig.conductors.map((yy) => rig.poleHeight! + yy).sort((a, b) => b - a), sag = rig.sag ? rig.sag[0] * (Number.isFinite(ms) ? ms : 30) + rig.sag[1] : 0;
    const low = Math.min(...at) - sag;
    row("cable-band", "Cable heights (near rig)", "telecom >= 5 m over a road, >= 2.5 m over a separated footway (有線電気通信設備令施行規則 第7条1号)",
      `${[...new Set(at.map((h) => f(h, 2)))].join(" / ")} m at the pole; lowest ${f(low, 2)} m at mid-span (sag ${f(sag, 2)} m on ${f(Number.isFinite(ms) ? ms : 30, 1)} m)`, low, low > 7 ? "top band only" : low >= 5 ? "ok" : "below 5 m");
    row("cable-count", "Cables per span (near rig)", "\"a dozen\" (ROADMAP 6h; no standard)", `${rig.conductors.length}`, rig.conductors.length, rig.conductors.length >= 10 ? "ok" : "fewer");
  } else row("cable-band", "Cable heights (near rig)", "telecom >= 5 m over a road", "rig not found in scene/hero/dress.ts (the parser needs updating)", null, "no data");
  if (rig.poleHeight != null || rig.farPoleHeight != null)
    row("pole-height", "Pole height near / far, lamp near / far", "about 12 m shared poles (NTT East, secondary); near and far should agree",
      `${f(rig.poleHeight ?? NaN, 2)} / ${f(rig.farPoleHeight ?? NaN, 2)} m; lamp ${f(rig.nearLamp ?? NaN, 2)} / ${f(rig.farLamp ?? NaN, 2)} m`, rig.poleHeight,
      rig.poleHeight != null && rig.farPoleHeight != null && Math.abs(rig.poleHeight - rig.farPoleHeight) < 0.3 && rig.nearLamp != null && rig.farLamp != null && Math.abs(rig.nearLamp - rig.farLamp) < 0.3 ? "ok" : "near and far differ");
  return { rows, edgeLines, spacing, decals: decalCount };
}

export function formatReport(r: Report, title: string): string {
  const out = [`# Street audit: ${title}`, "", "| Item | Standard (source) | Measured | Verdict |", "|---|---|---|---|"];
  for (const x of r.rows) out.push(`| ${x.item} | ${x.standard} | ${x.measured} | ${x.verdict} |`);
  out.push("", "Edge or 路側帯 line beside the carriageway, by road class and measured width (samples every 10 m):", "", "| Class | Width | km | Line on a side | Both sides |", "|---|---|---|---|---|");
  for (const e of r.edgeLines) out.push(`| ${e.cls} | ${e.width} | ${f(e.km, 1)} | ${f(e.anySide * 100, 1)}% | ${f(e.bothSides * 100, 1)}% |`);
  out.push("", "Span lengths between poles:", "", "| Span | Count |", "|---|---|");
  for (const s of r.spacing) if (s.n) out.push(`| ${s.bin} | ${s.n} |`);
  out.push("", `Road symbols: ${Object.entries(r.decals).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  return out.join("\n");
}

// ---------------------------------------------------------------- command line
async function main() {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const area = arg("area") ?? "shinjuku", dir = resolve(arg("tiles") ?? join(repoRoot, "assets/city/tiles", area));
  const bb = arg("bbox")?.split(",").map(Number), bbox: Box | null = bb?.length === 4 ? { minX: bb[0], minZ: bb[1], maxX: bb[2], maxZ: bb[3] } : null;
  if (!existsSync(dir)) { console.log(`no compiled tiles at ${dir} (compile the area with tools/city first)`); return; }
  const tiles: Tile[] = readdirSync(dir).filter((n) => /^t_-?\d+_-?\d+\.bin$/.test(n)).map((n) => { const b = readFileSync(join(dir, n)); return decodeTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); });
  const roads = existsSync(join(dir, "roads.json")) ? JSON.parse(readFileSync(join(dir, "roads.json"), "utf8")) as { nodes: number[][]; edges: Edge[]; signals?: number[] } : { nodes: [], edges: [], signals: [] };
  const signals = (roads.signals ?? []).map((i): [number, number] => [roads.nodes[i][0], roads.nodes[i][2]]);
  const src = (p: string) => (existsSync(join(repoRoot, p)) ? readFileSync(join(repoRoot, p), "utf8") : "");
  const rig = parseRig(src("scene/hero/dress.ts"), src("scene/hero/streetprops.ts"));
  let shapes: Input["shapes"] = null;
  try { shapes = await (await import("./decals.ts")).decalShapes(); } catch { shapes = null; }
  // the symbol's cell as the mesher lays it: one symbol, heading +z, on flat ground
  const cell = (variant: number): [number, number] => {
    const m = decalMesh([{ kind: PROP.DECAL, variant, rot: 0, x: 0, z: 0, scale: 1 }], { height: () => 0, triangle: (a: number[], b: number[], c: number[], emit: (...v: number[][]) => void) => emit(a, b, c) });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < m.position.length; i += 3) { x0 = Math.min(x0, m.position[i]); x1 = Math.max(x1, m.position[i]); z0 = Math.min(z0, m.position[i + 2]); z1 = Math.max(z1, m.position[i + 2]); }
    return [x1 - x0, z1 - z0];
  };
  const report = audit({ tiles, edges: roads.edges, signals, rig, shapes, cell, bbox });
  if (process.argv.includes("--json")) console.log(JSON.stringify({ area, bbox, tiles: tiles.length, ...report }, null, 1));
  else console.log(formatReport(report, `${area}${bbox ? ` [${bb!.join(", ")}]` : ""}, ${tiles.length} tiles`));
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(import.meta.filename))
  main().catch((e) => console.log(`street audit failed: ${e instanceof Error ? e.message : e}`)).finally(() => { process.exitCode = 0; });
