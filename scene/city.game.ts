// Tokyo, the whole compiled area, streamed by level of detail around a first-person flying camera (ROADMAP § 0 step 2):
//   - far: the compiled tiles (tools/tokyo/to-glb.ts --city), always resident: the ground of every tile, and per 128 m
//     quadrant its buildings, props and trees as objects of their own, hidden in place where a nearer level shows them;
//   - L1, mid distance (within R1): each 128 m cell dressed (windows, signs, roofs, poles, trees), baked by
//     tools/tokyo/city-bake.ts and read with `readAsset`;
//   - L0, street level (within R0): the same cells dressed in full (doors, shops, clutter, wires, props).
// A cell's level arrives as meshes added in place (hidden), a frame budget of triangles at a time, and shows whole when
// it is complete; the level it replaces goes then.
//
// Room id: "tokyo-night" | "tokyo-day" | "tokyo-dusk", with "-at=x,z" or "-at=x,y,z" (where to start; the first cells
// load with the scene) and "-tour" (the camera flies a set path: clips and benchmarks).
// Controls (pointer "look": click to capture, Esc to let go): mouse to look, W A S D to move, Space / E up, C / Q down,
// Shift faster, the wheel scales the speed.
import { DirectionalLight, GLTFModel, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, readAsset, PerspectiveCamera, PlaneGeometry, Scene, SurfaceMaterial, Texture, BufferGeometry, wetLayer, type Object3D } from "@threert/scene";
import { defineGame, type FrameContext } from "@threert/gameplay";
import { tokyoSky } from "./sky.ts";
import { heroMaterials } from "./hero/materials.ts";
import { propMaterials, aBoard, beerCases, bicycle, scooter, umbrellaStand, vendingMachine } from "./hero/props.ts";
import { MODELS } from "./hero/dress.ts";
import { SHOP_PAGES } from "./hero/shops.ts";
import { Batches, rng, type V3 } from "./hero/builder.ts";
import far from "../assets/city/glb/shinjuku-far/index.json";
import baked from "../assets/city/baked/shinjuku/index.json";

const AREA = "shinjuku";
const CELL = 128;
/** Level radii (m, from the camera to the cell's box) and the margin a level is kept beyond them. */
const R0 = 140, R1 = 480, KEEP = 50;
/** Triangles added in place per frame (the commit pays ~80 ns a triangle), and the frame script's time for it (ms). */
const FRAME_TRIS = 50_000, FRAME_MS = 5, FRAME_OBJECTS = 30;

type Cell = { i: number; j: number; level: number; roots: [Group, Group]; loading: Job | null };
type Job = { level: number; path: string; meshes: { material: string; v: number; i: number; at: number; emits: boolean }[]; placements: Placement[]; off: number; k: number; p: number; root: Group };
type Placement = { m: string; at: V3; ry: number; s: number } | { p: string; v: number; at: V3; ry: number };

const engine = { readAsset };

// ---------------------------------------------------------------- the world as the scene keeps it
let lib = new Map<string, MeshStandardMaterial>();
/** By night, what mid-distance cells (L1) draw for a material that emits: an unlit one that shows the same light and
 *  lights nothing (light sampling is for what is near: every emitter added or removed rebuilds the light list). */
const unlitOf = new Map<MeshStandardMaterial, MeshStandardMaterial>();
let night = true;
let PM: ReturnType<typeof propMaterials>;
const protos = new Map<string, Mesh[]>();
const cells = new Map<string, Cell>();
/** Far objects by tile and quadrant: buildings (with their lit windows and signs) and trees. */
const farQ = new Map<string, { b: GLTFModel | null; t: GLTFModel | null }>();
let scene: Scene;
const cam = { pos: [0, 0, 0] as V3, yaw: 0, pitch: 0, speed: 6 };

function ascii(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i++) if (b[i]) s += String.fromCharCode(b[i]);
  return s;
}

/** A cell's level: its header now, its meshes a few at a time (ranged reads: the rest of the file is not read yet). */
function startJob(c: Cell, level: number): Job | null {
  const path = `assets/city/baked/${AREA}/L${level}/c_${c.i}_${c.j}.bin`;
  let n: number;
  try {
    n = new DataView(engine.readAsset(path, 0, 8)).getUint32(4, true);
  } catch {
    return null;
  }
  const head = JSON.parse(ascii(new Uint8Array(engine.readAsset(path, 8, n))));
  // (each cell keeps a group per level, made with the scene: a group removed rebuilds the scene, its children do not)
  const root = c.roots[level];
  clear(root);
  // (each mesh's place in the file, then the order to add them: what emits last, all in one frame, since every commit
  // that adds emitters rebuilds the light list over all of them)
  let off = 8 + n;
  const meshes = (head.meshes as { material: string; v: number; i: number }[]).map((m) => { const at = off; off += m.v * 32 + m.i * 4; return { ...m, at, emits: emits(lib.get(m.material)) }; });
  meshes.sort((a, b) => Number(a.emits) - Number(b.emits));
  return { level, path, meshes, placements: head.placements, off: 8 + n, k: 0, p: 0, root };
}

