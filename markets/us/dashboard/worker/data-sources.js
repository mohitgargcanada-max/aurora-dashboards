const DAY_MS = 86_400_000;

export class SourceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "SourceError";
    this.code = code;
    this.details = details;
  }
}

function unixSeconds(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

function isoNow() {
  return new Date().toISOString();
}

async function fetchRetry(fetcher, url, options = {}, retries = 1) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetcher(url, options);
      if (response.ok) return response;
      last = new SourceError(`HTTP ${response.status}`, "HTTP_ERROR", {status: response.status});
      if (response.status < 500 && ![408, 429].includes(response.status)) break;
    } catch (error) {
      last = error;
    }
    if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw last || new SourceError("Source request failed", "REQUEST_FAILED");
}

export function validateBars(bars, {expectedCurrency, expectedSession, minimumBars = 1} = {}) {
  if (!Array.isArray(bars) || bars.length < minimumBars) {
    throw new SourceError("Insufficient historical bars", "INSUFFICIENT_HISTORY", {rows: bars?.length || 0, minimumBars});
  }
  let prior = "";
  for (const bar of bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || bar.date <= prior) throw new SourceError("Dates are duplicated or unordered", "INVALID_DATES");
    if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) || !Number.isFinite(bar.volume)) throw new SourceError("OHLCV field missing", "INVALID_OHLCV", {date: bar.date});
    if (bar.low > bar.high || bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high || bar.volume < 0) throw new SourceError("OHLCV values are internally inconsistent", "INVALID_OHLCV", {date: bar.date});
    prior = bar.date;
  }
  if (expectedSession && bars.at(-1).date !== expectedSession) throw new SourceError("Latest completed session is missing", "STALE", {expectedSession, actualSession: bars.at(-1).date});
  if (expectedCurrency && bars.currency && bars.currency !== expectedCurrency) throw new SourceError("Listing currency mismatch", "CURRENCY_MISMATCH", {expectedCurrency, actualCurrency: bars.currency});
  return bars;
}

function yahooBars(payload) {
  const result = payload?.chart?.result?.[0];
  if (!result || payload?.chart?.error) throw new SourceError("Yahoo chart payload is unavailable", "BAD_PAYLOAD");
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const bars = (result.timestamp || []).map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: quote.open?.[index], high: quote.high?.[index], low: quote.low?.[index], close: quote.close?.[index],
    adjusted_close: adjusted[index] ?? quote.close?.[index], volume: quote.volume?.[index]
  })).filter(bar => [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite));
  Object.defineProperty(bars, "currency", {value: result.meta?.currency, enumerable: false});
  return {bars, currency: result.meta?.currency, exchange: result.meta?.exchangeName};
}

function eodhdBars(payload) {
  if (!Array.isArray(payload)) throw new SourceError("EODHD history payload is unavailable", "BAD_PAYLOAD");
  return payload.map(row => ({
    date: row.date, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
    adjusted_close: Number(row.adjusted_close ?? row.adjustedClose ?? row.close), volume: Number(row.volume)
  })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function collectHistory({symbol, eodhdSymbol, startDate, endDate, expectedSession, expectedCurrency = "USD", minimumBars = 200, eodhdToken, fetcher = fetch}) {
  const attempts = [];
  const retrievedAt = isoNow();
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${unixSeconds(startDate)}&period2=${unixSeconds(new Date(new Date(endDate).getTime() + DAY_MS))}&interval=1d&events=div%2Csplits`;
  try {
    const response = await fetchRetry(fetcher, yahooUrl, {headers:{accept:"application/json","user-agent":"Mozilla/5.0 AURORA/2.18.2"}}, 1);
    const normalized = yahooBars(await response.json());
    validateBars(normalized.bars, {expectedCurrency, expectedSession, minimumBars});
    return {bars:normalized.bars, provenance:{symbol,market:"US",exchange:normalized.exchange,provider:"YAHOO_FINANCE",endpoint:"chart",retrieved_at:retrievedAt,data_as_of:normalized.bars.at(-1).date,currency:normalized.currency,adjustment_status:"ADJUSTED_CLOSE_INCLUDED",delayed_or_live:"EOD",fallback_label:"FREE_PRIMARY",fallback_reason:null,warnings:[]}};
  } catch (error) {
    attempts.push({provider:"YAHOO_FINANCE", attempted_at:retrievedAt, outcome:error.code || "FAILED", warning:error.message});
  }

  if (!eodhdToken) throw new SourceError("Yahoo failed and EODHD runtime secret is unavailable", "FALLBACK_SECRET_MISSING", {attempts});
  const fallbackReason = attempts[0]?.outcome || "FAILED";
  const eodhdUrl = `https://eodhd.com/api/eod/${encodeURIComponent(eodhdSymbol)}?from=${startDate}&to=${endDate}&period=d&fmt=json&api_token=${encodeURIComponent(eodhdToken)}`;
  const response = await fetchRetry(fetcher, eodhdUrl, {headers:{accept:"application/json"}}, 0);
  const bars = eodhdBars(await response.json());
  validateBars(bars, {expectedSession, minimumBars});
  return {bars, provenance:{symbol,market:"US",exchange:eodhdSymbol.split(".").at(-1),provider:"EODHD",endpoint:"historical-eod",retrieved_at:isoNow(),data_as_of:bars.at(-1).date,currency:expectedCurrency,adjustment_status:"ADJUSTED_CLOSE_INCLUDED",delayed_or_live:"EOD",fallback_label:"EODHD_FALLBACK",fallback_reason:fallbackReason,warnings:attempts.map(x=>`${x.provider}: ${x.warning}`)}};
}

export function publicConnectivity(result) {
  return {ok:true, provider:result.provenance.provider, data_as_of:result.provenance.data_as_of, rows:result.bars.length, fallback_label:result.provenance.fallback_label, fallback_reason:result.provenance.fallback_reason, warnings:result.provenance.warnings};
}
