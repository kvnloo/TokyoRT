// The tour in the live view, real time, with the frame log (a benchmark; SHOTS=6,30 takes snapshots at those seconds):
//   node tools/tour.ts [tokyo-night-tour|tokyo-day-tour] [seconds] [log.jsonl]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundleGame } from "../engine/tools/bundle-game.ts";
import { repoRoot } from "./lib/paths.ts";
import { startLive, type Build } from "../engine/tools/lib/live.ts";
const rendererBin = join(repoRoot, "engine/renderer/target/release/threert-render");
const room = process.argv[2] ?? "tokyo-night-tour", secs = Number(process.argv[3] ?? 90), log = join(repoRoot, process.argv[4] ?? "out/tour.jsonl");
const bundle = join(repoRoot, "out/bundles/city.js");
await bundleGame(join(repoRoot, "scene/city.game.ts"), bundle);
const b: Build = { bin: rendererBin, assets: repoRoot, presets: join(repoRoot, "engine/presets"), bundles: join(repoRoot, "out/bundles"), label: "city" };
const live = startLive(b, bundle, { scale: "auto", room, frameLog: log, env: { THREERT_SCRIPT_MB: "12288", THREERT_EDIT_LOG: "1" } });
const first = await live.firstFrame;
console.log(`first frame ${(first / 1000).toFixed(1)} s`);
const shots = (process.env.SHOTS ?? "").split(",").filter(Boolean).map(Number);
const t0 = Date.now();
for (const t of shots) {
  await new Promise((r) => setTimeout(r, Math.max(0, t0 + t * 1000 - Date.now())));
  const p = join(repoRoot, `out/tour-${room}-${t}.png`);
  live.send({ cmd: "snapshot", path: p, after: 1 });
}
await new Promise((r) => setTimeout(r, Math.max(0, t0 + secs * 1000 - Date.now())));
const snap = join(repoRoot, "out/tour-end.png");
live.send({ cmd: "snapshot", path: snap, after: 1 });
await live.wait((l) => l.includes(snap), 60000).catch(() => {});
await live.quit();
const L = readFileSync(log, "utf8").trim().split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const s = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const iv = L.map((x) => x.interval), g = L.map((x) => x.gpu);
console.log(`${L.length} frames in ${secs} s; interval p50 ${s(iv, 0.5).toFixed(1)} p95 ${s(iv, 0.95).toFixed(1)} p99 ${s(iv, 0.99).toFixed(1)} max ${s(iv, 1).toFixed(1)} ms; GPU p50 ${s(g, 0.5).toFixed(1)} p95 ${s(g, 0.95).toFixed(1)}; over 50 ms ${iv.filter((x) => x > 50).length}; rebuilds ${L.filter((x) => x.rebuild > 1).length}; edit p95 ${s(L.map((x) => x.edit ?? 0), 0.95).toFixed(1)} ms; scale p50 ${s(L.map((x) => x.scale), 0.5)}`);
for (const x of L.filter((x) => x.rebuild > 1).slice(0, 5)) console.log("  rebuild:", x.fallback, Math.round(x.rebuild), "ms");
console.log("edit lines:", live.lines.filter((l) => l.startsWith("edit:")).length); { const k = live.lines.findIndex((l) => l.startsWith("live: 1280")); console.log(live.lines.slice(k).filter((l) => l.startsWith("world:") || l.includes("rebuild") || l.includes("structural at") || l.includes("fallback") || l.startsWith("    at ")).slice(0, 15).map((l) => l.slice(0, 200)).join("\n")); }
