import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { saveSymbol, loadSymbol } from "../engine/cache-store.mjs";
import { repairUsHistory } from "../scripts/repair-us-history-5y.mjs";

function makeRows(startDate, count) {
  const rows = [];
  const date = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    const d = new Date(date.getTime());
    d.setUTCDate(date.getUTCDate() + i);
    const close = 100 + i;
    rows.push({ date: d.toISOString().slice(0, 10), open: close - 1, high: close + 1, low: close - 2, close, adjusted_close: close, volume: 100000 + i });
  }
  return rows;
}

const directory = await mkdtemp(join(tmpdir(), "aurora-history-repair-"));
const cacheRoot = resolve(directory, "ohlcv");
const reportPath = resolve(directory, "history-report.json");
await saveSymbol(cacheRoot, { schema_version: "2.0", market: "US", symbol: "A", provider: "STOOQ", endpoint: "unit-test", data_as_of: "2026-01-01", bars: makeRows("2025-12-01", 32) });

const eodhdRows = makeRows("2026-01-01", 175);
const fetcher = async url => {
  const textUrl = String(url);
  if (textUrl.includes("query1.finance.yahoo.com")) return { ok: false, status: 401, json: async () => ({}) };
  if (textUrl.includes("stooq.pl")) return { ok: false, status: 404, text: async () => "" };
  if (textUrl.includes("eodhd.com")) return { ok: true, status: 200, json: async () => eodhdRows };
  throw new Error(`UNEXPECTED_URL ${textUrl}`);
};

const report = await repairUsHistory({ cacheRoot, reportPath, symbols: ["A"], from: "2026-01-01", to: "2026-06-24", minBars: 20, staleOnly: false, eodhdToken: "unit-test-token", fetcher });
const repaired = await loadSymbol(cacheRoot, "A");
assert.equal(report.status, "UPDATED");
assert.equal(report.provider_counts.EODHD, 1);
assert.equal(repaired.provider, "EODHD");
assert.equal(repaired.data_as_of, "2026-06-24");
assert.equal(repaired.bars.length, 175);
assert.equal(JSON.stringify(JSON.parse(await readFile(reportPath, "utf8"))).includes("unit-test-token"), false);

await rm(directory, { recursive: true, force: true });

const mappedDirectory = await mkdtemp(join(tmpdir(), "aurora-history-mapped-eodhd-"));
const mappedCacheRoot = resolve(mappedDirectory, "ohlcv");
const mappedReportPath = resolve(mappedDirectory, "history-report.json");
await saveSymbol(mappedCacheRoot, { schema_version: "2.0", market: "US", symbol: "BRK-B", provider: "STOOQ", endpoint: "unit-test", data_as_of: "2026-01-01", bars: makeRows("2025-12-01", 32) });
const mappedFetcher = async url => {
  const textUrl = String(url);
  if (textUrl.includes("query1.finance.yahoo.com")) return { ok: false, status: 401, json: async () => ({}) };
  if (textUrl.includes("stooq.pl")) return { ok: false, status: 404, text: async () => "" };
  if (textUrl.includes("eodhd.com")) {
    assert(textUrl.includes("/BRK.B.US?"));
    return { ok: true, status: 200, json: async () => eodhdRows };
  }
  throw new Error(`UNEXPECTED_URL ${textUrl}`);
};
const mappedReport = await repairUsHistory({
  cacheRoot: mappedCacheRoot,
  reportPath: mappedReportPath,
  symbols: ["BRK-B"],
  from: "2026-01-01",
  to: "2026-06-24",
  minBars: 20,
  staleOnly: false,
  eodhdToken: "mapped-token",
  universeRef: [{ canonical_symbol: "BRK-B", market_symbol: "BRK-B", instrument_type: "COMMON_STOCK", provider_symbols: { eodhd: "BRK.B.US" } }],
  fetcher: mappedFetcher
});
assert.equal(mappedReport.provider_counts.EODHD, 1);
assert.equal(JSON.stringify(JSON.parse(await readFile(mappedReportPath, "utf8"))).includes("mapped-token"), false);

