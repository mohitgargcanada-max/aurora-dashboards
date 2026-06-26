import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBhavcopyRow, parseCsv } from "../engine/bhavcopy-parser.mjs";
import { CACHE_SCHEMA_VERSION, loadSymbol, mergeBars, saveSymbol } from "../engine/cache-store.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(process.argv[2] || "");
const expectedSession = process.argv[3] || null;
const cacheRoot = resolve(process.argv[4] || resolve(projectRoot, "cache/india/ohlcv"));
const rawRoot = resolve(projectRoot, "cache/india/raw");
const manifestRoot = resolve(projectRoot, "cache/india/manifests");
if (!process.argv[2]) throw new Error("Usage: node scripts/ingest-bhavcopy.mjs <file-or-directory> [expected-session] [cache-directory]");

async function walk(path) {
  const stat = await import("node:fs/promises").then(x => x.stat(path));
  if (stat.isFile()) return [path];
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) output.push(...await walk(child));
    else if ([".csv", ".zip"].includes(extname(entry.name).toLowerCase())) output.push(child);
  }
  return output;
}

function archiveCsv(path) {
  const zip = new AdmZip(path);
  return zip.getEntries()
    .filter(entry => !entry.isDirectory && /\.csv$/i.test(entry.entryName))
    .map(entry => ({
      name: `${basename(path)}::${entry.entryName}`,
      text: entry.getData().toString("utf8")
    }));
}

const files = await walk(sourceRoot);
const grouped = new Map();
const sources = [];
let rejectedRows = 0;
for (const path of files) {
  const buffer = await readFile(path);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const inputs = extname(path).toLowerCase() === ".zip" ? archiveCsv(path) : [{ name: basename(path), text: buffer.toString("utf8") }];
  let accepted = 0;
  let firstDate = null;
  let lastDate = null;
  for (const input of inputs) {
    for (const raw of parseCsv(input.text)) {
      const item = normalizeBhavcopyRow(raw, input.name);
      if (!item || (expectedSession && item.bar.date !== expectedSession)) { rejectedRows += 1; continue; }
      const key = `${item.exchange}__${item.symbol}`;
      if (!grouped.has(key)) grouped.set(key, { ...item, bars: [] });
      grouped.get(key).bars.push(item.bar);
      firstDate = !firstDate || item.bar.date < firstDate ? item.bar.date : firstDate;
      lastDate = !lastDate || item.bar.date > lastDate ? item.bar.date : lastDate;
      accepted += 1;
    }
  }
  const session = expectedSession || lastDate || "unknown";
  const destination = resolve(rawRoot, session, basename(path));
  await mkdir(resolve(rawRoot, session), { recursive: true });
  if (resolve(path) !== destination) await copyFile(path, destination);
  sources.push({ file: basename(path), sha256: hash, bytes: buffer.length, accepted_rows: accepted, first_date: firstDate, last_date: lastDate });
}

let created = 0;
let updated = 0;
const symbolManifest = [];
for (const item of grouped.values()) {
  const existing = await loadSymbol(cacheRoot, item.exchange, item.symbol);
  const bars = mergeBars(existing?.bars || [], item.bars);
  const record = {
    schema_version: CACHE_SCHEMA_VERSION,
    market: "INDIA",
    exchange: item.exchange,
    symbol: item.symbol,
    security_code: item.security_code,
    isin: item.isin || existing?.isin || null,
    series: item.series || existing?.series || null,
    currency: "INR",
    interval: "1d",
    provider: item.exchange === "NSE" ? "NSE_OFFICIAL_BHAVCOPY" : "BSE_OFFICIAL_BHAVCOPY",
    endpoint: sources.map(x => x.file),
    retrieved_at: new Date().toISOString(),
    data_as_of: bars.at(-1)?.date || null,
    adjustment_status: "UNADJUSTED_RAW_CORPORATE_ACTION_REVIEW_REQUIRED",
    delayed_or_live: "EOD",
    fallback_label: "OFFICIAL_VERIFIED",
    warnings: [],
    bars
  };
  await saveSymbol(cacheRoot, record);
  if (existing) updated += 1; else created += 1;
  symbolManifest.push({ exchange: record.exchange, symbol: record.symbol, isin: record.isin, series: record.series, rows: bars.length, data_as_of: record.data_as_of });
}

await mkdir(manifestRoot, { recursive: true });
const manifest = {
  schema_version: CACHE_SCHEMA_VERSION,
  generated_at: new Date().toISOString(),
  expected_session: expectedSession,
  source_files: sources,
  created,
  updated,
  rejected_rows: rejectedRows,
  symbols_touched: symbolManifest.length,
  symbols: symbolManifest
};
const manifestPath = resolve(manifestRoot, `ingest-${expectedSession || Date.now()}.json`);
const temporary = `${manifestPath}.tmp`;
await writeFile(temporary, JSON.stringify(manifest, null, 2));
await rename(temporary, manifestPath);
console.log(JSON.stringify({ created, updated, rejected_rows: rejectedRows, symbols_touched: symbolManifest.length, manifest: manifestPath }));