/** Adds the job's next meshes and placements within the frame's budget (they show as they come: for a few frames the
 *  level they replace shows with them); true when the job is complete. */
function step(job: Job, budget: { tris: number; until: number; objects: number }): boolean {
  while (job.k < job.meshes.length && (budget.tris > 0 && Date.now() < budget.until || job.meshes[job.k].emits)) {
    const m = job.meshes[job.k];
    // (the emitting ones wait until the rest are in, then go together)
    if (m.emits && (job.k === 0 || !job.meshes[job.k - 1].emits) && job.p < job.placements.length) break;
    job.k++;
    const bytes = m.v * 32 + m.i * 4;
    const buf = engine.readAsset(job.path, m.at, bytes);
    const pos = new Float32Array(buf, 0, m.v * 3);
    const nor = new Float32Array(buf, m.v * 12, m.v * 3);
    const uv = new Float32Array(buf, m.v * 24, m.v * 2);
    const idx = new Uint32Array(buf, m.v * 32, m.i);
    let mat = lib.get(m.material);
    if (!mat) continue;
    if (job.level === 1 && night) mat = unlitOf.get(mat) ?? mat;
    const g = new BufferGeometry();
    g.positions = pos;
    g.normals = nor;
    g.uvs = uv;
    g.index = idx;
    job.root.add(new Mesh(g, mat));
    budget.tris -= m.i / 3;
  }
  let n = 0;
  while (job.p < job.placements.length && n < budget.objects && Date.now() < budget.until) {
    for (const o of place(job.placements[job.p++])) job.root.add(o);
    n++;
  }
  return job.k >= job.meshes.length && job.p >= job.placements.length;
}

const PROPS: Record<string, (b: Batches, pm: ReturnType<typeof propMaterials>, a: V3, f: V3, r: ReturnType<typeof rng>) => void> = {
  bike: bicycle, scooter, umbrellas: umbrellaStand, aboard: aBoard, vendingm: vendingMachine,
  beercases: (b, pm, a, f, r) => beerCases(b, pm, a, f, r, 3),
};

/** A placement as objects: a model (one object), or a prop's meshes (one a material; a new group cannot be added in
 *  place, meshes can), each turned and moved to the place. */
function place(p: Placement): Object3D[] {
  const c = Math.cos(p.ry), sn = Math.sin(p.ry);
  if ("m" in p) {
    const m = MODELS[p.m];
    if (!m) return [];
    const model = new GLTFModel(m.uri, m.node ? { nodes: [m.node] } : {});
    const [ox, oy, oz] = m.at ? [-m.at[0] * p.s, -m.at[1] * p.s, -m.at[2] * p.s] : [0, 0, 0];
    model.position.set(p.at[0] + ox * c + oz * sn, p.at[1] + oy, p.at[2] - ox * sn + oz * c);
    model.rotation.y = p.ry;
    model.scale.setScalar(p.s);
    return [model];
  }
  const fn = PROPS[p.p];
  if (!fn) return [];
  const k = `${p.p} ${p.v}`;
  let ms = protos.get(k);
  if (!ms) {
    const b = new Batches();
    fn(b, PM, [0, 0, 0], [0, 0, 1], rng(11 * 7919 + p.v * 104729 + p.p.length));
    ms = b.meshes(k);
    protos.set(k, ms);
  }
  return ms.map((m) => {
    const o = m.clone();
    o.position.set(...p.at);
    o.rotation.y = p.ry;
    return o;
  });
}

function emits(m?: MeshStandardMaterial) {
  return !!m && m.emissiveIntensity > 0 && m.emissive.r + m.emissive.g + m.emissive.b > 0;
}

const fmod = (a: number, b: number) => ((a % b) + b) % b;
/** The far tile and quadrant a cell lies in. */
const farKey = (i: number, j: number) => `${Math.floor(i / 2)}_${Math.floor(j / 2)}_${fmod(i, 2) + 2 * fmod(j, 2)}`;

