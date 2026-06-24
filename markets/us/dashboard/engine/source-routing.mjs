const FALLBACK_OUTCOMES = new Set(["MISSING", "STALE", "FAILED", "PARTIAL"]);

export function eodhdFallbackDecision({requiredFreeProviders, attempts}) {
  if (!Array.isArray(requiredFreeProviders) || requiredFreeProviders.length === 0) {
    return {allowed: false, reason: "NO_FREE_ROUTE_DECLARED"};
  }

  const latestByProvider = new Map();
  for (const attempt of attempts || []) {
    if (!attempt?.provider || !attempt?.attempted_at || !attempt?.outcome) continue;
    const current = latestByProvider.get(attempt.provider);
    if (!current || String(attempt.attempted_at) > String(current.attempted_at)) {
      latestByProvider.set(attempt.provider, attempt);
    }
  }

  const unattempted = requiredFreeProviders.filter(provider => !latestByProvider.has(provider));
  if (unattempted.length) {
    return {allowed: false, reason: "FREE_ROUTES_NOT_ATTEMPTED", unattempted};
  }

  const complete = requiredFreeProviders.find(provider =>
    latestByProvider.get(provider).outcome === "CALCULATED"
  );
  if (complete) {
    return {allowed: false, reason: "FREE_SOURCE_FRESH_COMPLETE", provider: complete};
  }

  const invalid = requiredFreeProviders.filter(provider =>
    !FALLBACK_OUTCOMES.has(latestByProvider.get(provider).outcome)
  );
  if (invalid.length) {
    return {allowed: false, reason: "FREE_ROUTE_OUTCOME_INVALID", providers: invalid};
  }

  return {
    allowed: true,
    reason: "FREE_ROUTES_EXHAUSTED",
    fallback_provider: "EODHD"
  };
}
