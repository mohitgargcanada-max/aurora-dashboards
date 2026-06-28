const EODHD_EOD_BASE = "https://eodhd.com/api/eod";

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
  const token = process.env.EODHD_API_TOKEN;
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
