import { latestCompletedCanadaSession } from "./trading-calendar.mjs";

export const CANADA_PROVIDER_ROUTE = ["OFFICIAL_CANADA_LISTINGS", "YAHOO_FINANCE", "EODHD_FALLBACK_NOT_IMPLEMENTED_NOT_TESTED"];

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

export function auditIndexRecords(records, expectedSession = latestCompletedCanadaSession()) {
  const required = ["^GSPTSE", "XIC.TO", "XIU.TO", "XIT.TO", "XEG.TO"];
  const stale = [];
  const present = [];
  for (const symbol of required) {
    const record = records.find(x => x?.symbol === symbol);
    if (!record?.data_as_of) stale.push({ symbol, reason: "MISSING_INDEX_CACHE" });
    else if (record.data_as_of < expectedSession) stale.push({ symbol, data_as_of: record.data_as_of, expected_session: expectedSession, reason: "STALE_INDEX_BAR" });
    else present.push({ symbol, data_as_of: record.data_as_of, provider: record.provider });
  }
  return {
    market: "CANADA",
    status: stale.length ? "DATA_STALE_INDEX_BLOCKED" : "INDEX_FRESHNESS_OK",
    expected_session: expectedSession,
    checked_symbols: required.length,
    valid_symbols: present.length,
    stale_symbols: stale,
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
