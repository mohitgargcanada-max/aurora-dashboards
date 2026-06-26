export function providerProvenance(records) {
  const provider_counts = {};
  for (const record of records) {
    const provider = record?.provider || "UNKNOWN";
    provider_counts[provider] = (provider_counts[provider] || 0) + 1;
  }
  const providers = Object.keys(provider_counts);
  const provider = providers.length === 1 ? providers[0] : providers.length ? "CACHE_MULTI_PROVIDER" : "UNKNOWN";
  return {
    provider,
    provider_counts,
    endpoint: provider === "CACHE_MULTI_PROVIDER" ? "cache/us/ohlcv/provider-consistent-symbol-histories" : records.find(x => x?.provider === provider)?.endpoint || "cache/us/ohlcv",
    fallback_label: provider === "EODHD" ? "EODHD_FALLBACK" : provider === "YAHOO_FINANCE" ? "YAHOO_FALLBACK" : provider === "STOOQ" ? "FREE_PRIMARY" : "CACHE_PROVIDER_PROVENANCE"
  };
}
