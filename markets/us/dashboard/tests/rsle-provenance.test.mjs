import assert from "node:assert/strict";
import { providerProvenance } from "../scripts/aurora-provenance.mjs";

assert.deepEqual(providerProvenance([{ provider: "YAHOO_FINANCE", endpoint: "yahoo" }, { provider: "YAHOO_FINANCE", endpoint: "yahoo" }]), {
  provider: "YAHOO_FINANCE",
  provider_counts: { YAHOO_FINANCE: 2 },
  endpoint: "yahoo",
  fallback_label: "YAHOO_FALLBACK"
});

assert.deepEqual(providerProvenance([{ provider: "YAHOO_FINANCE" }, { provider: "STOOQ" }]), {
  provider: "CACHE_MULTI_PROVIDER",
  provider_counts: { YAHOO_FINANCE: 1, STOOQ: 1 },
  endpoint: "cache/us/ohlcv/provider-consistent-symbol-histories",
  fallback_label: "CACHE_PROVIDER_PROVENANCE"
});

console.log("RSLE provenance tests passed");