function setFar(c: Cell) {
  const f = farQ.get(farKey(c.i, c.j));
  if (!f) return;
  // (moved out of sight rather than hidden: an object hidden when the scene is rebuilt is left out of it, and showing it
  // again would rebuild the scene once more)
  const y = c.level >= 0 ? -10000 : 0;
  if (f.b) f.b.position.y = y;
  if (f.t) f.t.position.y = y;
}

/** Shows a finished job's objects, removes the level it replaces. */
/** Objects to take out, a few hundred a frame (each removal costs the sync and the engine): a level retired. */
const retiring: Object3D[] = [];
function clear(g: Group) {
  for (const o of g.children) retiring.push(o);
}
function retire(n: number) {
  for (let k = 0; k < n && retiring.length; k++) {
    const o = retiring.pop()!;
    o.parent?.remove(o);
  }
}

function finish(c: Cell, job: Job) {
  if (c.level >= 0 && c.level !== job.level) clear(c.roots[c.level]);
  c.level = job.level;
  c.loading = null;
  setFar(c);
}

function unload(c: Cell) {
  clear(c.roots[0]);
  clear(c.roots[1]);
  c.loading = null;
  c.level = -1;
  setFar(c);
}

function boxDist(c: Cell, x: number, z: number) {
  const x0 = c.i * CELL, z0 = c.j * CELL;
  const dx = Math.max(x0 - x, 0, x - (x0 + CELL)), dz = Math.max(z0 - z, 0, z - (z0 + CELL));
  return Math.hypot(dx, dz);
}

/** The level a cell should show from here, with hysteresis against its current one. */
function want(c: Cell, x: number, y: number, z: number) {
  const d = Math.hypot(boxDist(c, x, z), Math.max(0, y - 60) * 0.7);
  const cur = c.loading?.level ?? c.level;
  if (d < R0 || (cur === 0 && d < R0 + KEEP)) return 0;
  if (d < R1 || (cur === 1 && d < R1 + KEEP)) return 1;
  return -1;
}

/** One frame of streaming: retire what is out of range, then load the nearest cell whose level is wrong. */
function stream(x: number, y: number, z: number, budget: { tris: number; until: number; objects: number }) {
  // the job in progress, if its cell still wants it
  for (const c of cells.values()) {
    if (!c.loading) continue;
    if (want(c, x, y, z) !== c.loading.level) {
      if (c.loading.level !== c.level) clear(c.loading.root);
      c.loading = null;
      continue;
    }
    if (step(c.loading, budget)) finish(c, c.loading);
    return;
  }
  // out of range: back to far
  for (const c of cells.values()) if (c.level >= 0 && want(c, x, y, z) < 0) unload(c);
  // the nearest cell that needs another level
  let best: Cell | null = null, bd = Infinity;
  for (const c of cells.values()) {
    const w = want(c, x, y, z);
    if (w < 0 || w === c.level) continue;
    const d = boxDist(c, x, z) + (w === 0 ? -50 : 0);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) {
    best.loading = startJob(best, want(best, x, y, z));
    if (!best.loading) best.level = want(best, x, y, z); // (no file: nothing to show at that level)
    else if (step(best.loading, budget)) finish(best, best.loading);
  }
}

// ---------------------------------------------------------------- the tour (clips, benchmarks)
const TOUR: [number, number, number, number, number][] = [
  // t (s), x, y, z, look yaw (degrees from +x toward +z)
  [0, 359.8, 32.3, -496.6, 22], [12, 376, 32.3, -489.8, 22], [18, 392, 40, -484, 10], [26, 430, 90, -520, -60],
  [40, 300, 140, -700, -120], [55, 0, 160, -400, 170], [70, -300, 120, -100, 160], [85, -650, 220, 120, 120],
];
function tourAt(t: number): { pos: V3; yaw: number } {
  const T = TOUR;
  let k = 0;
  while (k + 2 < T.length && T[k + 1][0] <= t) k++;
  const a = T[k], b = T[k + 1], u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
  const s = u * u * (3 - 2 * u);
  return { pos: [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s], yaw: (a[4] + (b[4] - a[4]) * s) * (Math.PI / 180) };
}

