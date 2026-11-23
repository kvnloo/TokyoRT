// Bundles the scene for the renderer with the engine's bundler: node tools/bundle.ts [scene/city.game.ts] [-o out.js]
import { join, resolve } from "node:path";
import { bundleGame } from "../engine/tools/bundle-game.ts";
import { repoRoot } from "./lib/paths.ts";

const args = process.argv.slice(2);
const src = resolve(args.find((a) => a.endsWith(".ts")) ?? join(repoRoot, "scene/city.game.ts"));
const out = args.includes("-o") ? resolve(args[args.indexOf("-o") + 1]) : join(repoRoot, "out/bundles/city.js");
const r = await bundleGame(src, out);
console.log(`${out.replace(repoRoot + "/", "")}: ${(r.bytes / 1024).toFixed(0)} KiB, ${r.ms.toFixed(0)} ms`);
