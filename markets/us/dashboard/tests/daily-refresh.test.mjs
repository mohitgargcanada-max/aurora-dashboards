import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveSymbol, loadSymbol } from "../engine/cache-store.mjs";
import { latestCompletedUsSession, parseEodhdBulkRows, parseStooqDailyCsv, parseStooqQuoteCsv, parseYahooQuoteRows, refreshDailyBars, stooqSymbol, yahooSymbol } from "../scripts/refresh-stooq-daily-bars.mjs";

assert.equal(stooqSymbol("BRK-B"), "brk-b.us");
assert.equal(yahooSymbol("BRK-B"), "BRK-B");
assert.equal(latestCompletedUsSession(new Date("2026-06-24T13:00:00Z")), "2026-06-23");

const parsed = parseStooqQuoteCsv("Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-06-23,22:00:00,10,12,9,11,1000\n");
assert.equal(parsed[0].symbol, "AAPL");
assert.equal(parsed[0].bar.close, 11);
const stooqDailyParsed = parseStooqDailyCsv("AAPL", "<DATE>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>\n2026-06-23,10,12,9,11,1000\n");
assert.equal(stooqDailyParsed[0].symbol, "AAPL");
assert.equal(stooqDailyParsed[0].bar.close, 11);
const eodhdParsed = parseEodhdBulkRows([{ code: "MSFT.US", date: "2026-06-23", open: 20, high: 22, low: 19, close: 21, adjusted_close: 21, volume: 2000 }]);
assert.equal(eodhdParsed[0].symbol, "MSFT");
assert.equal(eodhdParsed[0].bar.volume, 2000);
const yahooParsed = parseYahooQuoteRows([{ symbol: "MSFT", regularMarketTime: Date.parse("2026-06-23T20:00:00Z") / 1000, regularMarketOpen: 20, regularMarketDayHigh: 22, regularMarketDayLow: 19, regularMarketPrice: 21, regularMarketVolume: 2000 }]);
assert.equal(yahooParsed[0].symbol, "MSFT");
assert.equal(yahooParsed[0].bar.close, 21);

const directory = await mkdtemp(join(tmpdir(), "aurora-refresh-"));
const reportPath = join(directory, "report.json");
await saveSymbol(directory, {
  schema_version: "2.0",
  market: "US",
  symbol: "AAPL",
  currency: "USD",
  interval: "1d",
  provider: "STOOQ",
  endpoint: "d_us_txt.zip",
  adjustment_status: "STOOQ_ADJUSTED_OHLC",
  delayed_or_live: "EOD",
  fallback_label: "FREE_PRIMARY",
  data_as_of: "2026-06-22",
  bars: [
    { date: "2026-06-22", open: 9, high: 10, low: 8, close: 9.5, adjusted_close: 9.5, volume: 900 }
  ]
});

const fetcher = async () => new Response(
  "Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-06-23,22:00:00,10,12,9,11,1000\n",
  { status: 200, headers: { "content-type": "text/csv" } }
);
const report = await refreshDailyBars({
  cacheRoot: directory,
  reportPath,
  chunkSize: 10,
  fetcher,
  now: new Date("2026-06-24T13:00:00Z")
});
assert.equal(report.status, "UPDATED");
assert.equal(report.inserted, 1);
assert.equal((await loadSymbol(directory, "AAPL")).data_as_of, "2026-06-23");
assert.equal(JSON.parse(await readFile(reportPath, "utf8")).latest_data_as_of, "2026-06-23");

await rm(directory, { recursive: true, force: true });

const splitDirectory = await mkdtemp(join(tmpdir(), "aurora-refresh-split-"));
const splitReportPath = join(splitDirectory, "report.json");
for (const symbol of ["AAPL", "BADTICKER"]) {
  await saveSymbol(splitDirectory, {
    schema_version: "2.0",
    market: "US",
    symbol,
    currency: "USD",
    interval: "1d",
    provider: "STOOQ",
    endpoint: "d_us_txt.zip",
    adjustment_status: "STOOQ_ADJUSTED_OHLC",
    delayed_or_live: "EOD",
    fallback_label: "FREE_PRIMARY",
    data_as_of: "2026-06-22",
    bars: [
      { date: "2026-06-22", open: 9, high: 10, low: 8, close: 9.5, adjusted_close: 9.5, volume: 900 }
    ]
  });
}
const splitFetcher = async url => {
  if (url.includes("aapl.us,badticker.us")) return new Response("not found", { status: 404 });
  if (url.includes("aapl.us")) {
    return new Response(
      "Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-06-23,22:00:00,10,12,9,11,1000\n",
      { status: 200, headers: { "content-type": "text/csv" } }
    );
  }
  return new Response("not found", { status: 404 });
};
const splitReport = await refreshDailyBars({
  cacheRoot: splitDirectory,
  reportPath: splitReportPath,
  chunkSize: 10,
  fetcher: splitFetcher,
  now: new Date("2026-06-24T13:00:00Z")
});
assert.equal(splitReport.status, "UPDATED");
assert.equal(splitReport.provider_counts.STOOQ, 1);
assert.equal(splitReport.missing_quote, 1);
assert.equal((await loadSymbol(splitDirectory, "AAPL")).data_as_of, "2026-06-23");

await rm(splitDirectory, { recursive: true, force: true });

