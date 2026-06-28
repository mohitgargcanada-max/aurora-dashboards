import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSymbol } from "../engine/cache-store.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_SYMBOL_MAP_PATH = resolve(projectRoot, "data/india-symbol-map.json");
const BSE_COMMON_GROUPS = new Set(["A", "B", "T", "TS", "X", "XT", "Z", "ZP", "M", "MT", "MS", "EQ"]);

function clean(value) {
  return String(value || "").trim();
}

function cleanUpper(value) {
  return clean(value).toUpperCase();
}

function canonicalIdentity(record = {}) {
  return {
    market: "INDIA",
    exchange: cleanUpper(record.exchange || "NSE"),
    canonical_symbol: normalizeSymbol(record.symbol || record.canonical_symbol),
    series_or_group: cleanUpper(record.series || record.group || record.series_or_group),
    isin: clean(record.isin),
    security_code: clean(record.security_code),
    surveillance_flags: record.surveillance_flags || record.surveillance || null
  };
}

async function loadSymbolMap(symbolMapPath) {
  try {
    const parsed = JSON.parse(await readFile(symbolMapPath, "utf8"));
    return Array.isArray(parsed) ? parsed : parsed?.symbols || parsed?.records || [];
  } catch {
    return [];
  }
}

function mapEntryMatches(entry, identity) {
  return normalizeSymbol(entry.canonical_symbol || entry.symbol) === identity.canonical_symbol
    && cleanUpper(entry.exchange) === identity.exchange
    && (!entry.series_or_group || cleanUpper(entry.series_or_group) === identity.series_or_group)
    && (!entry.isin || !identity.isin || clean(entry.isin) === identity.isin)
    && (!entry.security_code || !identity.security_code || clean(entry.security_code) === identity.security_code);
}

function configuredCodes(exchange, options = {}) {
  const envName = exchange === "BSE" ? "AURORA_EODHD_BSE_CODES" : "AURORA_EODHD_NSE_CODES";
  const explicit = exchange === "BSE" ? options.eodhdBseCodes : options.eodhdNseCodes;
  const raw = explicit || process.env[envName] || "";
  return raw.split(",").map(item => cleanUpper(item).replace(/^\./, "")).filter(Boolean);
}

function safeDerivedCodes(exchange) {
  return exchange === "BSE" ? ["BSE", "XBOM", "BO"] : ["NSE", "XNSE", "NS"];
}

function isSupportedEodhdInstrument(identity, entry) {
  if (entry?.eodhd_symbol || entry?.provider_symbols?.eodhd) return true;
  if (!["NSE", "BSE"].includes(identity.exchange) || !identity.canonical_symbol) return false;
  if (identity.exchange === "NSE") return identity.series_or_group === "EQ";
  if (identity.exchange === "BSE") return BSE_COMMON_GROUPS.has(identity.series_or_group);
  return false;
}

export async function resolveIndiaProviderSymbol(record, provider, options = {}) {
  const providerKey = cleanUpper(provider);
  const identity = canonicalIdentity(record);
  const base = {
    provider: providerKey,
    provider_symbol: null,
    candidates: [],
    status: null,
    mapping_confidence: "NONE",
    warning: null,
    exchange: identity.exchange,
    canonical_symbol: identity.canonical_symbol,
    canonical_identity: identity
  };

  const map = options.symbolMap || await loadSymbolMap(options.symbolMapPath || DEFAULT_SYMBOL_MAP_PATH);
  const entry = map.find(item => mapEntryMatches(item, identity));

  if (providerKey === "YAHOO") {
    const mapped = entry?.yahoo_symbol || entry?.provider_symbols?.yahoo || record.provider_symbols?.yahoo;
    const providerSymbol = mapped || `${identity.canonical_symbol}${identity.exchange === "BSE" ? ".BO" : ".NS"}`;
    return {
      ...base,
      provider_symbol: providerSymbol,
      candidates: [providerSymbol],
      status: mapped ? "VALIDATED" : "DERIVED_OFFICIAL_EXCHANGE_SUFFIX",
      mapping_confidence: mapped ? "HIGH" : "MEDIUM"
    };
  }

  if (providerKey !== "EODHD") return { ...base, status: "EODHD_UNSUPPORTED_INSTRUMENT", warning: `${providerKey}_UNSUPPORTED_PROVIDER` };

  const mapped = entry?.eodhd_symbol || entry?.provider_symbols?.eodhd || record.provider_symbols?.eodhd;
  if (mapped && (entry || record.provider_symbols?.eodhd_validated)) {
    return {
      ...base,
      provider_symbol: mapped,
      candidates: [mapped],
      status: "VALIDATED",
      mapping_confidence: "HIGH"
    };
  }

  if (!isSupportedEodhdInstrument(identity, entry)) {
    return {
      ...base,
      status: identity.series_or_group ? "EODHD_UNSUPPORTED_SERIES" : "EODHD_UNSUPPORTED_INSTRUMENT",
      warning: `EODHD_UNSUPPORTED:${identity.exchange}:${identity.series_or_group || "UNKNOWN"}`
    };
  }

  const configured = configuredCodes(identity.exchange, options);
  const codes = configured.length ? configured : safeDerivedCodes(identity.exchange);
  const candidates = [...new Set(codes.map(code => `${identity.canonical_symbol}.${code}`))];
  return {
    ...base,
    provider_symbol: candidates[0] || null,
    candidates,
    status: candidates.length ? "DERIVED_EODHD_CANDIDATES" : "EODHD_SYMBOL_UNMAPPED",
    mapping_confidence: candidates.length ? "LOW" : "NONE",
    warning: candidates.length ? null : "EODHD_SYMBOL_UNMAPPED"
  };
}
