// Prefetches an area's PLATEAU CityGML files and their photo textures with curl (parallel, resumable), into the same
// paths tools/city/pipeline/fetch.mjs uses, so that fetch.mjs then skips them. Node's fetch() pulls ~0.5 MB/s from
// PLATEAU's CDN here (and times out on the big building files); curl gets ~12 MB/s.
//   node tools/tokyo/prefetch-plateau.mjs --area=shibuya     (then tools/city/pipeline/fetch.mjs --area=shibuya)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(import.meta.dirname, '../..');
const { resolveArea } = await import(pathToFileURL(path.join(repo, 'tools/city/pipeline/config.mjs')).href);
const area = resolveArea();
const PLATEAU_API = 'https://api.plateau.reearth.io/datacatalog/citygml/m:';
const TYPES = ['bldg', 'tran', 'brid', 'frn', 'veg'];
const dir = path.join(area.rawDir, 'plateau');
fs.mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's', ...a);
const exists = (f) => fs.existsSync(f) && fs.statSync(f).size > 0;

function curl(url, file) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const part = file + '.curl';
    const p = spawn('curl', ['-sfL', '--compressed', '--retry', '8', '--retry-all-errors', '--retry-delay', '3', '--connect-timeout', '30', '-o', part, url]);
    p.on('exit', (code) => {
      if (code === 0 && fs.existsSync(part)) { fs.renameSync(part, file); resolve(fs.statSync(file).size); }
      else { try { fs.unlinkSync(part); } catch {} reject(new Error(`curl ${code}: ${url}`)); }
    });
  });
}
async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

const jobs = [];
for (const mesh of area.meshes) {
  const catFile = path.join(dir, `catalog_${mesh}.json`);
  if (!exists(catFile)) await curl(PLATEAU_API + mesh, catFile);
  const cat = JSON.parse(fs.readFileSync(catFile, 'utf8'));
  for (const type of TYPES) {
    const urls = new Set();
    for (const city of cat.cities ?? []) for (const f of city.files?.[type] ?? []) if (f.code === mesh) urls.add(f.url);
    [...urls].forEach((url, i) => jobs.push({ url, file: path.join(dir, `${mesh}_${type}${i ? '_' + i : ''}.gml`) }));
  }
}
const todo = jobs.filter((j) => !exists(j.file));
log(`${area.id}: plateau ${jobs.length} files, ${todo.length} to download`);
let failed = 0;
await pool(todo, 8, async (j) => {
  try { const n = await curl(j.url, j.file); log(`  ${path.basename(j.file)} ${(n / 1e6).toFixed(1)} MB`); }
  catch (e) { failed++; log(`  FAILED ${e.message}`); }
});
const images = new Map();
for (const j of jobs) {
  if (!/_bldg/.test(path.basename(j.file)) || !exists(j.file)) continue;
  for (const m of fs.readFileSync(j.file, 'utf8').matchAll(/<app:imageURI>([^<]*\/(?:Roof|Wall)SurfaceTexture[^<]*)</g))
    if (!images.has(m[1])) images.set(m[1], { url: new URL(m[1], j.url).href, file: path.join(dir, m[1]) });
}
const want = [...images.values()].filter((j) => !exists(j.file));
log(`${area.id}: textures ${images.size} images, ${want.length} to download`);
let done = 0, failedImg = 0;
await pool(want, 24, async (j) => {
  try { await curl(j.url, j.file); } catch { failedImg++; }
  if (++done % 200 === 0) log(`  textures ${done}/${want.length}`);
});
log(`${area.id}: done (${failed} files and ${failedImg} images failed)`);
process.exit(failed ? 1 : 0);
