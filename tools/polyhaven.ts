// Downloads CC0 Poly Haven PBR texture sets and models into assets/polyhaven/ (not committed; scenes reference them by
// repo-relative path). Adapted from ThreeRT tools/fetch-polyhaven.ts.
//   node tools/polyhaven.ts --res 2k; node tools/polyhaven.ts --res 1k --set tree   (the sets below)
// Textures: assets/polyhaven/tex/<id>/<id>_<map>_<res>.jpg   (diff, nor_gl, rough, ao, metal when available)
// Models:   assets/polyhaven/models/<id>_<res>.glb           (glTF + bin + textures packed into one GLB)
// Licence: CC0 (https://polyhaven.com/license); assets/polyhaven/manifest.json records every source URL.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { packGLB } from "@threert/scene";
import { repoRoot } from "./lib/paths.ts";

/** Curated lists. `default`: what the repo's own scenes, games, tests and benches reference (games/bistro-slice's
 *  plant, tools/foliage-scene.ts, tools/perf/voxel-level-spawn.game.ts, packages/scene/test/engine.test.ts).
 *  `street`: a starter kit for night street scenes (wet asphalt, pavers, tiled / clad facades, shutters + street
 *  clutter; the scene-authoring skill's set). */
/** What the city uses (scene/hero/materials.ts, props.ts, dress.ts; scene/city.game.ts's roads). The tree at 1k. */
export const SETS: Record<string, { textures: string[]; models: string[] }> = {
  city: {
    textures: [
      "asphalt_02", "black_painted_planks", "brick_wall_10", "brushed_concrete", "clean_asphalt", "concrete_floor_painted",
      "concrete_floor_worn_001", "concrete_pavers", "concrete_wall_004", "corrugated_iron_02", "dark_wooden_planks",
      "dirty_concrete", "exterior_wall_cladding", "exterior_wall_cladding_02", "japanese_cedar_planks", "long_white_tiles",
      "metal_grate_rusty", "painted_concrete_02", "painted_metal_shutter", "painted_plaster_wall", "plastered_wall_02",
      "rectangular_facade_tiles", "rusty_painted_metal", "white_plaster_02", "white_stucco", "white_stucco_02",
    ],
    models: [
      "cardboard_box_01", "exterior_aircon_unit", "folding_wooden_stool", "industrial_wall_lamp", "metal_trash_can",
      "planter_box_01", "plastic_crate_01", "plastic_crate_02", "plastic_crate_03", "potted_plant_01", "potted_plant_02",
      "potted_plant_04", "power_box_01", "propane_tank", "pull_chain_light_socket", "security_camera_01", "trashbag",
      "utility_box_01", "water_manhole_cover", "wooden_crate_01",
    ],
  },
  tree: { textures: [], models: ["island_tree_02"] },
};

const MAPS: Record<string, string> = { Diffuse: "diff", nor_gl: "nor_gl", Rough: "rough", AO: "ao", Metal: "metal" };
const UA = { "User-Agent": "threert-fetch-polyhaven" };
const out = join(repoRoot, "assets/polyhaven");

type FileInfo = Record<string, Record<string, Record<string, { url: string; size: number; include?: Record<string, { url: string }> }>>>;

async function json(url: string): Promise<FileInfo> {
  return JSON.parse(new TextDecoder().decode(await bytes(url))) as FileInfo;
}

async function bytes(url: string): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e}`);
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    }
  }
}

async function save(url: string, dst: string, manifest: Record<string, string>) {
  manifest[dst.slice(repoRoot.length + 1)] = url;
  if (existsSync(dst)) return;
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, await bytes(url));
}

async function fetchTexture(id: string, res: string, manifest: Record<string, string>): Promise<string[]> {
  const info = await json(`https://api.polyhaven.com/files/${id}`);
  const got: string[] = [];
  for (const [key, short] of Object.entries(MAPS)) {
    const r = info[key]?.[res] ?? info[key]?.["1k"];
    const f = r?.jpg ?? r?.png;
    if (!f) continue;
    await save(f.url, join(out, "tex", id, `${id}_${short}_${res}.${f.url.split(".").pop()}`), manifest);
    got.push(short);
  }
  return got;
}

/** glTF (+ external bin / images) -> single GLB with embedded images. */
function toGLB(gltf: Record<string, any>, files: Map<string, Uint8Array>): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const push = (b: Uint8Array) => {
    const off = size;
    chunks.push(b);
    size += b.length;
    const pad = (4 - (size % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      size += pad;
    }
    return off;
  };
  const bufferOffsets = (gltf.buffers ?? []).map((b: { uri: string }) => push(files.get(decodeURIComponent(b.uri))!));
  for (const v of gltf.bufferViews ?? []) {
    v.byteOffset = (v.byteOffset ?? 0) + bufferOffsets[v.buffer];
    v.buffer = 0;
  }
  for (const img of gltf.images ?? []) {
    if (!img.uri) continue;
    const data = files.get(decodeURIComponent(img.uri))!;
    const off = push(data);
    img.bufferView = gltf.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: data.length }) - 1;
    img.mimeType = /\.png$/i.test(img.uri) ? "image/png" : "image/jpeg";
    delete img.uri;
  }
  const bin = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.length;
  }
  gltf.buffers = [{ byteLength: size }];
  return packGLB(gltf, bin);
}

async function fetchModel(id: string, res: string, manifest: Record<string, string>): Promise<string> {
  const dst = join(out, "models", `${id}_${res}.glb`);
  const info = await json(`https://api.polyhaven.com/files/${id}`);
  const g = (info.gltf?.[res] ?? info.gltf?.["1k"])?.gltf;
  if (!g) throw new Error(`${id}: no glTF download`);
  manifest[dst.slice(repoRoot.length + 1)] = g.url;
  if (existsSync(dst)) return dst;
  const gltf = JSON.parse(new TextDecoder().decode(await bytes(g.url)));
  const files = new Map<string, Uint8Array>();
  for (const [rel, inc] of Object.entries(g.include ?? {})) files.set(rel, await bytes(inc.url));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, toGLB(gltf, files));
  return dst;
}

/** Runs `jobs` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
  }));
}

if (import.meta.main) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const res = arg("--res") ?? "1k";
  const set = SETS[arg("--set") ?? "city"];
  if (!set) throw new Error(`--set: ${Object.keys(SETS).join(" | ")}`);
  const textures = arg("--textures")?.split(",") ?? set.textures;
  const models = arg("--models")?.split(",") ?? set.models;
  const mfile = join(out, "manifest.json");
  const manifest: Record<string, string> = existsSync(mfile) ? JSON.parse(readFileSync(mfile, "utf8")) : {};
  let failed = 0;
  await pool([...textures.map((t) => ["tex", t]), ...models.map((m) => ["model", m])], 6, async ([kind, id]) => {
    try {
      if (kind === "tex") console.log(`tex   ${id}: ${(await fetchTexture(id, res, manifest)).join(" ")}`);
      else console.log(`model ${id}: ${(await fetchModel(id, res, manifest)).slice(repoRoot.length + 1)}`);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${id}: ${e}`);
    }
  });
  mkdirSync(out, { recursive: true });
  writeFileSync(mfile, JSON.stringify({ licence: "CC0 1.0 (https://polyhaven.com/license)", ...manifest }, null, 1));
  if (failed) process.exitCode = 1;
}
