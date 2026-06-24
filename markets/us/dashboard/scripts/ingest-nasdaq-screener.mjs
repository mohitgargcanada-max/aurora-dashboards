import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const input = process.argv[2];
if (!input) throw new Error("Usage: node scripts/ingest-nasdaq-screener.mjs /path/to/nasdaq-screener.json-or-csv");

const config = JSON.parse(await readFile(resolve(root, "config/gics_sector_proxy_map.json"), "utf8"));
const cacheDir = resolve(root, "cache/us/fundamentals");
const cachePath = resolve(cacheDir, "sector-classification.json");
const now = new Date().toISOString();

function normalizeSector(sector) {
  if (!sector) return "GICS_UNKNOWN";
  return config.sector_aliases[sector] || sector;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quoted && ch === '"' && next === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && ch === ",") { row.push(cell); cell = ""; continue; }
    if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift().map(x => x.trim().toLowerCase());
  return rows.map(values => Object.fromEntries(headers.map((header, i) => [header, values[i] || ""])));
}

function rowsFromPayload(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const payload = JSON.parse(extractJsonObject(trimmed));
    return payload.data?.rows || [];
  }
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return parseCsv(text);
}

function extractJsonObject(text) {
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
  return text;
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase().replace(/\^/g, "-").replace(/\./g, "-");
}

await mkdir(cacheDir, { recursive: true });
let cache;
try {
  cache = JSON.parse(await readFile(cachePath, "utf8"));
} catch {
  cache = {
    schema_version: "1.0",
    provider_order: ["NASDAQ_SCREENER_DOWNLOAD", "YAHOO_FINANCE_FREE_ENRICHMENT", "EODHD_FALLBACK_ONLY_IF_REQUIRED"],
    generated_at: null,
    classifications: {}
  };
}

const rows = rowsFromPayload(await readFile(input, "utf8"));
let mapped = 0;
for (const row of rows) {
  const ticker = normalizeSymbol(row.symbol || row.Symbol);
  if (!ticker) continue;
  const sector = normalizeSector(row.sector || row.Sector);
  const industry = row.industry || row.Industry || "INDUSTRY_UNKNOWN";
  if (sector === "GICS_UNKNOWN" && !industry) continue;
  cache.classifications[ticker] = {
    ticker,
    provider: "NASDAQ",
    endpoint: "api/screener/stocks download",
    retrieved_at: now,
    data_as_of: now.slice(0, 10),
    fallback_label: "FREE_PRIMARY_CLASSIFICATION",
    classification_system: config.classification_system,
    gics_sector: sector,
    main_industry: industry || "INDUSTRY_UNKNOWN",
    sub_industry: "SUB_INDUSTRY_UNKNOWN",
    theme_primary: sector,
    classification_status: sector === "GICS_UNKNOWN" ? "UNKNOWN" : "PARTIAL_NASDAQ_SECTOR_INDUSTRY",
    warnings: ["sub_industry_not_available_from_nasdaq_screener"]
  };
  mapped++;
}

cache.generated_at = now;
cache.symbol_scope = "NASDAQ_SCREENER_DOWNLOAD";
cache.symbol_count = Object.keys(cache.classifications).length;
cache.gics_reference = {
  sector_proxy_map: config.sector_proxy_map,
  missing_policy: config.missing_policy
};

const temp = `${cachePath}.tmp`;
await writeFile(temp, JSON.stringify(cache, null, 2), "utf8");
await rename(temp, cachePath);
console.log(JSON.stringify({ input_rows: rows.length, mapped_from_input: mapped, total_cache_symbols: cache.symbol_count }));
