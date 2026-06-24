import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBar, normalizeSymbol, mergeBars, loadSymbol, saveSymbol, validateSeries, CACHE_SCHEMA_VERSION } from "../engine/cache-store.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const snapshotPath = resolve(process.argv[2] || "");
const expectedSession = process.argv[3];
const provider = String(process.argv[4] || "STOOQ_CURRENT_DAILY_SNAPSHOT").toUpperCase();
const cacheRoot = resolve(process.argv[5] || resolve(projectRoot, "cache/us/ohlcv"));
if (!process.argv[2] || !/^\d{4}-\d{2}-\d{2}$/.test(expectedSession || "")) throw new Error("Usage: node scripts/apply-daily-snapshot.mjs <csv> <expected-session> [provider] [cache-directory]");

const lines = (await readFile(snapshotPath, "utf8")).trim().split(/\r?\n/);
const headers = lines.shift().split(",").map(x => x.replace(/[<>]/g, "").trim().toUpperCase());
const changes = { inserted: 0, corrected: 0, skipped: 0, unresolved: [] };
for (const line of lines) {
  const values = line.split(",");
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  const symbol = normalizeSymbol(row.TICKER ?? row.SYMBOL ?? values[0]);
  const bar = normalizeBar(row);
  if (!symbol || !bar || bar.date !== expectedSession) { changes.skipped += 1; continue; }
  const existing = await loadSymbol(cacheRoot, symbol);
  if (!existing) { changes.unresolved.push({ symbol, reason: "HISTORY_BOOTSTRAP_REQUIRED" }); continue; }
  const old = existing.bars.find(x => x.date === expectedSession);
  const bars = mergeBars(existing.bars, [bar], 420);
  const validation = validateSeries(bars, { minimumBars: Math.min(252, bars.length), expectedSession });
  if (!validation.ok) { changes.unresolved.push({ symbol, reason: validation.code }); continue; }
  await saveSymbol(cacheRoot, {
    ...existing,
    schema_version: CACHE_SCHEMA_VERSION,
    provider,
    endpoint: snapshotPath,
    retrieved_at: new Date().toISOString(),
    data_as_of: expectedSession,
    fallback_label: provider.startsWith("EODHD") ? "EODHD_FALLBACK" : "FREE_PRIMARY",
    bars
  });
  if (old) changes.corrected += 1; else changes.inserted += 1;
}
console.log(JSON.stringify({ expected_session: expectedSession, provider, ...changes }));
