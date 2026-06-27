import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const state = JSON.parse(await readFile(resolve(root, "data/us-dashboard-state.json"), "utf8"));
const routes = ["WEEKLY_UNIVERSE", "NEAR_WATCHLIST", "SCANNER_CANDIDATE", "REJECTED", "DATA_REPAIR"];

assert.equal(state.all_candidates.length, state.run.calculated_symbols);
assert.equal(routes.reduce((sum, route) => sum + state.routing_counts[route], 0), state.run.calculated_symbols);
assert.ok(state.tracking_basket.count <= state.tracking_basket.max_total);
assert.ok(state.tracking_basket.weekly_count <= state.tracking_basket.weekly_max);
assert.ok(state.tracking_basket.near_watchlist_count <= state.tracking_basket.near_watchlist_max);
assert.equal(state.tracking_basket.count, state.tracking_basket.weekly_count + state.tracking_basket.near_watchlist_count);
for (const candidate of state.all_candidates) {
  assert.ok(routes.includes(candidate.route), `${candidate.ticker} has invalid route`);
  assert.ok(Array.isArray(candidate.scans), `${candidate.ticker} lacks scanner memberships`);
  assert.ok(Array.isArray(candidate.failed_gates), `${candidate.ticker} lacks failed gates`);
  assert.ok(candidate.next_condition, `${candidate.ticker} lacks next promotion condition`);
  assert.ok(["STOOQ", "YAHOO_FINANCE", "EODHD"].includes(candidate.provider), `${candidate.ticker} has invalid provider`);
  assert.equal(candidate.data_as_of, state.run.data_as_of);
}

console.log("Universe routing contract tests passed");
