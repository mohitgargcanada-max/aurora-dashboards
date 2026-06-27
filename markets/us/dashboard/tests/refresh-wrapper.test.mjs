import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildAlreadyCurrentResult, buildCacheCurrentResult, buildMarketHolidayResult, cacheCurrentStatus, isAlreadyCurrentSummary, summarizeRefreshOrRepairResult } from "../scripts/refresh-or-repair-us-data.mjs";

const summary = summarizeRefreshOrRepairResult({
  final_status: "UPDATED",
  daily_refresh: {
    status: "DATA_REFRESH_BLOCKED",
    expected_completed_session: "2026-06-25",
    latest_data_as_of: null,
    provider_counts: {}
  },
  history_repair: {
    status: "UPDATED",
    expected_completed_session: "2026-06-25",
    latest_data_as_of: "2026-06-25",
    provider_counts: { YAHOO_FINANCE: 3129 },
    fallback_label: "YAHOO_FALLBACK"
  }
});

assert.equal(summary.status, "UPDATED");
assert.equal(summary.final_status, "UPDATED");
assert.equal(summary.data_source, "history_repair");
assert.equal(summary.expected_completed_session, "2026-06-25");
assert.equal(summary.latest_data_as_of, "2026-06-25");
assert.deepEqual(summary.provider_counts, { YAHOO_FINANCE: 3129 });
assert.equal(summary.fallback_label, "YAHOO_FALLBACK");

assert.equal(isAlreadyCurrentSummary(summary, "2026-06-25"), true);
assert.equal(isAlreadyCurrentSummary(summary, "2026-06-26"), false);

const skipped = summarizeRefreshOrRepairResult(buildAlreadyCurrentResult(summary, "2026-06-25", "2026-06-26T00:00:00.000Z"));
assert.equal(skipped.status, "UPDATED");
assert.equal(skipped.skipped, true);
assert.equal(skipped.skip_reason, "LOCAL_DATA_ALREADY_CURRENT");
assert.equal(skipped.data_source, "history_repair");
assert.equal(skipped.latest_data_as_of, "2026-06-25");
assert.deepEqual(skipped.provider_counts, { YAHOO_FINANCE: 3129 });

const holidaySkipped = summarizeRefreshOrRepairResult(buildMarketHolidayResult(summary, "2026-06-25", {
  exchange: "NYSE",
  today: "2026-07-03",
  is_market_holiday: true,
  today_holiday: { date: "2026-07-03", name: "Independence Day observed" },
  next_holiday: { date: "2026-07-03", name: "Independence Day observed" }
}, "2026-07-03T16:00:00.000Z"));
assert.equal(holidaySkipped.status, "UPDATED");
assert.equal(holidaySkipped.skipped, true);
assert.equal(holidaySkipped.skip_reason, "NYSE_MARKET_HOLIDAY");
assert.equal(holidaySkipped.market_holiday.date, "2026-07-03");
assert.equal(holidaySkipped.latest_data_as_of, "2026-06-25");

const cacheSkipped = summarizeRefreshOrRepairResult(buildCacheCurrentResult(null, "2026-06-26", "2026-06-27T00:00:00.000Z", {
  ok: true,
  total: 4,
  current: 4,
  stale: 0,
  expected_session: "2026-06-26",
  stale_samples: []
}));
assert.equal(cacheSkipped.status, "UPDATED");
assert.equal(cacheSkipped.skipped, true);
assert.equal(cacheSkipped.skip_reason, "EOD_CACHE_ALREADY_CURRENT");
assert.equal(cacheSkipped.calculation_source, "CACHE_ONLY");
assert.equal(cacheSkipped.latest_data_as_of, "2026-06-26");
assert.deepEqual(cacheSkipped.provider_counts, { CACHE: 4 });
assert.equal(cacheSkipped.fallback_label, "CACHE_ONLY");

const cacheRoot = await mkdtemp(resolve(tmpdir(), "aurora-cache-test-"));
try {
  await writeFile(resolve(cacheRoot, "SPY.json"), JSON.stringify({ symbol: "SPY", bars: [{ date: "2026-06-26" }] }), "utf8");
  await writeFile(resolve(cacheRoot, "QQQ.json"), JSON.stringify({ symbol: "QQQ", bars: [{ date: "2026-06-26" }] }), "utf8");
  const currentStatus = await cacheCurrentStatus("2026-06-26", cacheRoot);
  assert.equal(currentStatus.ok, true);
  assert.equal(currentStatus.current, 2);
  assert.equal(currentStatus.stale, 0);

  await writeFile(resolve(cacheRoot, "IWM.json"), JSON.stringify({ symbol: "IWM", bars: [{ date: "2026-06-25" }] }), "utf8");
  const staleStatus = await cacheCurrentStatus("2026-06-26", cacheRoot);
  assert.equal(staleStatus.ok, false);
  assert.equal(staleStatus.current, 2);
  assert.equal(staleStatus.stale, 1);
  assert.deepEqual(staleStatus.stale_samples, ["IWM:2026-06-25"]);
} finally {
  await rm(cacheRoot, { recursive: true, force: true });
}

console.log("Refresh wrapper tests passed");
