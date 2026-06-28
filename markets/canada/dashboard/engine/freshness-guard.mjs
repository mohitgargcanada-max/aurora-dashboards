import { latestCompletedCanadaSession } from "./trading-calendar.mjs";

export const CANADA_PROVIDER_ROUTE = ["OFFICIAL_CANADA_LISTINGS", "YAHOO_FINANCE", "EODHD_FALLBACK"];
export const CANADA_PRIMARY_INDEX_SYMBOLS = ["^GSPTSE"];
export const CANADA_OPTIONAL_CONTEXT_INDEX_SYMBOLS = ["XIC.TO", "XIU.TO", "XIT.TO", "XEG.TO"];

export function providerBlendStatus(record) {
  const providers = new Set();
  if (Array.isArray(record?.providers)) {
    for (const provider of record.providers) providers.add(provider);
  }
  if (record?.provider) providers.add(record.provider);
  for (const bar of record?.bars || []) {
    if (bar?.provider) providers.add(bar.provider);
  }
  if (providers.size > 1) return { ok: false, providers: [...providers].sort() };
  return { ok: true, providers: [...providers].sort() };
}

function inspectIndexSymbol(records, symbol, expectedSession) {
  const record = records.find(x => x?.symbol === symbol);
  if (!record?.data_as_of) return { symbol, reason: "MISSING_INDEX_CACHE" };
  if (record.data_as_of < expectedSession) return { symbol, data_as_of: record.data_as_of, expected_session: expectedSession, reason: "STALE_INDEX_BAR", provider: record.provider };
  return null;
}

export function auditIndexRecords(records, expectedSession = latestCompletedCanadaSession()) {
  const primaryIssues = CANADA_PRIMARY_INDEX_SYMBOLS.map(symbol => inspectIndexSymbol(records, symbol, expectedSession)).filter(Boolean);
  const optionalIssues = CANADA_OPTIONAL_CONTEXT_INDEX_SYMBOLS.map(symbol => inspectIndexSymbol(records, symbol, expectedSession)).filter(Boolean);
  const present = [...CANADA_PRIMARY_INDEX_SYMBOLS, ...CANADA_OPTIONAL_CONTEXT_INDEX_SYMBOLS]
    .map(symbol => records.find(x => x?.symbol === symbol))
    .filter(record => record?.data_as_of >= expectedSession)
    .map(record => ({ symbol: record.symbol, data_as_of: record.data_as_of, provider: record.provider, fallback_reason: record.fallback_reason }));
  return {
    market: "CANADA",
    status: primaryIssues.length ? "DATA_STALE_PRIMARY_INDEX_BLOCKED" : "INDEX_FRESHNESS_OK",
    context_status: optionalIssues.length ? "INDEX_CONTEXT_PARTIAL" : "INDEX_CONTEXT_OK",
    expected_session: expectedSession,
    checked_symbols: CANADA_PRIMARY_INDEX_SYMBOLS.length + CANADA_OPTIONAL_CONTEXT_INDEX_SYMBOLS.length,
    valid_symbols: present.length,
    blocking_stale_symbols: primaryIssues,
    optional_stale_symbols: optionalIssues,
    stale_symbols: [...primaryIssues, ...optionalIssues],
    present_symbols: present,
    provider_route: CANADA_PROVIDER_ROUTE
  };
}

export function coverageGuard({ expectedSession, records, minCoveragePct = 60 }) {
  const loaded = records.length;
  const current = records.filter(r => r?.data_as_of >= expectedSession).length;
  const valid = records.filter(r => Array.isArray(r?.bars) && r.bars.length >= 252).length;
  const blended = records.filter(r => !providerBlendStatus(r).ok).map(r => ({ symbol: r.symbol, providers: providerBlendStatus(r).providers }));
  const coveragePct = loaded ? (current / loaded) * 100 : 0;
  let status = "COVERAGE_OK";
  if (!loaded) status = "EMPTY_SCAN_BLOCKED";
  else if (blended.length) status = "PROVIDER_BLEND_BLOCKED";
  else if (coveragePct < minCoveragePct) status = "DATA_STALE_STOCKS_BLOCKED";
  return { status, loaded_symbols: loaded, current_symbols: current, valid_history_symbols: valid, coverage_pct: Number(coveragePct.toFixed(2)), expected_session: expectedSession, blended_provider_symbols: blended };
}

export function rejectionReasonCounts(rows) {
  return rows.reduce((acc, row) => {
    const key = row.rejection_reason || row.override_reason || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}
