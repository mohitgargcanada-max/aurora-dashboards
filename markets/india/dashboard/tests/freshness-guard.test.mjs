import assert from "node:assert/strict";
import { auditIndexRecords, deriveExpectedCompletedSession, rejectionReasonCounts } from "../engine/freshness-guard.mjs";

const bars = Array.from({ length: 252 }, (_, index) => ({
  date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  adjusted_close: 1,
  volume: 1
}));

const audit = auditIndexRecords([{
  record: {
    symbol: "NIFTY500",
    name: "NIFTY 500",
    provider: "LOCAL_FIXTURE",
    fallback_label: "TEST",
    adjustment_status: "TEST",
    data_as_of: "2026-06-24",
    bars
  }
}], { expectedSession: "2026-06-25", expectedCount: 1 });

assert.equal(audit.valid_indices, 0);
assert.equal(audit.stale_count, 1);
assert.equal(audit.freshness_coverage_pct, 0);
assert.equal(audit.records[0].valid, false);
assert.equal(audit.records[0].failure, "STALE_INDEX");
assert.equal(audit.blocking_reason, "INDEX_DATA_STALE");

assert.deepEqual(rejectionReasonCounts([{ reason: "A" }, { reason: "B" }, { reason: "A" }]), { A: 2, B: 1 });
assert.equal(await deriveExpectedCompletedSession({ explicitSession: "2026-06-25" }), "2026-06-25");

console.log("freshness-guard tests passed");
