import assert from "node:assert/strict";
import {eodhdFallbackDecision} from "../engine/source-routing.mjs";

const requiredFreeProviders = ["SEC_EDGAR", "YAHOO_FINANCE"];
const at = "2026-06-21T13:00:00Z";

assert.deepEqual(
  eodhdFallbackDecision({requiredFreeProviders, attempts: []}),
  {allowed:false, reason:"FREE_ROUTES_NOT_ATTEMPTED", unattempted:requiredFreeProviders}
);

assert.equal(eodhdFallbackDecision({requiredFreeProviders, attempts:[
  {provider:"SEC_EDGAR", attempted_at:at, outcome:"FAILED"},
  {provider:"YAHOO_FINANCE", attempted_at:at, outcome:"CALCULATED"}
]}).allowed, false);

assert.deepEqual(eodhdFallbackDecision({requiredFreeProviders, attempts:[
  {provider:"SEC_EDGAR", attempted_at:at, outcome:"PARTIAL"},
  {provider:"YAHOO_FINANCE", attempted_at:at, outcome:"FAILED"}
]}), {allowed:true, reason:"FREE_ROUTES_EXHAUSTED", fallback_provider:"EODHD"});

console.log("Source routing lock tests passed");