const historyDirectory = await mkdtemp(join(tmpdir(), "aurora-refresh-history-"));
const historyReportPath = join(historyDirectory, "report.json");
await saveSymbol(historyDirectory, {
  schema_version: "2.0",
  market: "US",
  symbol: "AAPL",
  currency: "USD",
  interval: "1d",
  provider: "STOOQ",
  endpoint: "d_us_txt.zip",
  adjustment_status: "STOOQ_ADJUSTED_OHLC",
  delayed_or_live: "EOD",
  fallback_label: "FREE_PRIMARY",
  data_as_of: "2026-06-22",
  bars: [
    { date: "2026-06-22", open: 9, high: 10, low: 8, close: 9.5, adjusted_close: 9.5, volume: 900 }
  ]
});
const historyFetcher = async url => {
  if (url.includes("/q/l/")) return new Response("not found", { status: 404 });
  if (url.includes("/q/d/l/")) {
    assert(url.includes("d1=20260623"));
    return new Response(
      "<DATE>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>\n2026-06-23,10,12,9,11,1000\n",
      { status: 200, headers: { "content-type": "text/csv" } }
    );
  }
  throw new Error(`Unexpected URL ${url}`);
};
const historyReport = await refreshDailyBars({
  cacheRoot: historyDirectory,
  reportPath: historyReportPath,
  chunkSize: 10,
  fetcher: historyFetcher,
  now: new Date("2026-06-24T13:00:00Z")
});
assert.equal(historyReport.status, "UPDATED");
assert.equal(historyReport.provider_counts.STOOQ, 1);
assert.equal((await loadSymbol(historyDirectory, "AAPL")).endpoint, "https://stooq.pl/q/d/l/");

await rm(historyDirectory, { recursive: true, force: true });

const yahooDirectory = await mkdtemp(join(tmpdir(), "aurora-refresh-yahoo-"));
const yahooReportPath = join(yahooDirectory, "report.json");
await saveSymbol(yahooDirectory, {
  schema_version: "2.0",
  market: "US",
  symbol: "MSFT",
  currency: "USD",
  interval: "1d",
  provider: "STOOQ",
  endpoint: "d_us_txt.zip",
  adjustment_status: "STOOQ_ADJUSTED_OHLC",
  delayed_or_live: "EOD",
  fallback_label: "FREE_PRIMARY",
  data_as_of: "2026-06-22",
  bars: [
    { date: "2026-06-22", open: 19, high: 20, low: 18, close: 19.5, adjusted_close: 19.5, volume: 1900 }
  ]
});
const yahooFetcher = async url => {
  if (url.includes("stooq.pl")) return new Response("blocked", { status: 403 });
  return new Response(
    JSON.stringify({ quoteResponse: { result: [{ symbol: "MSFT", regularMarketTime: Date.parse("2026-06-23T20:00:00Z") / 1000, regularMarketOpen: 20, regularMarketDayHigh: 22, regularMarketDayLow: 19, regularMarketPrice: 21, regularMarketVolume: 2000 }] } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};
const yahooReport = await refreshDailyBars({
  cacheRoot: yahooDirectory,
  reportPath: yahooReportPath,
  chunkSize: 10,
  fetcher: yahooFetcher,
  now: new Date("2026-06-24T13:00:00Z")
});
assert.equal(yahooReport.fallback_label, "YAHOO_FALLBACK");
assert.equal(yahooReport.provider_counts.YAHOO_FINANCE, 1);
assert.equal((await loadSymbol(yahooDirectory, "MSFT")).fallback_label, "YAHOO_FALLBACK");

await rm(yahooDirectory, { recursive: true, force: true });

const fallbackDirectory = await mkdtemp(join(tmpdir(), "aurora-refresh-eodhd-"));
const fallbackReportPath = join(fallbackDirectory, "report.json");
await saveSymbol(fallbackDirectory, {
  schema_version: "2.0",
  market: "US",
  symbol: "MSFT",
  currency: "USD",
  interval: "1d",
  provider: "STOOQ",
  endpoint: "d_us_txt.zip",
  adjustment_status: "STOOQ_ADJUSTED_OHLC",
  delayed_or_live: "EOD",
  fallback_label: "FREE_PRIMARY",
  data_as_of: "2026-06-22",
  bars: [
    { date: "2026-06-22", open: 19, high: 20, low: 18, close: 19.5, adjusted_close: 19.5, volume: 1900 }
  ]
});
const fallbackFetcher = async url => {
  if (url.includes("stooq.pl")) return new Response("blocked", { status: 403 });
  if (url.includes("query1.finance.yahoo.com")) return new Response("blocked", { status: 403 });
  assert(url.includes("api_token=secret-token"));
  return new Response(
    JSON.stringify([{ code: "MSFT.US", date: "2026-06-23", open: 20, high: 22, low: 19, close: 21, adjusted_close: 21, volume: 2000 }]),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};
const fallbackReport = await refreshDailyBars({
  cacheRoot: fallbackDirectory,
  reportPath: fallbackReportPath,
  chunkSize: 10,
  fetcher: fallbackFetcher,
  eodhdToken: "secret-token",
  now: new Date("2026-06-24T13:00:00Z")
});
assert.equal(fallbackReport.fallback_label, "EODHD_FALLBACK");
assert.equal(fallbackReport.provider_counts.EODHD, 1);
assert.equal((await loadSymbol(fallbackDirectory, "MSFT")).fallback_label, "EODHD_FALLBACK");
assert(!JSON.stringify(fallbackReport).includes("secret-token"));
assert(!JSON.stringify(JSON.parse(await readFile(fallbackReportPath, "utf8"))).includes("api_token"));

await rm(fallbackDirectory, { recursive: true, force: true });
console.log("Daily refresh contract tests passed");
