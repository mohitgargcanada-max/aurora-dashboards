import assert from "node:assert/strict";
import { stampGeneratedAt } from "../scripts/dashboard-state.mjs";

const state = {
  generated_at: "UNKNOWN",
  run: {
    data_as_of: "2026-06-26",
    status: "CALCULATED_WITH_DECLARED_GAPS"
  }
};

const stamped = stampGeneratedAt(state, new Date("2026-06-28T12:34:56.789Z"));

assert.equal(stamped.generated_at, "2026-06-28T12:34:56.789Z");
assert.equal(stamped.run.data_as_of, "2026-06-26");
assert.notEqual(stamped.generated_at, "UNKNOWN");
assert.match(stamped.generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

console.log("Dashboard state generated_at tests passed");
