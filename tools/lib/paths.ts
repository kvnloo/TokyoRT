// The repository's root: assets/ (downloads, compiled tiles, baked cells) and out/ sit under it.
import { resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "../..");
