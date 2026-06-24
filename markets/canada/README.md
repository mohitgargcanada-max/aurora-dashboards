# AURORA Canada Dashboard

Canada is scaffolded in this monorepo so it can share the same AURORA architecture as US and India.

Locked Canada routing:

1. TSX, TSX Venture, CSE, NEO/Cboe Canada, SEDAR+ and issuer sources.
2. Yahoo Finance with `.TO` or `.V` suffix.
3. EODHD only when free sources fail validation or lack a required field.
4. Parallel Search for routine verification.
5. Tavily for shortlisted catalysts and emerging leaders.
6. Firecrawl only for difficult documents.

The Canada runner currently exits as scaffold-only until the market-specific dashboard implementation is added.

