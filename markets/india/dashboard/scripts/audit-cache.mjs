import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSeries } from "../engine/cache-store.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cacheRoot = resolve(process.argv[2] || resolve(projectRoot, "cache/india/ohlcv"));
const expectedSession = process.argv[3] || null;
const files = (await readdir(cacheRoot)).filter(x => x.endsWith(".json"));
const report = {
  expected_session: expectedSession,
  total_records: files.length,
  valid_252: 0,
  insufficient: 0,
  stale: 0,
  unadjusted: 0,
  by_exchange: {},
  by_exchange_detail: {},
  series: {},
  failures: []
};
const loadedKeys = new Set();
const latestKeys = new Set();
const validKeys = new Set();
for (const file of files) {
  const record = JSON.parse(await readFile(resolve(cacheRoot, file), "utf8"));
  const key = `${record.exchange}|${record.symbol}`;
  loadedKeys.add(key);
  if (!expectedSession || record.data_as_of === expectedSession) latestKeys.add(key);
  report.by_exchange[record.exchange] = (report.by_exchange[record.exchange] || 0) + 1;
  if (!report.by_exchange_detail[record.exchange]) {
    report.by_exchange_detail[record.exchange] = { records: 0, current_bar: 0, valid_252: 0, insufficient: 0, stale: 0, unadjusted: 0 };
  }
  const exchangeDetail = report.by_exchange_detail[record.exchange];
  exchangeDetail.records += 1;
  if (!expectedSession || record.data_as_of === expectedSession) exchangeDetail.current_bar += 1;
  report.series[record.series || "UNKNOWN"] = (report.series[record.series || "UNKNOWN"] || 0) + 1;
  if (!String(record.adjustment_status).startsWith("ADJUSTED")) {
    report.unadjusted += 1;
    exchangeDetail.unadjusted += 1;
  }
  const validation = validateSeries(record.bars, { minimumBars: 252, expectedSession });
  if (validation.ok) {
    report.valid_252 += 1;
    exchangeDetail.valid_252 += 1;
    validKeys.add(key);
  }
  else {
    if (validation.code === "STALE") {
      report.stale += 1;
      exchangeDetail.stale += 1;
    }
    else {
      report.insufficient += 1;
      exchangeDetail.insufficient += 1;
    }
    report.failures.push({ exchange: record.exchange, symbol: record.symbol, code: validation.code, rows: record.bars.length, data_as_of: record.data_as_of });
  }
}
report.coverage_pct = report.total_records ? Number((100 * report.valid_252 / report.total_records).toFixed(2)) : 0;
for (const detail of Object.values(report.by_exchange_detail)) {
  detail.current_bar_coverage_pct = detail.records ? Number((100 * detail.current_bar / detail.records).toFixed(2)) : 0;
  detail.valid_252_coverage_pct = detail.records ? Number((100 * detail.valid_252 / detail.records).toFixed(2)) : 0;
}
if (report.by_exchange_detail.BSE) {
  report.bse_exclusive_overlay = {
    records: report.by_exchange_detail.BSE.records,
    latest_bar_records: report.by_exchange_detail.BSE.current_bar,
    latest_bar_coverage_pct: report.by_exchange_detail.BSE.current_bar_coverage_pct,
    valid_252_records: report.by_exchange_detail.BSE.valid_252,
    valid_252_coverage_pct: report.by_exchange_detail.BSE.valid_252_coverage_pct,
    mode: "OPTIONAL_DISCOVERY_OVERLAY",
    warning: "BSE quick-mode history is not part of the core NSE 252-bar coverage denominator. Use for BSE-exclusive discovery, liquidity cautioning and short-history adaptive scans."
  };
}
try {
  const universe = JSON.parse(await readFile(resolve(projectRoot, "data/india-universe.json"), "utf8"));
  const listings = universe.companies.flatMap(company => company.listings);
  report.expected_active_listings = universe.listing_count;
  report.expected_companies_deduped_by_isin = universe.company_count;
  report.current_bar_matched_listings = listings.filter(x => latestKeys.has(`${x.exchange}|${x.symbol}`)).length;
  report.current_bar_coverage_pct = universe.listing_count ? Number((100 * report.current_bar_matched_listings / universe.listing_count).toFixed(2)) : 0;
  report.valid_252_matched_listings = listings.filter(x => validKeys.has(`${x.exchange}|${x.symbol}`)).length;
  report.valid_listing_coverage_pct = universe.listing_count ? Number((100 * report.valid_252_matched_listings / universe.listing_count).toFixed(2)) : 0;
  report.missing_current_bar = listings.filter(x => !latestKeys.has(`${x.exchange}|${x.symbol}`)).map(x => ({ exchange: x.exchange, symbol: x.symbol, series: x.series, name: x.name }));
} catch {
  report.expected_active_listings = null;
  report.expected_companies_deduped_by_isin = null;
  report.valid_listing_coverage_pct = null;
  report.current_bar_matched_listings = null;
  report.current_bar_coverage_pct = null;
  report.valid_252_matched_listings = null;
  report.missing_current_bar = [];
}
const output = resolve(projectRoot, "data/india-cache-audit.json");
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, failures: report.failures.slice(0, 20), output }));
