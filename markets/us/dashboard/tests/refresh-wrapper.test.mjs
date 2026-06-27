import assert from "node:assert/strict";
import { summarizeRefreshOrRepairResult } from "../scripts/refresh-or-repair-us-data.mjs";

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

console.log("Refresh wrapper tests passed");
