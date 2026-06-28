import { normalizeSymbol } from "../engine/cache-store.mjs";

const ETF_SYMBOLS = new Set([
  "SPY", "QQQ", "DIA", "IWM", "IWB", "MDY", "IJR", "IWV", "SMH", "ARKK", "IBIT",
  "XLK", "XLF", "XLI", "XLE", "XLY", "XLP", "XLV", "XLU", "XLC", "XLB", "XLRE"
]);

export const TECHNICAL_ELIGIBLE_TYPES = new Set(["COMMON_STOCK", "ADR"]);
const EODHD_UNSUPPORTED_TYPES = new Set(["ETF", "ETN", "CEF", "PREFERRED", "WARRANT", "RIGHT", "UNIT", "SPAC_UNIT", "UNKNOWN_REVIEW"]);

export function yahooProviderSymbol(symbol) {
  return normalizeSymbol(symbol).replace(/\./g, "-");
}

export function eodhdProviderSymbol(symbol) {
  return `${normalizeSymbol(symbol).replace(/-/g, ".")}.US`;
}

export function providerSymbolLookupKey(value) {
  return String(value || "").trim().toUpperCase().replace(/\.US$/i, "").replace(/[^A-Z0-9]/g, "");
}

function symbolAliases(value) {
  const text = String(value || "").trim().toUpperCase().replace(/\.US$/i, "");
  if (!text) return [];
  return [...new Set([
    text,
    text.replace(/\./g, "-"),
    text.replace(/-/g, "."),
    providerSymbolLookupKey(text)
  ].filter(Boolean))];
}

function universeRows(universeRef) {
  if (!universeRef) return [];
  if (Array.isArray(universeRef)) return universeRef;
  if (Array.isArray(universeRef.symbols)) return universeRef.symbols;
  if (universeRef instanceof Map) return [...universeRef.values()];
  return Object.values(universeRef).filter(value => value && typeof value === "object");
}

function findUniverseRow(symbol, universeRef) {
  const target = providerSymbolLookupKey(symbol);
  return universeRows(universeRef).find(row => {
    const candidates = [
      row.market_symbol,
      row.canonical_symbol,
      row.symbol,
      row.ticker,
      row.provider_symbols?.yahoo,
      row.provider_symbols?.eodhd,
      row.yahoo_symbol,
      row.eodhd_symbol
    ];
    return candidates.some(candidate => symbolAliases(candidate).some(alias => providerSymbolLookupKey(alias) === target));
  }) || null;
}

function providedEodhdSymbol(row) {
  return row?.provider_symbols?.eodhd || row?.eodhd_symbol || null;
}

function eodhdResolutionFor(symbol, row = null) {
  const instrumentType = row?.instrument_type || classifyInstrument(symbol, row || {});
  if (EODHD_UNSUPPORTED_TYPES.has(instrumentType)) {
    return { symbol: null, status: "UNSUPPORTED_INSTRUMENT", mapping_confidence: "LOW", warning: "EODHD_SYMBOL_UNMAPPED" };
  }
  const provided = providedEodhdSymbol(row);
  if (provided) return { symbol: provided, status: "VALIDATED", mapping_confidence: "HIGH" };
  const normalized = normalizeSymbol(symbol);
  if (instrumentType === "COMMON_STOCK" && /^[A-Z0-9]+$/.test(normalized)) {
    return { symbol: `${normalized}.US`, status: "DERIVED_COMMON_STOCK", mapping_confidence: "MEDIUM" };
  }
  return { symbol: null, status: "UNMAPPED", mapping_confidence: "LOW", warning: "EODHD_SYMBOL_UNMAPPED" };
}

export function resolveProviderSymbol(symbol, provider, universeRef = null) {
  const providerName = String(provider || "").toUpperCase();
  if (providerName !== "EODHD") return { symbol: normalizeSymbol(symbol), status: "DERIVED_COMMON_STOCK", mapping_confidence: "MEDIUM" };
  return eodhdResolutionFor(symbol, findUniverseRow(symbol, universeRef));
}

