import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CANADA_PROFILE } from "../engine/canada-adapter.mjs";
import { readJson, writeJson } from "../engine/cache-store.mjs";
import { fetchYahooDaily } from "../engine/yahoo-client.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const universePath = resolve(root, "config/canada-universe-seed.json");
const ohlcvRoot = resolve(root, "cache/canada/ohlcv");
const dataRoot = resolve(root, "data");
const universe = await readJson(universePath, []);
const attempts = [];
await mkdir(ohlcvRoot, { recursive: true });
for (const item of universe) {
  try {
    const record = await fetchYahooDaily(item.symbol, { range: "5y", currency: CANADA_PROFILE.currency });
    await writeJson(resolve(ohlcvRoot, `${item.symbol.replaceAll("/", "_")}.json`), { ...record, name: item.name, exchange: item.exchange, sector: item.sector });
    attempts.push({ symbol: item.symbol, status: "OK", provider: record.provider, data_as_of: record.data_as_of });
  } catch (error) {
    attempts.push({ symbol: item.symbol, status: "FAILED", provider: "YAHOO_FINANCE", warning: error.message });
  }
}
await writeJson(resolve(dataRoot, "canada-daily-refresh-report.json"), {
  market: "CANADA",
  status: attempts.some(x => x.status === "OK") ? "REFRESH_ATTEMPTED" : "DATA_REFRESH_BLOCKED",
  retrieved_at: new Date().toISOString(),
  provider_route: ["YAHOO_FINANCE", "EODHD_FALLBACK_NOT_IMPLEMENTED_NOT_TESTED"],
  attempts
});
