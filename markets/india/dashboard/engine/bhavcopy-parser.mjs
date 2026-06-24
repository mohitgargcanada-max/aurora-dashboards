import { normalizeDate, normalizeSymbol } from "./cache-store.mjs";

function clean(value) {
  return String(value ?? "").trim().replace(/^"|"$/g, "");
}

export function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = split(lines.shift()).map(x => clean(x).toUpperCase());
  return lines.map(line => {
    const values = split(line);
    return Object.fromEntries(headers.map((header, index) => [header, clean(values[index])]));
  });
}

function split(line) {
  const output = [];
  let value = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { output.push(value); value = ""; }
    else value += char;
  }
  output.push(value);
  return output;
}

function pick(row, names) {
  for (const name of names) if (row[name] !== undefined && row[name] !== "") return row[name];
  return "";
}

export function detectExchange(row, filename = "") {
  if (/BSE|EQ\d{6}/i.test(filename) || row.SC_CODE || row.SCRIP_CD) return "BSE";
  return "NSE";
}

export function normalizeBhavcopyRow(row, filename = "") {
  const exchange = detectExchange(row, filename);
  const symbol = normalizeSymbol(pick(row, ["SYMBOL", "TCKRSYMB", "TCKR_SYMB", "SC_NAME", "SCRIP_NAME"]));
  const securityCode = clean(pick(row, ["SC_CODE", "SCRIP_CD", "FININSTRMID", "BSECODE", "BSE_CODE"]));
  const series = clean(pick(row, ["SERIES", "SCTYSRS", "SCTY_SRS", "SC_GROUP", "GROUP"])).toUpperCase();
  const date = normalizeDate(pick(row, ["DATE1", "TIMESTAMP", "TRADDT", "BIZDT", "DATE"]));
  const open = Number(pick(row, ["OPEN_PRICE", "OPEN", "OPNPRIC", "OPN_PRIC"]));
  const high = Number(pick(row, ["HIGH_PRICE", "HIGH", "HGHPRIC", "HGH_PRIC"]));
  const low = Number(pick(row, ["LOW_PRICE", "LOW", "LWPRIC", "LW_PRIC"]));
  const close = Number(pick(row, ["CLOSE_PRICE", "CLOSE", "CLSPRIC", "CLS_PRIC"]));
  const volume = Number(pick(row, ["TTL_TRD_QNTY", "TOTTRDQTY", "TTLTRADGVOL", "TTL_TRADG_VOL", "NO_OF_SHRS", "VOLUME"]));
  const turnoverText = pick(row, ["TOTTRDVAL", "TTLTRFVAL", "TTL_TRF_VAL", "NET_TURNOV", "TURNOVERINR", "TURNOVER"]);
  const turnoverLacsText = pick(row, ["TURNOVER_LACS"]);
  let turnover = turnoverText === "" ? Number.NaN : Number(turnoverText);
  const turnoverLacs = turnoverLacsText === "" ? Number.NaN : Number(turnoverLacsText);
  if (!Number.isFinite(turnover) && Number.isFinite(turnoverLacs)) turnover = turnoverLacs * 100000;
  const trades = Number(pick(row, ["NO_OF_TRADES", "TOTALTRADES", "TTLNBOFTXSEXCTD", "TTL_NB_OF_TXS_EXCTD", "TRADES"]));
  const deliveryQuantity = Number(pick(row, ["DELIV_QTY", "DELIVERY_QTY"]));
  const deliveryPct = Number(pick(row, ["DELIV_PER", "DELIVERY_PER"]));
  const isin = clean(pick(row, ["ISIN", "ISIN_NUMBER"])).toUpperCase();
  if ((!symbol && !securityCode) || !date || ![open, high, low, close, volume].every(Number.isFinite)) return null;
  return {
    exchange,
    symbol: symbol || securityCode,
    security_code: securityCode || null,
    isin: isin || null,
    series: series || null,
    bar: {
      date, open, high, low, close, adjusted_close: close, volume,
      turnover: Number.isFinite(turnover) ? turnover : 0,
      trades: Number.isFinite(trades) ? trades : 0,
      delivery_quantity: Number.isFinite(deliveryQuantity) ? deliveryQuantity : 0,
      delivery_pct: Number.isFinite(deliveryPct) ? deliveryPct : 0
    }
  };
}
