import { fetchYahooDaily } from "./yahoo-client.mjs";
import { fetchEodhdDaily } from "./eodhd-client.mjs";

function isRecordUsable(record, expectedSession) {
  if (!record?.bars?.length) return { ok: false, reason: "NO_VALID_BARS" };
  if (record.bars.length < 252) return { ok: false, reason: "INSUFFICIENT_HISTORY" };
  if (expectedSession && record.data_as_of < expectedSession) return { ok: false, reason: "STALE_COMPLETED_BAR" };
  return { ok: true, reason: "OK" };
}

export async function fetchCanadaDaily(symbol, {
  exchange = "",
  range = "5y",
  currency = "CAD",
  expectedSession = null,
  type = "STOCK"
} = {}) {
  const attempts = [];
  try {
    const yahoo = await fetchYahooDaily(symbol, { range, currency, fallback_reason: "YAHOO_FREE_PRIMARY" });
    const usable = isRecordUsable(yahoo, expectedSession);
    attempts.push({ provider: yahoo.provider, status: usable.ok ? "OK" : "UNUSABLE", data_as_of: yahoo.data_as_of, reason: usable.reason, type });
    if (usable.ok) return { record: { ...yahoo, provider_route: ["YAHOO_FINANCE"] }, attempts };
    try {
      const eodhd = await fetchEodhdDaily(symbol, { exchange, currency, fallback_reason: `EODHD_FALLBACK_AFTER_YAHOO_${usable.reason}`, warnings: [`Yahoo unusable: ${usable.reason}; data_as_of=${yahoo.data_as_of}`] });
      const eodUsable = isRecordUsable(eodhd, expectedSession);
      attempts.push({ provider: eodhd.provider, status: eodUsable.ok ? "OK" : "UNUSABLE", data_as_of: eodhd.data_as_of, reason: eodUsable.reason, type });
      if (eodUsable.ok) return { record: { ...eodhd, provider_route: ["YAHOO_FINANCE", "EODHD"] }, attempts };
    } catch (fallbackError) {
      attempts.push({ provider: "EODHD", status: "FAILED", warning: fallbackError.message, type });
    }
    return { record: { ...yahoo, warnings: [...(yahoo.warnings || []), `Yahoo unusable: ${usable.reason}; EODHD fallback unavailable or unusable`], provider_route: ["YAHOO_FINANCE", "EODHD_ATTEMPTED"] }, attempts };
  } catch (yahooError) {
    attempts.push({ provider: "YAHOO_FINANCE", status: "FAILED", warning: yahooError.message, type });
    const eodhd = await fetchEodhdDaily(symbol, { exchange, currency, fallback_reason: "EODHD_FALLBACK_AFTER_YAHOO_FAILURE", warnings: [`Yahoo failure: ${yahooError.message}`] });
    const eodUsable = isRecordUsable(eodhd, expectedSession);
    attempts.push({ provider: eodhd.provider, status: eodUsable.ok ? "OK" : "UNUSABLE", data_as_of: eodhd.data_as_of, reason: eodUsable.reason, type });
    if (!eodUsable.ok) throw new Error(`${symbol}: EODHD fallback unusable: ${eodUsable.reason}`);
    return { record: { ...eodhd, provider_route: ["YAHOO_FINANCE", "EODHD"] }, attempts };
  }
}
