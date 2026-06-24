import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";

export const CACHE_SCHEMA_VERSION = "2.0";

export function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/\.US$/, "").replace(/_/g, "-");
}

export function cacheFileName(symbol) {
  const normalized = normalizeSymbol(symbol);
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(normalized)
    ? `_${normalized}.json`
    : `${normalized}.json`;
}

export function normalizeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return null;
}

export function normalizeBar(row) {
  const bar = {
    date: normalizeDate(row.date ?? row.DATE ?? row[2]),
    open: Number(row.open ?? row.OPEN ?? row[4]),
    high: Number(row.high ?? row.HIGH ?? row[5]),
    low: Number(row.low ?? row.LOW ?? row[6]),
    close: Number(row.close ?? row.CLOSE ?? row[7]),
    adjusted_close: Number(row.adjusted_close ?? row.close ?? row.CLOSE ?? row[7]),
    volume: Number(row.volume ?? row.VOL ?? row[8])
  };
  if (!bar.date || ![bar.open, bar.high, bar.low, bar.close, bar.adjusted_close, bar.volume].every(Number.isFinite)) return null;
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
  for (let i = 1; i < bars.length; i += 1) if (bars[i].date <= bars[i - 1].date) return { ok: false, code: "INVALID_DATES" };
  if (expectedSession && bars.at(-1).date !== expectedSession) return { ok: false, code: "STALE", actual: bars.at(-1).date, expected: expectedSession };
  return { ok: true, rows: bars.length, data_as_of: bars.at(-1).date };
}

export async function loadSymbol(cacheRoot, symbol) {
  try { return JSON.parse(await readFile(resolve(cacheRoot, cacheFileName(symbol)), "utf8")); }
  catch { return null; }
}

export async function saveSymbol(cacheRoot, record) {
  await mkdir(cacheRoot, { recursive: true });
  const path = resolve(cacheRoot, cacheFileName(record.symbol));
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(record), "utf8");
  await rename(temporary, path);
}
