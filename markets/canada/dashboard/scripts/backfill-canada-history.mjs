import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CANADA_PROFILE } from "../engine/canada-adapter.mjs";
import { readJson, writeJson } from "../engine/cache-store.mjs";
import { fetchYahooDaily } from "../engine/yahoo-client.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const universePath = resolve(root, "config/canada-universe-seed.json");
const ohlcvRoot = resolve(root, "cache/canada/ohlcv");
const indexRoot = resolve(root, "cache/canada/indices");
const dataRoot = resolve(root, "data");
const universe = await readJson(universePath, []);
const indexSymbols = [...new Set([CANADA_PROFILE.benchmark_primary, CANADA_PROFILE.benchmark_growth, CANADA_PROFILE.benchmark_breadth, ...CANADA_PROFILE.risk_on_proxies, ...Object.values(CANADA_PROFILE.sector_proxy_map)])];
const attempts = [];
await mkdir(ohlcvRoot, { recursive: true });
await mkdir(indexRoot, { recursive: true });
for (const item of universe) {
  try {
    const record = await fetchYahooDaily(item.symbol, { range: "5y", currency: CANADA_PROFILE.currency });
    await writeJson(resolve(ohlcvRoot, `${item.symbol.replaceAll("/", "_")}.json`), { ...record, name: item.name, exchange: item.exchange, sector: item.sector });
    attempts.push({ symbol: item.symbol, status: "OK", provider: record.provider, data_as_of: record.data_as_of });
  } catch (error) {
    attempts.push({ symbol: item.symbol, status: "FAILED", provider: "YAHOO_FINANCE", warning: error.message });
  }
}
for (const symbol of indexSymbols) {
  try {
    const record = await fetchYahooDaily(symbol, { range: "5y", currency: CANADA_PROFILE.currency });
    await writeJson(resolve(indexRoot, `${symbol.replaceAll("/", "_")}.json`), record);
    attempts.push({ symbol, status: "OK", provider: record.provider, data_as_of: record.data_as_of, type: "INDEX" });
  } catch (error) {
    attempts.push({ symbol, status: "FAILED", provider: "YAHOO_FINANCE", type: "INDEX", warning: error.message });
  }
}
await writeJson(resolve(dataRoot, "canada-daily-refresh-report.json"), {
  market: "CANADA",
  status: attempts.some(x => x.status === "OK") ? "REFRESH_ATTEMPTED" : "DATA_REFRESH_BLOCKED",
  retrieved_at: new Date().toISOString(),
  provider_route: ["YAHOO_FINANCE", "EODHD_FALLBACK_NOT_USED"],
  attempts
});
