// Prefetches an area's Overpass extracts (the queries of tools/city/pipeline/fetch.mjs, read from its source) into the
// same files, trying mirrors that answer with a long timeout. fetch.mjs then finds them cached.
//   node tools/tokyo/prefetch-osm.mjs --area=shiba           (then tools/city/pipeline/fetch.mjs --area=shiba)
// (Overpass, 2026-11-11: overpass-api.de answered heavy queries in 1-5 min where fetch.mjs gives up at 4; the kumi and
// private.coffee mirrors timed out, maps.mail.ru answered small queries only.)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(import.meta.dirname, '../..');
const { resolveArea } = await import(pathToFileURL(path.join(repo, 'tools/city/pipeline/config.mjs')).href);
const area = resolveArea();
const src = fs.readFileSync(path.join(repo, 'tools/city/pipeline/fetch.mjs'), 'utf8');
const QUERIES = new Function(`return ${src.match(/const OSM_QUERIES = (\{[\s\S]*?\n\});/)[1]}`)();
const SERVERS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter'];
const UA = 'procedural-tokyo/0.1 (city compiler; https://github.com/)';
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's', ...a);

for (const [name, body] of Object.entries(QUERIES)) {
  const file = path.join(area.rawDir, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) { log(`${name}: cached`); continue; }
  const { south, west, north, east } = area.bbox;
  const filled = body.replaceAll('{bb}', `${south},${west},${north},${east}`);
  const query = `[out:json][timeout:900];\n${filled}${/\bout\b/.test(filled) ? '' : '\n(._;>;);\nout body;'}`;
  let done = false;
  for (let round = 0; round < 4 && !done; round++) {
    for (const url of SERVERS) {
      try {
        log(`${name}: querying ${new URL(url).host}`);
        const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(900000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const n = JSON.parse(buf).elements.length; // (a server's error page is not JSON)
        if (!n) throw new Error('no elements');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.part', buf);
        fs.renameSync(file + '.part', file);
        log(`${name}: ${n} elements, ${(buf.length / 1e6).toFixed(1)} MB`);
        done = true;
        break;
      } catch (e) {
        log(`${name}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 15000));
      }
    }
  }
  if (!done) { log(`${name}: every server failed`); process.exit(1); }
}
log('done');
