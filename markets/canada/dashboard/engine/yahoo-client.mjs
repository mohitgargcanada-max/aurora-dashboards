const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

function normalizeChart(symbol, payload, providerMeta) {
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error(`${symbol}: Yahoo chart missing result`);
  const quote = result.indicators?.quote?.[0];
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose;
  const timestamps = result.timestamp || [];
  if (!quote || !timestamps.length) throw new Error(`${symbol}: Yahoo chart missing OHLCV`);
  const bars = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = adjclose?.[i] ?? quote.close?.[i] ?? (i === timestamps.length - 1 ? result.meta?.regularMarketPrice : undefined);
    const rawClose = quote.close?.[i] ?? (i === timestamps.length - 1 ? result.meta?.regularMarketPrice : undefined);
    const volume = quote.volume?.[i] ?? 0;
    if ([open, high, low, close].every(Number.isFinite)) {
      const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      bars.push({ date, open, high, low, close, raw_close: rawClose, volume });
    }
  }
  if (!bars.length) throw new Error(`${symbol}: Yahoo returned no valid bars`);
  return {
    symbol,
    provider: "YAHOO_FINANCE",
    endpoint: "chart/v8",
    retrieved_at: new Date().toISOString(),
    data_as_of: bars.at(-1).date,
    currency: providerMeta.currency || "CAD",
    adjustment_status: "ADJUSTED_CLOSE_USED_WHEN_AVAILABLE",
    delayed_or_live: "DELAYED_EOD",
    fallback_reason: providerMeta.fallback_reason || "FREE_PRIMARY",
    bars
  };
}

export async function fetchYahooDaily(symbol, { range = "5y", interval = "1d", currency = "CAD", fallback_reason = "FREE_PRIMARY" } = {}) {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false&events=div%2Csplits`;
  const response = await fetch(url, { headers: { "User-Agent": "aurora-canada-dashboard/1.0" } });
  if (!response.ok) throw new Error(`${symbol}: Yahoo HTTP ${response.status}`);
  const payload = await response.json();
  const error = payload?.chart?.error;
  if (error) throw new Error(`${symbol}: Yahoo error ${error.code || "UNKNOWN"}: ${error.description || ""}`);
  return normalizeChart(symbol, payload, { currency, fallback_reason });
}
