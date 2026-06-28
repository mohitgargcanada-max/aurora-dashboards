const EODHD_EOD_BASE = "https://eodhd.com/api/eod";
const EODHD_TOKEN_ALIASES = [
  "EODHD_API_TOKEN",
  "EODHD_API_KEY",
  "EODHD_API",
  "EODHD_TOKEN",
  "EODHD_KEY",
  "EODHD",
  "EODHD_TOKEN_VALUE",
  "EODHD_SECRET",
  "EODHD_CREDENTIAL",
  "EOD_API_TOKEN",
  "EOD_API_KEY",
  "EOD_TOKEN",
  "EOD_KEY",
  "EOD",
  "EOD_HISTORICAL_DATA_API_KEY",
  "EOD_HISTORICAL_DATA_API_TOKEN",
  "EOD_HISTORICAL_DATA_TOKEN",
  "EOD_HISTORICAL_DATA_KEY",
  "EOD_HISTORICAL_DATA",
  "EODH_API_KEY",
  "EODH_TOKEN",
  "EODH_KEY",
  "EODHD_APIKEY",
  "EODHDAPIKEY",
  "EODHDTOKEN"
];
const IDENTITY_FIELDS = ["name", "provider", "service", "source", "connector", "id", "key"];
const VALUE_FIELDS = ["value", "secret", "token", "api_token", "apiToken", "api_key", "apiKey", "credential", "key"];

