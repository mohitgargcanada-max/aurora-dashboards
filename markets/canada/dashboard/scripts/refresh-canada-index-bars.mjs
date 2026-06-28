import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CANADA_PROFILE } from "../engine/canada-adapter.mjs";
import { writeJson } from "../engine/cache-store.mjs";
import { fetchCanadaDaily } from "../engine/canada-data-provider.mjs";
import { latestCompletedCanadaSession } from "../engine/trading-calendar.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const indexRoot = resolve(root, "cache/canada/indices");
const dataRoot = resolve(root, "data");
const expectedSession = process.argv[2] || process.env.AURORA_TARGET_SESSION || latestCompletedCanadaSession();
const indexSymbols = [...new Set([CANADA_PROFILE.benchmark_primary, CANADA_PROFILE.benchmark_growth, CANADA_PROFILE.benchmark_breadth, ...CANADA_PROFILE.risk_on_proxies, ...Object.values(CANADA_PROFILE.sector_proxy_map)])];
const attempts = [];
await mkdir(indexRoot, { recursive: true });
for (const symbol of indexSymbols) {
  try {
    const { record, attempts: symbolAttempts } = await fetchCanadaDaily(symbol, { range: "5y", currency: CANADA_PROFILE.currency, expectedSession, type: "INDEX" });
    await writeJson(resolve(indexRoot, `${symbol.replaceAll("/", "_")}.json`), record);
    attempts.push(...symbolAttempts.map(a => ({ symbol, ...a })));
  } catch (error) {
    attempts.push({ symbol, status: "FAILED", provider: "YAHOO_FINANCE_EODHD_ROUTE", warning: error.message, type: "INDEX" });
  }
}
await writeJson(resolve(dataRoot, "canada-index-refresh-report.json"), { market: "CANADA", status: attempts.some(x => x.status === "OK") ? "INDEX_REFRESH_ATTEMPTED" : "DATA_STALE_INDEX_BLOCKED", expected_completed_session: expectedSession, retrieved_at: new Date().toISOString(), provider_route: ["YAHOO_FINANCE", "EODHD_FALLBACK"], attempts });
