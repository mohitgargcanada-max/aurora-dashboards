import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { CANADA_PROFILE, FINAL_BUCKETS, REQUIRED_CANDIDATE_COLUMNS, validateYahooSymbol, mapCanadaTheme, liquidityLabel } from "../engine/canada-adapter.mjs";
import { auditIndexRecords, CANADA_PROVIDER_ROUTE, coverageGuard, providerBlendStatus } from "../engine/freshness-guard.mjs";
import { canadaCalendarSummary, isCanadaTradingDay, previousCanadaTradingDay } from "../engine/trading-calendar.mjs";
import { writeJson, readJson } from "../engine/cache-store.mjs";
import { alignedSeries } from "../engine/indicators.mjs";
import { renderCanadaDashboard } from "../engine/scan-engine.mjs";
import { mapYahooToEodhdSymbol, normalizeEodhdDaily } from "../engine/eodhd-client.mjs";

assert.equal(CANADA_PROFILE.market, "CANADA");
assert.equal(CANADA_PROFILE.currency, "CAD");
assert.equal(validateYahooSymbol("RY.TO", "TSX"), true);
assert.equal(validateYahooSymbol("SHOP.TO", "TSX"), true);
assert.equal(validateYahooSymbol("ABC.V", "TSXV"), true);
assert.equal(validateYahooSymbol("RY.TO", "TSXV"), false);
assert.equal(mapCanadaTheme({ symbol: "RY.TO", name: "Royal Bank" }).theme, "Canadian Banks");
assert.equal(mapCanadaTheme({ symbol: "ZZZ.TO", name: "Unknown" }).theme, "UNMAPPED_REVIEW");
assert.equal(liquidityLabel({ addv20: 2_000_000, avgVolume20: 150_000, price: 10 }), "LIQUIDITY_PASS");
assert.equal(liquidityLabel({ addv20: 500_000, avgVolume20: 150_000, price: 10 }), "LIQUIDITY_THIN_CAUTION");
assert.equal(isCanadaTradingDay("2026-06-27"), false);
assert.equal(previousCanadaTradingDay("2026-06-27"), "2026-06-26");
assert.equal(isCanadaTradingDay("2026-08-03"), false);
assert.equal(isCanadaTradingDay("2026-12-28"), false);
assert.equal(isCanadaTradingDay("2026-08-04"), true);
assert.equal(canadaCalendarSummary(new Date("2026-08-03T13:00:00Z")).is_market_holiday, true);
assert.equal(canadaCalendarSummary(new Date("2026-08-04T13:00:00Z")).scheduled_scan_time_et, "09:00");

const freshAudit = auditIndexRecords([
  { symbol: "^GSPTSE", data_as_of: "2026-06-26", provider: "YAHOO_FINANCE" },
  { symbol: "XIC.TO", data_as_of: "2026-06-26", provider: "YAHOO_FINANCE" },
  { symbol: "XIU.TO", data_as_of: "2026-06-26", provider: "YAHOO_FINANCE" },
  { symbol: "XIT.TO", data_as_of: "2026-06-26", provider: "YAHOO_FINANCE" },
  { symbol: "XEG.TO", data_as_of: "2026-06-26", provider: "YAHOO_FINANCE" }
], "2026-06-26");
assert.equal(freshAudit.status, "INDEX_FRESHNESS_OK");
assert.equal(freshAudit.context_status, "INDEX_CONTEXT_OK");

const partialAudit = auditIndexRecords([
  { symbol: "^GSPTSE", data_as_of: "2026-06-26", provider: "YAHOO_FINANCE" },
  { symbol: "XIC.TO", data_as_of: "2026-06-25", provider: "YAHOO_FINANCE" }
], "2026-06-26");
assert.equal(partialAudit.status, "INDEX_FRESHNESS_OK");
assert.equal(partialAudit.context_status, "INDEX_CONTEXT_PARTIAL");
assert.ok(partialAudit.optional_stale_symbols.length >= 1);

const staleAudit = auditIndexRecords([{ symbol: "^GSPTSE", data_as_of: "2026-06-25", provider: "YAHOO_FINANCE" }], "2026-06-26");
assert.equal(staleAudit.status, "DATA_STALE_PRIMARY_INDEX_BLOCKED");
assert.ok(staleAudit.blocking_stale_symbols.some(x => x.symbol === "^GSPTSE"));

