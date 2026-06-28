import assert from "node:assert/strict";
import { fetchCanadaDaily } from "../engine/canada-data-provider.mjs";
import { providerBlendStatus } from "../engine/freshness-guard.mjs";

const symbol = process.env.AURORA_CANADA_EODHD_FALLBACK_TEST_SYMBOL || "RY.TO";
const exchange = process.env.AURORA_CANADA_EODHD_FALLBACK_TEST_EXCHANGE || "TSX";
process.env.AURORA_FORCE_CANADA_YAHOO_FAIL_FOR ||= symbol;

const { record, attempts } = await fetchCanadaDaily(symbol, {
  exchange,
  range: "5y",
  currency: "CAD",
  type: "STOCK"
});

const yahooAttempt = attempts.find(x => x.provider === "YAHOO_FINANCE");
const eodhdAttempt = attempts.find(x => x.provider === "EODHD");
const blend = providerBlendStatus(record);

assert.equal(yahooAttempt?.status, "FAILED");
assert.equal(eodhdAttempt?.status, "OK");
assert.equal(record.provider, "EODHD");
assert.deepEqual(record.provider_route, ["YAHOO_FINANCE", "EODHD"]);
assert.match(record.fallback_reason || "", /^EODHD_FALLBACK_AFTER_YAHOO_FAILURE/);
assert.equal(blend.ok, true);
assert.ok(record.bars.length >= 252);
assert.ok(record.bars.every(bar => bar.provider === "EODHD"));

console.log(JSON.stringify({
  status: "CANADA_EODHD_FALLBACK_VERIFIED",
  symbol,
  yahoo_forced_failure_reason: yahooAttempt.warning,
  eodhd_data_as_of: record.data_as_of,
  bar_count: record.bars.length,
  adjustment_status: record.adjustment_status,
  provider: record.provider,
  provider_route: record.provider_route,
  fallback_reason: record.fallback_reason,
  providerBlendStatus: "PASSED"
}, null, 2));