export function buildProviderAliasMap(universeRef, provider = "EODHD") {
  const map = new Map();
  for (const row of universeRows(universeRef)) {
    const canonical = normalizeSymbol(row.canonical_symbol || row.market_symbol || row.symbol || row.ticker);
    if (!canonical) continue;
    const resolved = resolveProviderSymbol(canonical, provider, [row]);
    if (!resolved.symbol) continue;
    const aliases = [
      canonical,
      row.market_symbol,
      row.provider_symbols?.yahoo,
      row.provider_symbols?.eodhd,
      row.yahoo_symbol,
      row.eodhd_symbol,
      resolved.symbol
    ].flatMap(symbolAliases);
    for (const alias of aliases) map.set(providerSymbolLookupKey(alias), { canonical_symbol: canonical, provider_symbol: resolved.symbol, status: resolved.status });
  }
  return map;
}

export function resolveCanonicalFromProviderSymbol(providerSymbol, universeRef, provider = "EODHD") {
  const alias = buildProviderAliasMap(universeRef, provider).get(providerSymbolLookupKey(providerSymbol));
  return alias?.canonical_symbol || null;
}

export function classifyInstrument(symbol, row = {}) {
  const normalized = normalizeSymbol(symbol);
  const name = String(row.name || row.security_name || row.company_name || row.description || "").toUpperCase();
  const text = `${normalized} ${name}`;
  if (ETF_SYMBOLS.has(normalized) || /\bETF\b|EXCHANGE TRADED FUND|TRUST ETF|INDEX FUND/.test(text)) return "ETF";
  if (/\bETN\b|EXCHANGE TRADED NOTE/.test(text)) return "ETN";
  if (/\bCEF\b|CLOSED[- ]END/.test(text)) return "CEF";
  if (/\bADR\b|AMERICAN DEPOSITARY/.test(text)) return "ADR";
  if (/\bRIGHTS?\b/.test(text) || /R$/.test(normalized) && normalized.length >= 4) return "RIGHT";
  if (/\bWARRANTS?\b/.test(text) || /(WS|WT|W)$/.test(normalized) && normalized.length >= 4) return "WARRANT";
  if (/\bUNITS?\b/.test(text) || /U$/.test(normalized) && normalized.length >= 4) return text.includes("SPAC") ? "SPAC_UNIT" : "UNIT";
  if (/\bPREFERRED\b|PREFERRED STOCK|DEPOSITARY SHARE/.test(text) || /P[A-Z]$/.test(normalized) && normalized.length >= 5) return "PREFERRED";
  return "COMMON_STOCK";
}

export function universeReferenceRow(row, classification = null) {
  const symbol = normalizeSymbol(row.symbol || row.ticker);
  const instrumentType = classifyInstrument(symbol, row);
  const eligible = TECHNICAL_ELIGIBLE_TYPES.has(instrumentType);
  const eodhd = eodhdResolutionFor(symbol, { ...row, instrument_type: instrumentType });
  const sectorStatus = classification?.classification_status === "PARTIAL_NASDAQ_SECTOR_INDUSTRY" || classification?.classification_status === "PARTIAL_YAHOO_SECTOR_INDUSTRY"
    ? "PROXY_SECTOR"
    : classification?.classification_status?.includes("GICS")
      ? "EXACT_GICS"
      : "UNKNOWN";
  return {
    market_symbol: symbol,
    canonical_symbol: symbol,
    instrument_type: instrumentType,
    eligible_technical: eligible,
    technical_exclusion_reason: eligible ? null : "NOT_APPLICABLE_INSTRUMENT",
    provider_symbols: {
      yahoo: yahooProviderSymbol(symbol),
      eodhd: eodhd.symbol,
      eodhd_status: eodhd.status
    },
    mapping_confidence: eodhd.mapping_confidence,
    listing_exchange: row.exchange || row.listing_exchange || null,
    cik: row.cik || null,
    sector_source: classification?.provider || "UNKNOWN",
    sector_status: sectorStatus
  };
}

export function enrichmentStatuses({ hasEvents = false, hasFundamentals = false, hasSectorCache = false, hasIndexMembership = false, hasIssuerVerification = false } = {}) {
  return {
    price_scan_status: "COMPLETE",
    event_registry_status: hasEvents ? "PARTIAL" : "NOT_RUN_DATA_REQUIRED",
    fundamental_enrichment_status: hasFundamentals ? "PARTIAL" : "NOT_RUN_DATA_REQUIRED",
    sector_classification_status: hasSectorCache ? "PARTIAL" : "UNKNOWN",
    index_membership_status: hasIndexMembership ? "PARTIAL" : "NOT_RUN_DATA_REQUIRED",
    issuer_verification_status: hasIssuerVerification ? "PARTIAL" : "NOT_RUN_DATA_REQUIRED"
  };
}