const coverage = coverageGuard({ expectedSession: "2026-06-26", records: [
  { symbol: "RY.TO", data_as_of: "2026-06-26", bars: Array(300).fill({}) },
  { symbol: "SHOP.TO", data_as_of: "2026-06-25", bars: Array(300).fill({}) }
], minCoveragePct: 60 });
assert.equal(coverage.status, "DATA_STALE_STOCKS_BLOCKED");
assert.equal(coverageGuard({ expectedSession: "2026-06-26", records: [] }).status, "EMPTY_SCAN_BLOCKED");
assert.equal(providerBlendStatus({ provider: "YAHOO_FINANCE", bars: [{ provider: "EODHD" }] }).ok, false);
assert.equal(providerBlendStatus({ provider: "EODHD", bars: [{ provider: "EODHD" }] }).ok, true);
assert.equal(coverageGuard({ expectedSession: "2026-06-26", records: [{ symbol: "RY.TO", data_as_of: "2026-06-26", provider: "YAHOO_FINANCE", bars: [{ provider: "EODHD" }] }] }).status, "PROVIDER_BLEND_BLOCKED");
assert.ok(CANADA_PROVIDER_ROUTE.includes("EODHD_FALLBACK"));

assert.equal(mapYahooToEodhdSymbol("^GSPTSE"), "GSPTSE.INDX");
assert.equal(mapYahooToEodhdSymbol("RY.TO", "TSX"), "RY.TO");
assert.equal(mapYahooToEodhdSymbol("ABC", "TSXV"), "ABC.V");
const eodhd = normalizeEodhdDaily("RY.TO", [{ date: "2026-06-26", open: 10, high: 12, low: 9, close: 10, adjusted_close: 5, volume: 1000 }], { mappedSymbol: "RY.TO" });
assert.equal(eodhd.provider, "EODHD");
assert.equal(eodhd.adjustment_status, "ADJUSTED_OHLCV_FROM_ADJUSTED_CLOSE_RATIO");
assert.equal(eodhd.bars[0].open, 5);
assert.equal(eodhd.bars[0].high, 6);
assert.equal(eodhd.bars[0].low, 4.5);
assert.equal(eodhd.bars[0].close, 5);
assert.equal(providerBlendStatus(eodhd).ok, true);

const stock = [{ date: "2026-01-02", close: 10 }, { date: "2026-01-05", close: 11 }];
const bm = [{ date: "2026-01-02", close: 100 }, { date: "2026-01-05", close: 100 }];
assert.equal(alignedSeries(stock, bm).length, 2);
assert.ok(REQUIRED_CANDIDATE_COLUMNS.includes("User Note"));
assert.ok(FINAL_BUCKETS.includes("TRIGGER_READY"));
assert.ok(!FINAL_BUCKETS.includes("RSLE_TRIGGER_READY"));

const html = renderCanadaDashboard({
  expectedSession: "2026-06-26",
  rows: [],
  rejected: [],
  indexAudit: { status: "INDEX_FRESHNESS_OK", context_status: "INDEX_CONTEXT_PARTIAL", valid_symbols: 1, checked_symbols: 5, provider_route: ["YAHOO_FINANCE", "EODHD_FALLBACK"], present_symbols: [{ symbol: "^GSPTSE", data_as_of: "2026-06-26", provider: "YAHOO_FINANCE" }], optional_stale_symbols: [{ symbol: "XIT.TO", reason: "STALE_INDEX_BAR" }] },
  coverage: { status: "COVERAGE_OK", coverage_pct: 100, current_symbols: 1, loaded_symbols: 1, valid_history_symbols: 1 },
  weeklyUniverse: [],
  weeklyFocus: [],
  dailyTop: [],
  rsleTop20: [],
  developing: [],
  nearRsHigh: [],
  pullbacks: [],
  basepivots: [],
  rmvp: [],
  ve2: [],
  compression: [],
  noChase: [],
  themes: []
});
assert.match(html, /AURORA Canada Unified Dashboard/);
assert.match(html, /RS means benchmark-relative strength, never RSI/);
assert.match(html, /EODHD_FALLBACK_ENABLED_ONLY_AFTER_YAHOO_FAILURE_STALE_OR_INCOMPLETE/);
assert.match(html, /SELECTIVE_ONLY_CONTEXT_PARTIAL/);

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const helper = await readFile(resolve(repoRoot, "scripts/prepare-canada-pages-artifact.sh"), "utf8");
assert.match(helper, /markets\/canada/);
assert.match(helper, /markets\/us/);
assert.match(helper, /markets\/india/);
assert.match(helper, /canada-\*\.json/);
assert.match(helper, /AURORA_US_Dashboard/);
assert.match(helper, /AURORA_India_Unified_Dashboard/);

const dir = await mkdtemp(join(tmpdir(), "aurora-canada-"));
const path = join(dir, "nested", "file.json");
await writeJson(path, { ok: true });
assert.deepEqual(await readJson(path), { ok: true });
await writeFile(join(dir, "artifact.txt"), "canada-only");
await rm(dir, { recursive: true, force: true });

console.log("Canada dashboard tests passed.");
