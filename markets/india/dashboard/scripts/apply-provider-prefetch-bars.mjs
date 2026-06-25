import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE_SCHEMA_VERSION, loadSymbol, mergeBars, normalizeBar, normalizeSymbol, saveSymbol, validateSeries } from "../engine/cache-store.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const inputPath = resolve(process.argv[2] || "");
const expectedSession = process.argv[3] || null;
const cacheRoot = resolve(process.argv[4] || resolve(projectRoot, "cache/india/ohlcv"));

if (!process.argv[2] || !expectedSession) {
  throw new Error("Usage: node scripts/apply-provider-prefetch-bars.mjs <prefetch-json> <expected-session> [cache-root]");
}

const payload = JSON.parse(await readFile(inputPath, "utf8"));
const rows = Array.isArray(payload) ? payload : payload.bars || payload.records || [];
const provider = payload.provider || "PROVIDER_PREFETCH";
const endpoint = payload.endpoint || `CONNECTOR_PREFETCH:${inputPath}`;
const retrievedAt = payload.retrieved_at || new Date().toISOString();

let inserted = 0;
let corrected = 0;
let unchanged = 0;
let missingExisting = 0;
let invalid = 0;
const warnings = [];

for (const row of rows) {
  const exchange = String(row.exchange || "NSE").toUpperCase();
  const symbol = normalizeSymbol(row.symbol);
  const bar = normalizeBar(row.bar || row);
  if (!symbol || !bar || bar.date !== expectedSession) {
    invalid += 1;
    warnings.push({ exchange, symbol: row.symbol, warning: "INVALID_OR_WRONG_SESSION_BAR" });
    continue;
  }

  const existing = await loadSymbol(cacheRoot, exchange, symbol);
  if (!existing) {
    missingExisting += 1;
    warnings.push({ exchange, symbol, warning: "CACHE_RECORD_NOT_FOUND" });
    continue;
  }

  const old = existing.bars?.find(item => item.date === expectedSession);
  const bars = mergeBars(existing.bars || [], [bar]);
  const validation = validateSeries(bars, { minimumBars: Math.min(63, bars.length), expectedSession });
  if (!validation.ok) {
    invalid += 1;
    warnings.push({ exchange, symbol, warning: validation.code });
    continue;
  }

  await saveSymbol(cacheRoot, {
    ...existing,
    schema_version: CACHE_SCHEMA_VERSION,
    provider: `${provider}_DATA_REPAIR`,
    endpoint,
    retrieved_at: retrievedAt,
    data_as_of: expectedSession,
    delayed_or_live: "EOD",
    fallback_label: provider === "TAPETIDE" ? "FREE_PRIMARY" : "PARTIAL",
    fallback_reason: payload.fallback_reason || "WEEKDAY_ACTIVE_LIST_EOD_REPAIR",
    warnings: [
      ...(existing.warnings || []),
      `ACTIVE_LIST_DAILY_REPAIR_FROM_${provider}`
    ],
    bars
  });

  if (!old) inserted += 1;
  else if (JSON.stringify(old) !== JSON.stringify(bar)) corrected += 1;
  else unchanged += 1;
}

console.log(JSON.stringify({
  input: inputPath,
  expected_session: expectedSession,
  provider,
  inserted,
  corrected,
  unchanged,
  missing_existing: missingExisting,
  invalid,
  warnings: warnings.slice(0, 20)
}, null, 2));
