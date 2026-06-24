import { readdir, readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBar, normalizeSymbol, mergeBars, saveSymbol, CACHE_SCHEMA_VERSION } from "../engine/cache-store.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(process.argv[2] || "");
const cacheRoot = resolve(process.argv[3] || resolve(projectRoot, "cache/us/ohlcv"));
if (!process.argv[2]) throw new Error("Usage: node scripts/ingest-stooq.mjs <extracted-stooq-directory> [cache-directory]");

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (extname(entry.name).toLowerCase() === ".txt") output.push(path);
  }
  return output;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(x => x.replace(/[<>]/g, "").trim().toUpperCase());
  return lines.slice(1).map(line => {
    const values = line.split(",");
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    return normalizeBar(row);
  }).filter(Boolean);
}

const files = await walk(sourceRoot);
let loaded = 0;
let rejected = 0;
const manifest = [];
for (const path of files) {
  const symbol = normalizeSymbol(path.split("/").at(-1).replace(/\.txt$/i, ""));
  const bars = mergeBars([], parseCsv(await readFile(path, "utf8")), 420);
  if (!symbol || bars.length < 20) { rejected += 1; continue; }
  const record = {
    schema_version: CACHE_SCHEMA_VERSION,
    market: "US",
    symbol,
    currency: "USD",
    interval: "1d",
    provider: "STOOQ",
    endpoint: "d_us_txt.zip",
    adjustment_status: "STOOQ_ADJUSTED_OHLC",
    delayed_or_live: "EOD",
    fallback_label: "FREE_PRIMARY",
    data_as_of: bars.at(-1).date,
    bars
  };
  await saveSymbol(cacheRoot, record);
  manifest.push({ symbol, rows: bars.length, data_as_of: record.data_as_of });
  loaded += 1;
}
await mkdir(resolve(projectRoot, "cache/us"), { recursive: true });
const manifestPath = resolve(projectRoot, "cache/us/manifest.json");
const temporary = `${manifestPath}.tmp`;
await writeFile(temporary, JSON.stringify({ schema_version: CACHE_SCHEMA_VERSION, provider: "STOOQ", loaded, rejected, generated_at: new Date().toISOString(), symbols: manifest }), "utf8");
await rename(temporary, manifestPath);
console.log(JSON.stringify({ loaded, rejected, cache_root: cacheRoot, manifest: manifestPath }));
