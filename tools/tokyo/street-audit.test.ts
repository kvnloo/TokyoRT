// The street audit on a synthetic street whose numbers are known: a 6 m minor road with a solid line along one side
// and a dashed centre line, a zebra crossing, a stop line, poles every 30 m, and symbols drawn to the standard.
//   node tools/tokyo/street-audit.test.ts
import assert from "node:assert/strict";
import { AREA, PROP, DECAL } from "../city/shared/tileformat.js";
import { audit, diffReports, parseRig, type Tile } from "./street-audit.ts";

const ring = (pts: number[][]) => Float32Array.from(pts.flat());
/** A quad along +x: from x0 to x1, centred on z, w wide. */
const along = (x0: number, x1: number, z: number, w: number, kind = AREA.MARK_WHITE) => ({ kind, polygons: [[ring([[x0, z - w / 2], [x1, z - w / 2], [x1, z + w / 2], [x0, z + w / 2]])]] });

const areas = [{ kind: AREA.CARRIAGEWAY, polygons: [[ring([[0, -3], [100, -3], [100, 3], [0, 3]])]] }];
for (let x = 0; x < 100; x += 2.5) areas.push(along(x, x + 2.5, 2.5, 0.15)); // a solid line 0.5 m in from one side
for (let x = 0; x < 100; x += 10) areas.push(along(x, x + 2.5, 0, 0.15), along(x + 2.5, x + 5, 0, 0.15)); // 5 m dashes, 5 m gaps
for (let k = 0; k < 5; k++) areas.push(along(200, 204, k * 0.9, 0.45)); // zebra bars 0.45 m, pitch 0.9 m, 4 m long
areas.push(along(300, 303, 0, 0.4)); // a stop line
const props = [0, 30, 60, 90].map((x) => ({ kind: PROP.POLE, variant: 0, rot: 0, x, z: 4 }));
props.push({ kind: PROP.DECAL, variant: DECAL.STOP, rot: 0, x: 303, z: 3 });
const wires = Float32Array.from([0, 4, 30, 4, 30, 4, 60, 4, 60, 4, 90, 4]);
const tiles: Tile[] = [{ areas, props, wires }];

// the rig's source, in the shape scene/hero/dress.ts and streetprops.ts have it
const dress = [
  "    const gy = groundY(p.x, p.z), h = 10;",
  "    B.cylinder(M.concretePole, [p.x, gy - 0.2, p.z], 0.19, 0.12, h + 0.2, 14, 1);",
  "    const lampAt = add(top, add(mul(arm, 0.2), [0, -3, 0]));",
  "    for (const [yy, off, r] of [[-1, 0, 0.01], [-4, 0, 0.01], [-4, 0.5, 0.01]] as const) {",
  "      B.wire(M.cable, add(add(A, sideA), [0, yy, 0]), add(add(Bp, sideB), [0, yy, 0]), span * 0.02 + 0.1, r, 16);",
].join("\n");
const streetprops = 'case PROP.POLE: return model("pole", () => [{ mat: "concrete", tris: tube(0.17, 0.12, 10, 0, 0, 0) },\n { mat: "lampHousing", tris: box(0.5, 0.09, 0.2, 1.0, 7, 0) }]);';
const rig = parseRig(dress, streetprops);
assert.deepEqual(rig, { poleHeight: 10, conductors: [-1, -4, -4], sag: [0.02, 0.1], nearLamp: 7, farPoleHeight: 10, farLamp: 7 });

// symbols drawn to the standard, as triangles in cell texels (256 x 512)
const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1];
const shapes = new Map<number, { tris: number[] }>([
  // 止まれ on a 0.8 x 7.68 m cell (0.015 m a texel along): three characters 2.4 m long, 0.8 m across
  [DECAL.STOP, { tris: [...rect(0, 0, 256, 160), ...rect(0, 176, 256, 336), ...rect(0, 352, 256, 512)] }],
  // "30" on a 1.28 x 5 m cell (0.005 m a texel across): digits 0.5 m wide, 0.2 m apart
  [DECAL.SPEED_30, { tris: [...rect(8, 0, 108, 512), ...rect(148, 0, 248, 512)] }],
  // the through arrow on a 2.56 x 5 m cell (0.01 m a texel): head 2.5 m long and 1 m wide, shaft 0.15 m
  [DECAL.THROUGH, { tris: [128, 0, 178, 256, 78, 256, ...rect(120, 256, 135, 512)] }],
]);
const cell = (v: number): [number, number] => (v === DECAL.STOP ? [0.8, 7.68] : v === DECAL.THROUGH ? [2.56, 5] : [1.28, 5]);

const report = audit({ tiles, edges: [{ highway: "residential", pts: [0, 0, 0, 100, 0, 0] }], signals: [], rig, shapes, cell });
const get = (id: string) => { const r = report.rows.find((x) => x.id === id); assert.ok(r, `row ${id}`); return r!; };
const near = (v: number | null, want: number, tol: number, what: string) => assert.ok(v != null && Math.abs(v - want) <= tol, `${what}: ${v}, expected ${want}`);