// ---------------------------------------------------------------- the scene
let tour = false;
export function sceneFor(room: string) {
  const time = room.split("-")[1] ?? "night";
  night = time === "night";
  tour = room.includes("-tour");
  const at = /-at=(-?[\d.]+),(-?[\d.]+)(?:,(-?[\d.]+))?/.exec(room);
  scene = new Scene();
  const sun = new DirectionalLight(0xfff4e8, 100000);
  if (time === "day") sun.setSunAngles(38, 247.5);
  else if (time === "dusk") sun.setSunAngles(3, 250);
  else sun.setSunAngles(-40, 0);
  scene.add(sun);
  scene.environment = tokyoSky(sun);
  if (night) scene.wetness = 1;
  const b = far.bounds;
  const land = new Mesh(new PlaneGeometry(200000, 200000), new MeshStandardMaterial({ color: 0x3b3a36, roughness: 0.95 }));
  land.rotation.x = -Math.PI / 2;
  land.position.set((b.minX + b.maxX) / 2, 15, (b.minZ + b.maxZ) / 2);
  scene.add(land);
  // the ground of every tile: its roads in scanned asphalt and pavers, wet by night
  const tex = (id: string, size: number) => { const t = new Texture(`assets/polyhaven/tex/${id}/${id}_diff_2k.jpg`); t.repeat = [1 / size, 1 / size]; return t; };
  const road = (id: string, size: number, puddles: number) => new SurfaceMaterial({ map: tex(id, size), normalMap: new Texture(`assets/polyhaven/tex/${id}/${id}_nor_gl_2k.jpg`, "linear"), roughnessMap: new Texture(`assets/polyhaven/tex/${id}/${id}_rough_2k.jpg`, "linear"), worldScale: size, wet: 1, puddles: night ? { scale: 2.5, amount: puddles } : undefined, grime: { amount: 0.3, scale: 3 } });
  const functions = { "road 0 ": road("asphalt_02", 3.5, 0.45).shader!, "road 1 ": road("concrete_pavers", 1.6, 0.2).shader!, "road 3 ": road("concrete_floor_worn_001", 2.5, 0.2).shader!, ...(night ? { paint: wetLayer({ puddles: 0.4 }) } : {}) };
  const tod = night ? "night" : "day";
  for (const t of far.tiles) {
    const uri = `assets/city/glb/${AREA}-far/${t.file}`;
    scene.add(new GLTFModel(uri, { nodes: ["ground"], functions }));
    const has = new Set((t as { nodes?: string[] }).nodes ?? []);
    for (let q = 0; q < 4; q++) {
      // (only the nodes the tile has: a model of none draws nothing and cannot be hidden in place)
      const bn = [`b${q}`, `b${q}-${tod}`, `p${q}`, `p${q}-${tod}`].filter((n) => has.has(n));
      const bm = bn.length ? new GLTFModel(uri, { nodes: bn }) : null;
      const tm = has.has(`t${q}`) ? new GLTFModel(uri, { nodes: [`t${q}`] }) : null;
      if (bm) scene.add(bm);
      if (tm) scene.add(tm);
      farQ.set(`${t.x}_${t.z}_${q}`, { b: bm, t: tm });
    }
  }
  // the library: every material and model the baked cells use, in the scene from the start (so cells add in place)
  const M = heroMaterials(night);
  PM = propMaterials(night);
  lib = new Map();
  const collect = (v: unknown, depth = 0) => {
    if (v instanceof MeshStandardMaterial) { if (!lib.has(v.name)) lib.set(v.name, v); return; }
    if (depth > 3 || !v || typeof v !== "object") return;
    for (const x of Array.isArray(v) ? v : Object.values(v as object)) collect(x, depth + 1);
  };
  collect(M);
  collect(PM);
  for (let p = 0; p < SHOP_PAGES; p++) collect(M.shop(p));
  if (night) {
    for (const m of [...lib.values()]) {
      if (!emits(m)) continue;
      const k = m.emissiveIntensity;
      const u = new MeshBasicMaterial({ name: `${m.name} ~unlit`, color: [m.emissive.r * k, m.emissive.g * k, m.emissive.b * k], map: m.emissiveMap ?? m.map ?? null });
      unlitOf.set(m, u);
      lib.set(u.name, u);
    }
  }
  const swatch = new BufferGeometry();
  swatch.positions = new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0, 0.01]);
  swatch.normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  swatch.uvs = new Float32Array(6);
  swatch.index = new Uint32Array([0, 1, 2]);
  let k = 0;
  for (const m of lib.values()) {
    const s = new Mesh(swatch, m);
    s.position.set(b.minX + (k++ % 50) * 0.1, -50, b.minZ);
    scene.add(s);
  }
  // every prop's variants built now (their builders make materials of their own: new textured materials later would
  // rebuild the scene), one of each placed out of sight
  const VARIANTS: Record<string, number> = { bike: 8, scooter: 4, umbrellas: 4, aboard: 4, vendingm: 6, beercases: 6 };
  for (const [kind, n] of Object.entries(VARIANTS)) for (let v = 0; v < n; v++) {
    for (const o of place({ p: kind, v, at: [b.minX + 10 + v * 3, -80, b.minZ + Object.keys(VARIANTS).indexOf(kind) * 3], ry: 0 })) scene.add(o);
  }
  for (const [key, m] of Object.entries(MODELS)) {
    const g = new GLTFModel(m.uri, m.node ? { nodes: [m.node] } : {});
    g.position.set(b.minX, -60 - Object.keys(MODELS).indexOf(key) * 5, b.minZ);
    scene.add(g);
  }
  // the cells of the baked area
  for (const key of Object.keys((baked as { cells: Record<string, unknown> }).cells)) {
    const [i, j] = key.split("_").map(Number);
    const roots: [Group, Group] = [new Group(), new Group()];
    roots.forEach((g, l) => { g.name = `cell ${i} ${j} L${l}`; scene.add(g); });
    cells.set(key, { i, j, level: -1, roots, loading: null });
  }
  // the camera: Golden Gai's middle alley by default
  // ("-at=x,z" at street level, "-at=x,y,z" anywhere)
  const [sx, sy, sz] = at ? (at[3] ? [Number(at[1]), Number(at[2]), Number(at[3])] : [Number(at[1]), 34, Number(at[2])]) : [359.8, 32.3, -496.6];
  cam.pos = [sx, sy, sz];
  cam.yaw = (22 * Math.PI) / 180;
  cam.pitch = 0;
  const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 30000);
  camera.name = "camera";
  aim(camera);
  camera.setManualExposure(night ? 3.2 : time === "dusk" ? 8.5 : 11.5);
  scene.add(camera);
  // the first cells round the start, whole, so the first frame shows them
  for (let n = 0; n < 100_000; n++) {
    const budget = { tris: Infinity, until: Infinity, objects: Infinity };
    let busy = false;
    for (const c of cells.values()) if (c.loading || (want(c, ...cam.pos) >= 0 && want(c, ...cam.pos) !== c.level)) busy = true;
    if (!busy) break;
    stream(cam.pos[0], cam.pos[1], cam.pos[2], budget);
  }
  console.log(`city: ${far.tiles.length} far tiles, ${cells.size} cells, ${lib.size} materials; started with ${[...cells.values()].filter((c) => c.level === 0).length} cells at L0, ${[...cells.values()].filter((c) => c.level === 1).length} at L1`);
  return { scene, camera, options: { name: `tokyo-city-${time}`, width: 1280, height: 720 } };
}

