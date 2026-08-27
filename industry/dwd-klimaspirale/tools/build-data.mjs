// Regenerates data/klimaspirale.json from the bundled sample generator so the
// app ships with a ready-to-render dataset. For production, replace the output
// with a real export from the semantic model (see README "Real data").
//
// Usage: node tools/build-data.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateSampleDataset } from "../dist/data.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "data");
mkdirSync(outDir, { recursive: true });

const data = generateSampleDataset();
const out = join(outDir, "klimaspirale.json");
writeFileSync(out, JSON.stringify(data), "utf-8");
console.log(`Wrote ${out} (${data.years.length} years)`);
