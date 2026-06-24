import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeBar, normalizeDate, normalizeSymbol, mergeBars, validateSeries, saveSymbol, loadSymbol } from "../engine/cache-store.mjs";

assert.equal(normalizeSymbol("brk_b.us"), "BRK-B");
assert.equal(normalizeDate("20260618"), "2026-06-18");
const first = normalizeBar({ DATE: "20260617", OPEN: "10", HIGH: "11", LOW: "9", CLOSE: "10.5", VOL: "1000" });
const corrected = normalizeBar({ DATE: "20260617", OPEN: "10", HIGH: "12", LOW: "9", CLOSE: "11.5", VOL: "1500" });
const second = normalizeBar({ DATE: "20260618", OPEN: "11.5", HIGH: "13", LOW: "11", CLOSE: "12.5", VOL: "2000" });
const merged = mergeBars([first], [corrected, second]);
assert.equal(merged.length, 2);
assert.equal(merged[0].close, 11.5);
assert.deepEqual(validateSeries(merged, { minimumBars: 2, expectedSession: "2026-06-18" }).ok, true);

const directory = await mkdtemp(join(tmpdir(), "aurora-cache-"));
await saveSymbol(directory, { symbol: "TEST", bars: merged });
assert.equal((await loadSymbol(directory, "TEST")).bars.length, 2);
await rm(directory, { recursive: true, force: true });
console.log("Cache store contract tests passed");
