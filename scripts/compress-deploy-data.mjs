#!/usr/bin/env node
// Vercel build step (npm's "prebuild" lifecycle hook -- runs automatically
// before "build") for api/forecast.py's data bundle. Node, not Python:
// Vercel's Next.js build container has no guaranteed Python on PATH, so this
// mirrors scripts/compress_deploy_data.py's logic (used by the Python test
// suite locally) using only Node's built-in zlib/fs -- no new dependency,
// guaranteed to run wherever `next build` already runs. Keep the two in
// sync if this logic ever changes; see compress_deploy_data.py's own
// docstring for *why* this compression exists at all (Vercel's 250MB
// unzipped function size limit vs. pandas/numpy + the model's data).

import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createGzip } from "node:zlib";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, "data");
const OUT_DIR = join(ROOT, "data-deploy");

const FULL_ARCHIVE_DIRS = ["history", "understat"];
const LATEST_ONLY_DIRS = ["bootstrap-static", "fixtures", "minutes-model", "entity-resolution"];
const FULL_SMALL_DIRS = ["event-live"];
const EXTRA_FILES = ["record/residuals.json"];

function walkJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonFiles(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

async function gzipFile(src, dst) {
  mkdirSync(dirname(dst), { recursive: true });
  await pipeline(createReadStream(src), createGzip(), createWriteStream(`${dst}.gz`));
}

async function main() {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });

  let count = 0;

  for (const name of [...FULL_ARCHIVE_DIRS, ...FULL_SMALL_DIRS]) {
    for (const path of walkJsonFiles(join(DATA_DIR, name))) {
      await gzipFile(path, join(OUT_DIR, relative(DATA_DIR, path)));
      count += 1;
    }
  }

  for (const name of LATEST_ONLY_DIRS) {
    const dir = join(DATA_DIR, name);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    if (files.length === 0) continue;
    const latest = files[files.length - 1];
    await gzipFile(join(dir, latest), join(OUT_DIR, name, latest));
    count += 1;
  }

  for (const rel of EXTRA_FILES) {
    const path = join(DATA_DIR, rel);
    if (existsSync(path)) {
      await gzipFile(path, join(OUT_DIR, rel));
      count += 1;
    }
  }

  console.log(`compress-deploy-data: ${count} files -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