await rm(mappedDirectory, { recursive: true, force: true });

const ipoDirectory = await mkdtemp(join(tmpdir(), "aurora-history-ipo-"));
const ipoCacheRoot = resolve(ipoDirectory, "ohlcv");
const ipoReportPath = resolve(ipoDirectory, "history-report.json");
const ipoRows = makeRows("2026-06-01", 24);
const ipoFetcher = async url => {
  const textUrl = String(url);
  if (textUrl.includes("query1.finance.yahoo.com")) return { ok: true, status: 200, json: async () => ({ chart: { result: [{ timestamp: ipoRows.map(row => Date.parse(`${row.date}T20:00:00Z`) / 1000), indicators: { quote: [{ open: ipoRows.map(row => row.open), high: ipoRows.map(row => row.high), low: ipoRows.map(row => row.low), close: ipoRows.map(row => row.close), volume: ipoRows.map(row => row.volume) }], adjclose: [{ adjclose: ipoRows.map(row => row.close) }] } }] } }) };
  if (textUrl.includes("stooq.pl")) return { ok: false, status: 404, text: async () => "" };
  throw new Error(`UNEXPECTED_URL ${textUrl}`);
};
const ipoReport = await repairUsHistory({ cacheRoot: ipoCacheRoot, reportPath: ipoReportPath, symbols: ["IPO"], from: "2026-06-01", to: "2026-06-24", minBars: 252, staleOnly: false, allowStale: false, eodhdToken: null, fetcher: ipoFetcher });
const ipoRecord = await loadSymbol(ipoCacheRoot, "IPO");
assert.equal(ipoReport.status, "UPDATED");
assert.equal(ipoReport.ipo_short_history, 1);
assert.equal(ipoReport.failed, 0);
assert.equal(ipoRecord.fallback_label, "IPO_SHORT_HISTORY");
assert.equal(ipoRecord.data_as_of, "2026-06-24");

await rm(ipoDirectory, { recursive: true, force: true });

const olderDirectory = await mkdtemp(join(tmpdir(), "aurora-history-older-cache-"));
const olderCacheRoot = resolve(olderDirectory, "ohlcv");
const olderReportPath = resolve(olderDirectory, "history-report.json");
await saveSymbol(olderCacheRoot, { schema_version: "2.0", market: "US", symbol: "OLD", provider: "YAHOO_FINANCE", endpoint: "unit-test", data_as_of: "2026-06-24", bars: makeRows("2026-01-01", 175) });
const olderRows = makeRows("2026-01-01", 174);
const olderFetcher = async url => {
  const textUrl = String(url);
  if (textUrl.includes("query1.finance.yahoo.com")) return { ok: true, status: 200, json: async () => ({ chart: { result: [{ timestamp: olderRows.map(row => Date.parse(`${row.date}T20:00:00Z`) / 1000), indicators: { quote: [{ open: olderRows.map(row => row.open), high: olderRows.map(row => row.high), low: olderRows.map(row => row.low), close: olderRows.map(row => row.close), volume: olderRows.map(row => row.volume) }], adjclose: [{ adjclose: olderRows.map(row => row.close) }] } }] } }) };
  throw new Error(`UNEXPECTED_URL ${textUrl}`);
};
const olderReport = await repairUsHistory({ cacheRoot: olderCacheRoot, reportPath: olderReportPath, symbols: ["OLD"], from: "2026-01-01", to: "2026-06-24", minBars: 20, staleOnly: false, allowStale: false, eodhdToken: null, fetcher: olderFetcher });
assert.equal(olderReport.unchanged_cache_better_than_provider, 1);
assert.equal(olderReport.failed, 0);
assert.equal((await loadSymbol(olderCacheRoot, "OLD")).data_as_of, "2026-06-24");

await rm(olderDirectory, { recursive: true, force: true });
console.log("5Y history repair tests passed");
