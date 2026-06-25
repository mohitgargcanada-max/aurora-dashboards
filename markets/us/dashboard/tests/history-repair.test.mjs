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
console.log("5Y history repair tests passed");
