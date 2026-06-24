import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const statePath = resolve(root, "data/us-dashboard-state.json");
const configPath = resolve(root, "config/gics_sector_proxy_map.json");
const cacheDir = resolve(root, "cache/us/fundamentals");
const cachePath = resolve(cacheDir, "sector-classification.json");
const DAY_MS = 86_400_000;
const STALE_DAYS = 90;
const REQUEST_TIMEOUT_MS = 6000;
const BATCH_SIZE = 8;

const now = new Date();
const normalizeSymbol = symbol => symbol.replace(/\./g, "-");

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return fallback; }
}

function normalizeSector(sector, config) {
  if (!sector) return "GICS_UNKNOWN";
  return config.sector_aliases[sector] || sector;
}

function isFresh(row) {
  if (!row?.retrieved_at) return false;
  return now - new Date(row.retrieved_at) < STALE_DAYS * DAY_MS;
}

function collectSymbols(state) {
  const symbols = new Set();
  for (const list of [
    state.core,
    state.weekly_focus,
    state.daily_top,
    state.developing_watchlist_20,
    state.rs_leadership?.top20_tactical,
    state.rs_leadership?.developing_21_40,
    state.rs_leadership?.top20
  ]) {
    for (const row of list || []) if (row?.ticker) symbols.add(row.ticker);
  }
  return [...symbols].sort();
}

async function fetchYahooClassification(symbol, config) {
  const yahooSymbol = normalizeSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=assetProfile,price`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json", "user-agent": "Mozilla/5.0 AURORA/2.18.3" } }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const payload = await response.json();
  const result = payload?.quoteSummary?.result?.[0];
  if (!result) throw new Error(payload?.quoteSummary?.error?.code || "BAD_PAYLOAD");
  const sectorRaw = result.assetProfile?.sector || null;
  const industry = result.assetProfile?.industry || null;
  const sector = normalizeSector(sectorRaw, config);
  return {
    ticker: symbol,
    provider: "YAHOO_FINANCE",
    endpoint: "quoteSummary(assetProfile,price)",
    retrieved_at: now.toISOString(),
    data_as_of: now.toISOString().slice(0, 10),
    fallback_label: "FREE_ENRICHMENT",
    classification_system: config.classification_system,
    gics_sector: sector,
    main_industry: industry || "INDUSTRY_UNKNOWN",
    sub_industry: "SUB_INDUSTRY_UNKNOWN",
    theme_primary: sector,
    classification_status: sector === "GICS_UNKNOWN" ? "UNKNOWN" : "PARTIAL_YAHOO_SECTOR_INDUSTRY",
    warnings: industry ? [] : ["sub_industry_not_available_from_yahoo_assetProfile"]
  };
}

const [state, config] = await Promise.all([
  readJson(statePath, null),
  readJson(configPath, null)
]);
if (!state) throw new Error(`Missing state file: ${statePath}`);
if (!config) throw new Error(`Missing GICS sector config: ${configPath}`);

await mkdir(cacheDir, { recursive: true });
const cache = await readJson(cachePath, {
  schema_version: "1.0",
  provider_order: ["YAHOO_FINANCE_FREE_ENRICHMENT", "EODHD_FALLBACK_ONLY_IF_REQUIRED"],
  generated_at: null,
  classifications: {}
});

const symbols = collectSymbols(state);
const attempted = [];
const failed = [];
const staleSymbols = symbols.filter(symbol => !isFresh(cache.classifications[symbol]));
for (let offset = 0; offset < staleSymbols.length; offset += BATCH_SIZE) {
  const batch = staleSymbols.slice(offset, offset + BATCH_SIZE);
  const rows = await Promise.all(batch.map(async symbol => {
    try {
      return [symbol, await fetchYahooClassification(symbol, config), null];
    } catch (error) {
      return [symbol, null, error];
    }
  }));
  for (const [symbol, row, error] of rows) {
    if (row) {
      cache.classifications[symbol] = row;
      attempted.push(symbol);
      continue;
    }
    failed.push({ symbol, reason: error.message });
    cache.classifications[symbol] = {
      ticker: symbol,
      provider: "NOT_AVAILABLE",
      endpoint: "quoteSummary(assetProfile,price)",
      retrieved_at: now.toISOString(),
      data_as_of: now.toISOString().slice(0, 10),
      fallback_label: "NOT_AVAILABLE",
      classification_system: config.classification_system,
      gics_sector: "GICS_UNKNOWN",
      main_industry: "INDUSTRY_UNKNOWN",
      sub_industry: "SUB_INDUSTRY_UNKNOWN",
      theme_primary: "GICS_UNKNOWN",
      classification_status: "UNKNOWN",
      warnings: [`yahoo_assetProfile_failed:${error.message}`]
    };
  }
}

cache.generated_at = now.toISOString();
cache.symbol_scope = "WEEKLY_UNIVERSE_WEEKLY_FOCUS_DAILY_TOP_RSLE_TOP20_RSLE_DEVELOPING_DEVELOPING20";
cache.symbol_count = symbols.length;
cache.gics_reference = {
  sector_proxy_map: config.sector_proxy_map,
  missing_policy: config.missing_policy
};

const temp = `${cachePath}.tmp`;
await writeFile(temp, JSON.stringify(cache, null, 2), "utf8");
await rename(temp, cachePath);
console.log(JSON.stringify({ scope: symbols.length, fetched_or_refreshed: attempted.length, failed: failed.length, failed_symbols: failed.slice(0, 10) }));
