import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSymbol, saveSymbol } from "../engine/cache-store.mjs";
import { latestCompletedIndiaSession } from "../engine/trading-calendar.mjs";
import { appendOfficialSource, appendProviderConsistentFallback, refreshIndiaDailyBars, refreshIndiaIndexCache } from "../scripts/refresh-india-daily-bars.mjs";

function barsThrough(date, count = 260) {
  const end = new Date(`${date}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - (count - 1 - index));
    const close = 100 + index;
    return {
      date: d.toISOString().slice(0, 10),
      open: close - 1,
      high: close + 1,
      low: close - 2,
      close,
      adjusted_close: close,
      volume: 1000 + index,
      turnover: close * (1000 + index),
      trades: 100,
      delivery_quantity: 0,
      delivery_pct: 0
    };
  });
}

async function seedRecord(cacheRoot, {
  exchange = "NSE",
  symbol = "RELIANCE",
  series = "EQ",
  provider = "NSE_OFFICIAL_BHAVCOPY",
  dataAsOf = "2026-06-22"
} = {}) {
  await saveSymbol(cacheRoot, {
    schema_version: "3.0",
    market: "INDIA",
    exchange,
    symbol,
    series,
    currency: "INR",
    interval: "1d",
    provider,
    endpoint: "seed",
    retrieved_at: "2026-06-23T00:00:00.000Z",
    data_as_of: dataAsOf,
    adjustment_status: "UNADJUSTED_RAW_CORPORATE_ACTION_REVIEW_REQUIRED",
    delayed_or_live: "EOD",
    fallback_label: provider.includes("OFFICIAL") ? "OFFICIAL_VERIFIED" : "FREE_PRIMARY",
    bars: barsThrough(dataAsOf)
  });
}

assert.equal(latestCompletedIndiaSession(new Date("2026-06-24T03:30:00Z")), "2026-06-23");
assert.equal(latestCompletedIndiaSession(new Date("2026-06-22T03:00:00Z")), "2026-06-19");
assert.equal(latestCompletedIndiaSession(new Date("2026-06-27T04:00:00Z")), "2026-06-25");

const directory = await mkdtemp(join(tmpdir(), "aurora-india-refresh-"));
const cacheRoot = join(directory, "cache");
const rawRoot = join(directory, "raw");
const reportPath = join(directory, "report.json");
const sourceRoot = join(directory, "incoming");
await seedRecord(cacheRoot);
await mkdir(sourceRoot, { recursive: true });
await writeFile(join(sourceRoot, "bhav.csv"), `SYMBOL,SERIES,DATE1,OPEN_PRICE,HIGH_PRICE,LOW_PRICE,CLOSE_PRICE,TTL_TRD_QNTY,TOTTRDVAL,NO_OF_TRADES
RELIANCE,EQ,23-JUN-2026,360,365,355,362,2000,724000,125`);

const official = await appendOfficialSource({
  sourceRoot,
  expectedSession: "2026-06-23",
  cacheRoot,
  rawRoot,
  retrievedAt: "2026-06-24T00:00:00.000Z"
});
assert.equal(official.inserted, 1);
assert.equal((await loadSymbol(cacheRoot, "NSE", "RELIANCE")).data_as_of, "2026-06-23");

const invalidZipDir = await mkdtemp(join(tmpdir(), "aurora-india-invalid-zip-"));
await seedRecord(join(invalidZipDir, "cache"));
await mkdir(join(invalidZipDir, "incoming"), { recursive: true });
await writeFile(join(invalidZipDir, "incoming", "EQ_ISINCODE_230626.zip"), "not a real zip", "utf8");
const invalidZipAttempt = await appendOfficialSource({
  sourceRoot: join(invalidZipDir, "incoming"),
  expectedSession: "2026-06-23",
  cacheRoot: join(invalidZipDir, "cache"),
  rawRoot: join(invalidZipDir, "raw"),
  retrievedAt: "2026-06-24T00:00:00.000Z"
});
assert.equal(invalidZipAttempt.inserted, 0);
assert.equal(invalidZipAttempt.source_files[0].warning, "INVALID_ZIP_SKIPPED");

const blockedDir = await mkdtemp(join(tmpdir(), "aurora-india-blocked-"));
await seedRecord(join(blockedDir, "cache"));
await mkdir(join(blockedDir, "data"), { recursive: true });
const blockedReportPath = join(blockedDir, "data", "india-daily-refresh-report.json");
const lastGoodScanPath = join(blockedDir, "data", "india-full-dashboard-scan.json");
await writeFile(lastGoodScanPath, JSON.stringify({
  data_as_of: "2026-06-22",
  generated_at: "2026-06-23T00:00:00.000Z",
  market_context: { label: "MARKET_UNDER_PRESSURE" },
  weekly_universe: [{ symbol: "RAIN", exchange: "NSE", user_note: "last-good weekly note" }],
  daily_top_1_4: [{ symbol: "SANSERA", exchange: "NSE", user_note: "last-good daily note" }],
  rsle_top20: [{ symbol: "DEEPAKFERT", exchange: "NSE", user_note: "last-good RSLE note" }],
  developing_watchlist_20: [{ symbol: "SYRMA", exchange: "NSE", user_note: "last-good developing note" }],
  sector_rrg: [{ sector: "Capital Goods", quadrant: "IMPROVING" }]
}), "utf8");
await assert.rejects(
  refreshIndiaDailyBars({
    cacheRoot: join(blockedDir, "cache"),
    rawRoot: join(blockedDir, "raw"),
    reportPath: blockedReportPath,
    lastGoodScanPath,
    expectedSession: "2026-06-23",
    localSources: [],
    tryOfficialFetch: false,
    providerOrder: []
  }),
  /DATA_REFRESH_BLOCKED/
);
const blockedReport = JSON.parse(await readFile(blockedReportPath, "utf8"));
assert.equal(blockedReport.status, "DATA_REFRESH_BLOCKED");
assert.equal(blockedReport.fallback_decision_pack.status, "LAST_GOOD_DECISION_PACK");
assert.equal(blockedReport.fallback_decision_pack.daily_top_1_4[0].symbol, "SANSERA");
assert.equal(blockedReport.fallback_decision_pack.rsle_top20[0].symbol, "DEEPAKFERT");

const yahooDir = await mkdtemp(join(tmpdir(), "aurora-india-yahoo-"));
await seedRecord(join(yahooDir, "cache"));
await seedRecord(join(yahooDir, "cache"), {
  exchange: "BSE",
  symbol: "07AGG",
  series: "F",
  provider: "BSE_OFFICIAL_BHAVCOPY"
});
const yahooFetch = async url => {
  assert.match(url, /RELIANCE\.NS/);
  return new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: [Math.floor(new Date("2026-06-23T10:00:00Z").valueOf() / 1000)],
        indicators: { quote: [{ open: [360], high: [365], low: [355], close: [362], volume: [2000] }] }
      }]
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
};
let fallback = await appendProviderConsistentFallback({
  provider: "YAHOO",
  expectedSession: "2026-06-23",
  cacheRoot: join(yahooDir, "cache"),
  fetcher: yahooFetch,
  allowProviderRepair: false,
  maxSymbols: 1
});
assert.equal(fallback.skipped_no_blend, 1);
fallback = await appendProviderConsistentFallback({
  provider: "YAHOO",
  expectedSession: "2026-06-23",
  cacheRoot: join(yahooDir, "cache"),
  fetcher: yahooFetch,
  allowProviderRepair: true,
  maxSymbols: 1
});
assert.equal(fallback.inserted, 1);
assert.equal((await loadSymbol(join(yahooDir, "cache"), "NSE", "RELIANCE")).provider, "YAHOO_DATA_REPAIR");
assert.equal((await loadSymbol(join(yahooDir, "cache"), "BSE", "07AGG")).data_as_of, "2026-06-22");

const fetchOnceDir = await mkdtemp(join(tmpdir(), "aurora-india-fetch-once-"));
await seedRecord(join(fetchOnceDir, "cache"), { provider: "YAHOO_DAILY" });
const fetchOnceCalls = [];
const fetchOnceReport = await refreshIndiaDailyBars({
  cacheRoot: join(fetchOnceDir, "cache"),
  rawRoot: join(fetchOnceDir, "raw"),
  reportPath: join(fetchOnceDir, "report.json"),
  expectedSession: "2026-06-23",
  localSources: [],
  tryOfficialFetch: false,
  providerOrder: ["YAHOO", "TAPETIDE"],
  fetcher: async url => {
    fetchOnceCalls.push(url);
    assert.match(url, /RELIANCE\.NS/);
    return new Response(JSON.stringify({
      chart: {
        result: [{
          timestamp: [Math.floor(new Date("2026-06-23T10:00:00Z").valueOf() / 1000)],
          indicators: { quote: [{ open: [360], high: [365], low: [355], close: [362], volume: [2000] }] }
        }]
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
});
assert.equal(fetchOnceReport.provider, "YAHOO");
assert.equal(fetchOnceReport.attempts.length, 1);
assert.equal(fetchOnceCalls.length, 1);
assert.equal((await loadSymbol(join(fetchOnceDir, "cache"), "NSE", "RELIANCE")).data_as_of, "2026-06-23");

const prefetchDir = await mkdtemp(join(tmpdir(), "aurora-india-prefetch-"));
await seedRecord(join(prefetchDir, "cache"), { provider: "TAPETIDE_DAILY" });
const prefetchPath = join(prefetchDir, "prefetch.json");
await writeFile(prefetchPath, JSON.stringify({
  expected_session: "2026-06-23",
  bars: [{
    provider: "TAPETIDE",
    exchange: "NSE",
    symbol: "RELIANCE",
    endpoint: "CONNECTOR_PREFETCH:tapetide",
    bar: { date: "2026-06-23", open: 360, high: 365, low: 355, close: 362, volume: 2000 }
  }]
}), "utf8");
fallback = await appendProviderConsistentFallback({
  provider: "TAPETIDE",
  expectedSession: "2026-06-23",
  cacheRoot: join(prefetchDir, "cache"),
  connectorPrefetchPath: prefetchPath,
  fetcher: async () => {
    throw new Error("FETCHER_SHOULD_NOT_BE_CALLED_FOR_PREFETCHED_BAR");
  }
});
assert.equal(fallback.inserted, 1);
assert.equal((await loadSymbol(join(prefetchDir, "cache"), "NSE", "RELIANCE")).endpoint, "CONNECTOR_PREFETCH:tapetide");

const tapetideDir = await mkdtemp(join(tmpdir(), "aurora-india-tapetide-"));
await seedRecord(join(tapetideDir, "cache"), { provider: "TAPETIDE_DAILY" });
const oldTapetideToken = process.env.TAPETIDE_TOKEN;
process.env.TAPETIDE_TOKEN = "tapetide-secret";
const tapetideFetch = async (url, options) => {
  assert.equal(url, "https://mcp.tapetide.com/mcp");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.authorization, "Bearer tapetide-secret");
  const body = JSON.parse(options.body);
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.name, "get_price_history");
  assert.deepEqual(body.params.arguments, {
    symbol: "RELIANCE",
    exchange: "NSE",
    interval: "daily",
    from: "2026-06-23",
    to: "2026-06-23"
  });
  return new Response(JSON.stringify({
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({ data: [{ date: "2026-06-23", open: 360, high: 365, low: 355, close: 362, volume: 2000 }] })
      }]
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
};
fallback = await appendProviderConsistentFallback({
  provider: "TAPETIDE",
  expectedSession: "2026-06-23",
  cacheRoot: join(tapetideDir, "cache"),
  fetcher: tapetideFetch
});
assert.equal(fallback.inserted, 1);
assert.equal((await loadSymbol(join(tapetideDir, "cache"), "NSE", "RELIANCE")).endpoint, "https://mcp.tapetide.com/mcp");
if (oldTapetideToken === undefined) delete process.env.TAPETIDE_TOKEN;
else process.env.TAPETIDE_TOKEN = oldTapetideToken;

const eodhdDir = await mkdtemp(join(tmpdir(), "aurora-india-eodhd-"));
await seedRecord(join(eodhdDir, "cache"), { provider: "EODHD_DAILY" });
const oldToken = process.env.EODHD_API_TOKEN;
process.env.EODHD_API_TOKEN = "secret-token";
const eodhdCalls = [];
const eodhdFetch = async url => {
  eodhdCalls.push(url);
  assert.match(url, /api_token=secret-token/);
  if (/RELIANCE\.NSE/.test(url)) return new Response(JSON.stringify({ message: "ticker not found" }), { status: 404 });
  assert.match(url, /RELIANCE\.XNSE/);
  return new Response(JSON.stringify([{ date: "2026-06-23", open: 360, high: 365, low: 355, close: 362, adjusted_close: 362, volume: 2000 }]), { status: 200 });
};
fallback = await appendProviderConsistentFallback({
  provider: "EODHD",
  expectedSession: "2026-06-23",
  cacheRoot: join(eodhdDir, "cache"),
  fetcher: eodhdFetch
});
assert.equal(fallback.inserted, 1);
assert.equal(eodhdCalls.length, 2);
const eodhdRecord = await loadSymbol(join(eodhdDir, "cache"), "NSE", "RELIANCE");
assert.doesNotMatch(eodhdRecord.endpoint, /secret-token/);
assert.match(eodhdRecord.endpoint, /RELIANCE\.XNSE/);
if (oldToken === undefined) delete process.env.EODHD_API_TOKEN;
else process.env.EODHD_API_TOKEN = oldToken;

const indexDir = await mkdtemp(join(tmpdir(), "aurora-india-index-refresh-"));
const indexRoot = join(indexDir, "indices");
await mkdir(indexRoot, { recursive: true });
await writeFile(join(indexRoot, "NIFTY500.json"), JSON.stringify({
  schema_version: "3.0",
  market: "INDIA",
  asset_type: "INDEX",
  exchange: "INDX",
  symbol: "NIFTY500",
  name: "NIFTY 500",
  currency: "INR",
  interval: "1d",
  provider: "EODHD",
  endpoint: "seed",
  retrieved_at: "2026-06-23T00:00:00.000Z",
  data_as_of: "2026-06-22",
  adjustment_status: "EODHD_ADJUSTED_CLOSE_PRESENT",
  delayed_or_live: "EOD",
  fallback_label: "EODHD_FALLBACK",
  bars: barsThrough("2026-06-22")
}), "utf8");
const indexFetchCalls = [];
const indexReport = await refreshIndiaIndexCache({
  indexRoot,
  expectedSession: "2026-06-23",
  fetcher: async url => {
    indexFetchCalls.push(url);
    assert.match(url, /ind_close_all_23062026\.csv/);
    return new Response(`Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Volume,Turnover (Rs. Cr.)
Nifty 500,23-06-2026,25000,25100,24900,25050,123456,7890`, { status: 200 });
  }
});
const refreshedIndex = JSON.parse(await readFile(join(indexRoot, "NIFTY500.json"), "utf8"));
assert.equal(indexReport.status, "UPDATED");
assert.equal(indexReport.updated, 1);
assert.equal(indexFetchCalls.length, 1);
assert.equal(refreshedIndex.provider, "NSE_OFFICIAL_INDEX_ARCHIVE");
assert.equal(refreshedIndex.data_as_of, "2026-06-23");

await rm(directory, { recursive: true, force: true });
await rm(invalidZipDir, { recursive: true, force: true });
await rm(blockedDir, { recursive: true, force: true });
await rm(yahooDir, { recursive: true, force: true });
await rm(fetchOnceDir, { recursive: true, force: true });
await rm(prefetchDir, { recursive: true, force: true });
await rm(tapetideDir, { recursive: true, force: true });
await rm(eodhdDir, { recursive: true, force: true });
await rm(indexDir, { recursive: true, force: true });
console.log("India daily refresh contract tests passed");
