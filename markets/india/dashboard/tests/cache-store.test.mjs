import assert from "node:assert/strict";
import { mergeBars, normalizeDate, normalizeSymbol, validateSeries } from "../engine/cache-store.mjs";

assert.equal(normalizeSymbol("RELIANCE-EQ"), "RELIANCE");
assert.equal(normalizeSymbol("TCS.NS"), "TCS");
assert.equal(normalizeDate("22-JUN-2026"), "2026-06-22");
const rows = Array.from({ length: 430 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
  return { date, open: 10, high: 11, low: 9, close: 10, adjusted_close: 10, volume: index };
});
const merged = mergeBars([], rows, 420);
assert.equal(merged.length, 420);
assert.equal(validateSeries(merged, { minimumBars: 252 }).ok, true);
console.log("cache-store tests passed");
