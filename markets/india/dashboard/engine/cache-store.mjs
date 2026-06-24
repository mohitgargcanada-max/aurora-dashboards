import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const CACHE_SCHEMA_VERSION = "3.0";

export function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase()
    .replace(/\.(NS|BO)$/, "")
    .replace(/-(EQ|BE|BZ|BL|SM|ST|RE|IV|RR)$/, "");
}

export function normalizeDate(value) {
  const text = String(value || "").trim().replace(/"/g, "");
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const months = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
  const match = text.toUpperCase().match(/^(\d{1,2})[- ]([A-Z]{3})[- ](\d{2}|\d{4})$/);
  if (match && months[match[2]]) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${months[match[2]]}-${match[1].padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

export function normalizeBar(row) {
  const bar = {
    date: normalizeDate(row.date),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    adjusted_open: Number(row.adjusted_open ?? row.open),
    adjusted_high: Number(row.adjusted_high ?? row.high),
    adjusted_low: Number(row.adjusted_low ?? row.low),
    adjusted_close: Number(row.adjusted_close ?? row.close),
    volume: Number(row.volume),
    turnover: Number(row.turnover ?? 0),
    trades: Number(row.trades ?? 0),
    delivery_quantity: Number(row.delivery_quantity ?? 0),
    delivery_pct: Number(row.delivery_pct ?? 0)
  };
  if (!bar.date || ![bar.open, bar.high, bar.low, bar.close, bar.adjusted_open, bar.adjusted_high, bar.adjusted_low, bar.adjusted_close, bar.volume].every(Number.isFinite)) return null;
  if (bar.low > bar.high || bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high || bar.volume < 0) return null;
  return bar;
}

export function mergeBars(existing, incoming, retain = 420) {
  const byDate = new Map();
  for (const row of [...existing, ...incoming]) {
    const bar = normalizeBar(row);
    if (bar) byDate.set(bar.date, bar);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-retain);
}

export function validateSeries(bars, { minimumBars = 1, expectedSession = null } = {}) {
  if (!Array.isArray(bars) || bars.length < minimumBars) return { ok: false, code: "INSUFFICIENT_HISTORY", rows: bars?.length || 0 };
  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].date <= bars[i - 1].date) return { ok: false, code: "INVALID_DATES" };
  }
  if (expectedSession && bars.at(-1).date !== expectedSession) return { ok: false, code: "STALE", actual: bars.at(-1).date, expected: expectedSession };
  return { ok: true, rows: bars.length, data_as_of: bars.at(-1).date };
}

export function cacheId(exchange, symbol) {
  return `${String(exchange).toUpperCase()}__${normalizeSymbol(symbol)}`;
}

export async function loadSymbol(cacheRoot, exchange, symbol) {
  try { return JSON.parse(await readFile(resolve(cacheRoot, `${cacheId(exchange, symbol)}.json`), "utf8")); }
  catch { return null; }
}

export async function saveSymbol(cacheRoot, record) {
  await mkdir(cacheRoot, { recursive: true });
  const path = resolve(cacheRoot, `${cacheId(record.exchange, record.symbol)}.json`);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(record), "utf8");
  await rename(temporary, path);
}