function aim(camera: PerspectiveCamera) {
  camera.position.set(...cam.pos);
  const c = Math.cos(cam.pitch);
  camera.lookAt(cam.pos[0] + Math.cos(cam.yaw) * c * 10, cam.pos[1] + Math.sin(cam.pitch) * 10, cam.pos[2] + Math.sin(cam.yaw) * c * 10);
}

export default defineGame<Record<string, never>>({
  state: {},
  handlers: {},
  keys: {},
  pointer: "look",
  setup(ctx) {
    return sceneFor(ctx.roomId || "tokyo-night");
  },
  frame(f: FrameContext<Record<string, never>>) {
    const dt = f.dt;
    if (tour) {
      const t = tourAt(f.time);
      cam.pos = t.pos;
      cam.yaw = t.yaw;
      cam.pitch = -0.05;
    } else if (dt > 0) {
      const inp = f.input;
      cam.yaw += inp.look.dx;
      cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - inp.look.dy));
      if (inp.wheel) cam.speed = Math.max(0.5, Math.min(400, cam.speed * Math.pow(1.4, inp.wheel)));
      const fast = inp.down("Shift") ? 8 : 1;
      const v = cam.speed * fast * dt;
      const fx = Math.cos(cam.yaw) * Math.cos(cam.pitch), fy = Math.sin(cam.pitch), fz = Math.sin(cam.yaw) * Math.cos(cam.pitch);
      const rx = -Math.sin(cam.yaw), rz = Math.cos(cam.yaw);
      const mv = inp.move;
      const up = (inp.down("Space") || inp.down("E") ? 1 : 0) - (inp.down("C") || inp.down("Q") ? 1 : 0);
      cam.pos = [cam.pos[0] + (fx * mv.y + rx * mv.x) * v, Math.max(18, cam.pos[1] + (fy * mv.y + up) * v), cam.pos[2] + (fz * mv.y + rz * mv.x) * v];
    }
    aim(f.camera);
    retire(250);
    stream(cam.pos[0], cam.pos[1], cam.pos[2], { tris: FRAME_TRIS, until: Date.now() + FRAME_MS, objects: FRAME_OBJECTS });
  },
});