near(get("lane-width").value, 0.15, 1e-3, "line width");
near(get("dash").value, 5, 1e-3, "dash length");
assert.match(get("dash").measured, /5\.0 m \/ 5\.0 m/);
near(get("zebra-bars").value, 0.45, 1e-3, "zebra bar width");
assert.equal(get("zebra-bars").verdict, "ok");
near(get("zebra-width").value, 4, 1e-3, "crossing width");
near(get("stop-line").value, 0.4, 1e-3, "stop line width");
near(get("rosoku").value, 1, 1e-9, "minor roads with a side line");
assert.deepEqual(report.edgeLines.map((e) => [e.cls, e.width, e.anySide, e.bothSides]), [["minor", "5.5-7 m", 1, 0]]);
assert.equal(get("diamond").value, 0);
assert.match(get("diamond").measured, /1 of 1 crossings unsignalled \(>= 2 expected\)/);
assert.equal(get("diamond").verdict, "missing");
assert.equal(get("yabane").verdict, "missing");
near(get("stop-text").value, 3, 1e-6, "止まれ aspect");
assert.equal(get("stop-text").verdict, "ok");
near(get("stop-length").value, 7.68, 1e-6, "止まれ length");
near(get("speed-digit").value, 0.5, 1e-6, "digit width");
assert.match(get("speed-digit").measured, /0\.50 x 5\.00 m, 0\.20 m apart; "30" 1\.20 m wide/);
assert.equal(get("speed-digit").verdict, "ok");
near(get("arrow").value, 2.5, 0.04, "arrow head"); // (the tip's first texels hold no texel centre)
assert.match(get("arrow").measured, /4\.9\d m long, shaft 0\.15 m/);
near(get("pole-spacing").value, 30, 1e-3, "span");
// conductors at 9 and 6 m, the lowest sagging 0.02 x 30 + 0.1 = 0.7 m at mid-span
near(get("cable-band").value, 5.3, 1e-6, "lowest cable");
assert.equal(get("cable-band").verdict, "ok");
assert.equal(get("cable-count").value, 3);
assert.equal(get("pole-height").verdict, "ok");
// a box that leaves out the road and the crossing
const boxed = audit({ tiles, edges: [], signals: [], rig, shapes: null, cell, bbox: { minX: 250, minZ: -10, maxX: 400, maxZ: 10 } });
assert.equal(boxed.rows.find((r) => r.id === "zebra-width")!.verdict, "no data");
assert.equal(boxed.rows.find((r) => r.id === "glyphs")!.verdict, "no data");
console.log("street-audit: ok");

// the street furniture of 6h on the same street: four poles beside the residential road, no trees, the line on one side
const furn = (id: string) => { const r = report.furniture.find((x) => x.id === id); assert.ok(r, `furniture row ${id}`); return r!; };
assert.equal(furn("lamp-arms").values.poleLamps, 4);
assert.equal(furn("transformers").values.count, 0);
assert.equal(furn("street-trees").verdict, "none in the data");
assert.equal(furn("sign-posts").verdict, "none in the data");
near(furn("footway").values.line, 0.5, 1e-9, "sides with a white line");
near(furn("footway").values.kerb, 0, 1e-9, "sides with a kerb");

// before / after: two small reports written by hand
const r = (id: string, values: Record<string, number | null>, verdict: string, measured = "-") =>
  ({ id, item: id, standard: "-", source: "-", measured, value: Object.values(values)[0], values, unit: "m", verdict });
const before = { rows: [r("lane-width", { median: 0.2, pieces: 10 }, "over"), r("dash", { dash: 5, gap: 5 }, "within 標識令, not the urban standard"), r("stop-line", { median: 0.4 }, "ok")],
  furniture: [r("vending", { perKm: 3 }, "present"), r("sign-posts", { perKm: 0 }, "none in the data")] };
const after = { rows: [r("lane-width", { median: 0.15, pieces: 10 }, "ok", "0.15 m"), r("dash", { dash: 6, gap: 9 }, "ok"), r("stop-line", { median: 0.40000001 }, "ok")],
  furniture: [r("vending", { perKm: 3 }, "present"), r("sign-posts", { perKm: 2.5 }, "present")] };
const d = diffReports(before, after);
assert.match(d, /^\| lane-width \| median 0\.2 -> 0\.15 \| m \| 0\.15 m \| over -> ok \|$/m);
assert.match(d, /^\| dash \| dash 5 -> 6; gap 5 -> 9 \| m \| - \| within 標識令, not the urban standard -> ok \|$/m);
assert.match(d, /^\| sign-posts \| perKm 0 -> 2\.5 \|/m);
assert.doesNotMatch(d, /stop-line|vending/); // unchanged to four figures, or not at all
assert.match(d, /^3 of 5 rows changed, 3 now within standard$/m);
assert.equal(diffReports(after, after), "0 of 5 rows changed, 0 now within standard");
const gone = diffReports(before, { rows: after.rows.slice(0, 2), furniture: [] });
assert.match(gone, /\| stop-line \| \(row gone\) \|/);
assert.match(gone, /^5 of 5 rows changed, 2 now within standard, 2 no longer$/m); // stop-line, vending gone
console.log("street-audit diff: ok");
