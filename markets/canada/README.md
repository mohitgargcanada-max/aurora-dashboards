# AURORA Canada Dashboard

Canada is scaffolded in this monorepo so it can share the same AURORA architecture as US and India.

Locked Canada routing:

1. TSX, TSX Venture, CSE, NEO/Cboe Canada, SEDAR+ and issuer sources.
2. Yahoo Finance with `.TO` or `.V` suffix.
3. EODHD fallback is not implemented or tested yet; provenance must say `EODHD_FALLBACK_NOT_IMPLEMENTED_NOT_TESTED`.
4. Parallel Search for routine verification.
5. Tavily for shortlisted catalysts and emerging leaders.
6. Firecrawl only for difficult documents.

The Canada runner is production-oriented and EOD-only. It writes scan diagnostics locally, preserves the last-good dashboard when freshness guards block publication, and deploys through a unified Pages artifact that includes `/us`, `/india`, and `/canada`.