function ymdYearsAgo(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function parseSymbolOverrides() {
  const raw = process.env.EODHD_CANADA_SYMBOL_MAP_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeKey(key) {
  return String(key || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isCredentialKey(key) {
  const normalized = normalizeKey(key);
  const aliases = EODHD_TOKEN_ALIASES.map(normalizeKey);
  if (aliases.some(alias => normalized === alias || normalized.endsWith(alias))) return true;
  const namesEodhd = normalized.includes("EODHD") || normalized.includes("EODHISTORICALDATA") || normalized.includes("EOD");
  const namesSecret = ["API", "TOKEN", "KEY", "SECRET", "CREDENTIAL"].some(part => normalized.includes(part));
  return namesEodhd && namesSecret;
}

function primitiveValue(value) {
  return value === null || value === undefined || typeof value === "object" ? "" : String(value);
}

function addStructuredSecretAlias(value, out) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const identity = IDENTITY_FIELDS.map(field => primitiveValue(value[field])).find(Boolean);
  if (!identity || !isCredentialKey(identity)) return;
  const secret = VALUE_FIELDS.map(field => primitiveValue(value[field])).find(Boolean);
  if (secret) out[identity] = secret;
}

function flattenObject(value, prefix = "", out = {}) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenObject(item, prefix ? `${prefix}_${index}` : String(index), out));
    return out;
  }
  addStructuredSecretAlias(value, out);
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}_${key}` : key;
    if (item && typeof item === "object") flattenObject(item, path, out);
    else out[path] = item;
  }
  return out;
}

function unquote(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function expandEmbeddedBundles(out) {
  const expanded = { ...out };
  for (const value of Object.values(out)) {
    const text = primitiveValue(value).trim();
    if (!text || !/EOD/i.test(text) || !/[{=:\n]/.test(text)) continue;
    for (const [key, embedded] of Object.entries(parseAuroraKeys(text))) {
      if (embedded && isCredentialKey(key)) expanded[key] ??= embedded;
    }
  }
  return expanded;
}

export function parseAuroraKeys(raw = process.env.AURORAKEYS) {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string" && parsed.trim()) return { EODHD: parsed.trim() };
    if (parsed && typeof parsed === "object") return expandEmbeddedBundles(flattenObject(parsed));
  } catch {
    // Fall through to dotenv-style parsing.
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/i, "");
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    const colonIndex = trimmed.indexOf(":");
    const index = equalsIndex > 0 ? equalsIndex : colonIndex > 0 ? colonIndex : -1;
    if (index <= 0) {
      const [key, ...rest] = trimmed.split(/\s+/);
      if (rest.length && isCredentialKey(key)) out[key] = unquote(rest.join(" "));
      continue;
    }
    out[trimmed.slice(0, index).trim()] = unquote(trimmed.slice(index + 1));
  }
  if (!Object.keys(out).length && !/\s/.test(text)) return { EODHD: text };
  return expandEmbeddedBundles(out);
}

export function resolveEodhdToken(env = process.env) {
  if (env.EODHD_API_TOKEN) return String(env.EODHD_API_TOKEN);
  if (env.EODHD_API_KEY) return String(env.EODHD_API_KEY);
  const bundled = parseAuroraKeys(env.AURORAKEYS);
  if (bundled.EODHD_API_TOKEN) return String(bundled.EODHD_API_TOKEN);
  if (bundled.EODHD_API_KEY) return String(bundled.EODHD_API_KEY);
  for (const [key, value] of Object.entries(bundled)) {
    if (value && isCredentialKey(key)) return String(value);
  }
  return "";
}

export function mapYahooToEodhdSymbol(symbol, exchange = "") {
  const overrides = parseSymbolOverrides();
  if (overrides[symbol]) return overrides[symbol];
  if (symbol === "^GSPTSE") return "GSPTSE.INDX";
  if (symbol.startsWith("^")) return `${symbol.slice(1)}.INDX`;
  if (symbol.endsWith(".TO") || symbol.endsWith(".V")) return symbol;
  if (exchange === "TSXV") return `${symbol}.V`;
  if (exchange === "TSX" || exchange === "NEO" || exchange === "CSE") return `${symbol}.TO`;
  return symbol;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeBar(row) {
  const date = typeof row?.date === "string" ? row.date.slice(0, 10) : null;
  const rawOpen = finiteNumber(row?.open);
  const rawHigh = finiteNumber(row?.high);
  const rawLow = finiteNumber(row?.low);
  const rawClose = finiteNumber(row?.close);
  const adjustedClose = finiteNumber(row?.adjusted_close ?? row?.adjustedClose);
  const volume = finiteNumber(row?.volume) ?? 0;
  if (!date || ![rawOpen, rawHigh, rawLow, rawClose].every(Number.isFinite)) return null;
  const useAdjusted = Number.isFinite(adjustedClose) && adjustedClose > 0 && rawClose > 0;
  const factor = useAdjusted ? adjustedClose / rawClose : 1;
  return {
    date,
    open: rawOpen * factor,
    high: rawHigh * factor,
    low: rawLow * factor,
    close: useAdjusted ? adjustedClose : rawClose,
    raw_open: rawOpen,
    raw_high: rawHigh,
    raw_low: rawLow,
    raw_close: rawClose,
    adjusted_close: useAdjusted ? adjustedClose : null,
    volume,
    provider: "EODHD"
  };
}

export function normalizeEodhdDaily(requestedSymbol, payload, {
  mappedSymbol = requestedSymbol,
  currency = "CAD",
  fallback_reason = "EODHD_FALLBACK_AFTER_YAHOO_FAILURE",
  warnings = []
} = {}) {
  if (!Array.isArray(payload)) {
    const message = payload?.message || payload?.error || "EODHD returned non-array payload";
    throw new Error(`${requestedSymbol}: ${message}`);
  }
  const bars = payload.map(normalizeBar).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  const unique = [];
  const seen = new Set();
  for (const bar of bars) {
    if (seen.has(bar.date)) continue;
    seen.add(bar.date);
    unique.push(bar);
  }
  if (!unique.length) throw new Error(`${requestedSymbol}: EODHD returned no valid OHLCV bars`);
  return {
    symbol: requestedSymbol,
    provider_symbol: mappedSymbol,
    provider: "EODHD",
    endpoint: `eod/${mappedSymbol}`,
    retrieved_at: new Date().toISOString(),
    data_as_of: unique.at(-1).date,
    currency,
    adjustment_status: unique.some(b => b.adjusted_close !== null) ? "ADJUSTED_OHLCV_FROM_ADJUSTED_CLOSE_RATIO" : "UNADJUSTED_OHLCV",
    delayed_or_live: "DELAYED_EOD",
    fallback_reason,
    warnings,
    bars: unique
  };
}

export async function fetchEodhdDaily(symbol, {
  exchange = "",
  from = ymdYearsAgo(5),
  to = new Date().toISOString().slice(0, 10),
  currency = "CAD",
  fallback_reason = "EODHD_FALLBACK_AFTER_YAHOO_FAILURE",
  warnings = []
} = {}) {
  const token = resolveEodhdToken();
  if (!token) throw new Error(`${symbol}: EODHD_API_TOKEN missing; fallback unavailable`);
  const mappedSymbol = mapYahooToEodhdSymbol(symbol, exchange);
  const url = new URL(`${EODHD_EOD_BASE}/${encodeURIComponent(mappedSymbol)}`);
  url.searchParams.set("api_token", token);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("period", "d");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const response = await fetch(url, { headers: { "User-Agent": "aurora-canada-dashboard/1.0" } });
  if (!response.ok) throw new Error(`${symbol}: EODHD HTTP ${response.status}`);
  const payload = await response.json();
  return normalizeEodhdDaily(symbol, payload, { mappedSymbol, currency, fallback_reason, warnings });
}
