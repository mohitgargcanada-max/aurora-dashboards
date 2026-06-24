# AURORA US Dashboard Workflow

## Runtime boundary

This artifact is the dashboard and orchestration contract for AURORA v2.18.2. It is EOD-only. The two run types share one durable candidate ledger:

- `SUNDAY_WWL`: Sunday 09:00 America/New_York. Build and persist the 15-20-name `WEEKLY_UNIVERSE`, with no forced padding.
- `WEEKDAY_MORNING`: weekdays 09:00 America/New_York. Refresh completed EOD data, apply persistence/removal rules, build `WEEKLY_FOCUS`, and select zero to four `DAILY_TOP_1_4`, ideally one.

The scheduler handler expects an hourly trigger and gates execution using `America/New_York`, avoiding fixed-UTC daylight-saving drift. A production scan worker must claim `QUEUED` rows and write only `COMPLETED` runs to the visible dashboard.

## Source routing

`config/source_routing_lock.json` is the governing policy for both US and Canadian collection. Official and free providers must be attempted and audited before EODHD is eligible. A fresh, complete free result blocks EODHD; partial, stale, missing or failed free results permit EODHD only for the unresolved lane or fields. The executable guard is `engine/source-routing.mjs`.

The canonical symbol, membership and benchmark map is stored in `config/us_market_routes.json`; see `docs/US_MARKET_DATA_HOMEWORK.md` for the validation rules.

| Lane | Primary | Fallback | Conflict rule |
|---|---|---|---|
| Security master | Nasdaq Trader and official exchange files | EODHD symbol list | Official wins |
| Filings and facts | SEC EDGAR submissions, Company Facts and issuer filings | Yahoo Finance enrichment; EODHD only when entitled | SEC or issuer filing wins |
| OHLCV bootstrap | Stooq US daily bulk archive | Yahoo Finance history, then EODHD EOD | Bootstrap once; validate adjustment and official symbol mapping |
| OHLCV daily append | Stooq current daily snapshot | Yahoo completed-session batch, then EODHD unresolved only | Append/correct one completed-session bar; never refetch unchanged history |
| Volatility / risk | CBOE | Yahoo proxy | CBOE wins |
| Macro | FRED | None | Mark UNKNOWN when unavailable |
| Index membership | Official constituent/security files | ETF or maintained proxy list | Record PARTIAL when proxied |

Every lane writes `provider`, `asof_date`, and `status` in `CALCULATED`, `PARTIAL`, `UNKNOWN`, or `NOT_APPLICABLE`.

## Cheap scan and enrichment

1. Build active Nasdaq, NYSE and NYSE American common-stock security master. Exclude OTC, warrants, rights, preferred shares and funds from stock candidates.
2. Attach overlapping pools: S&P 500, Nasdaq 100, Dow 30, Russell 1000/2000, S&P 400/600, non-index, IPO, PEAD, and catalyst exceptions.
3. Batch-adjusted OHLCV and benchmark routes: `SPY`, `QQQ`, `DIA`, `IWM`, `MDY`, or `IJR`; use sector ETFs for sector RS/RRG.
4. Cheap-calculate liquidity, MA stack, weekly context, Stage, RS line/RS21/RSNH, Mansfield, RMV proxies, compression, base geometry, trigger proximity and obvious damage.
5. Enrich the strongest and every exception candidate with SEC facts, earnings/event context, VE2, BPX/RMVP, AVWAP/HVC, PBX, AXM/PX and structural risk.
6. Apply hard overrides visibly. Do not hide wide-risk, incomplete-fundamental or low-liquidity names; only promotion changes.
7. Calculate AURORA-SIG, weekly score, tiers and the daily execution-focus score using the locked formulas.

Every technically valid symbol remains in the feature-matrix output after the
scan. Route each symbol to exactly one of `WEEKLY_UNIVERSE`, `NEAR_WATCHLIST`,
`SCANNER_CANDIDATE`, `REJECTED`, or `DATA_REPAIR`. Persist its matching scanner
views, failed promotion gates and next promotion condition. Rejection blocks
promotion, not discovery. Run deterministic OHLCV calculations universe-wide;
limit paid or token-heavy fundamentals, filings, catalysts and narrative
enrichment to Weekly, Near Watchlist and event candidates.

The persistent Core tracking basket is capped at 50 names and normally holds
up to 20 `WEEKLY_UNIVERSE` plus 20 `NEAR_WATCHLIST` names. Unused capacity is
not padded. Event exceptions remain in the separate event workspace. The full
universe still receives deterministic cached technical calculations, but only
the tracking basket and changed event exceptions receive routine external
enrichment. Unchanged fundamentals and catalysts are reused from cache.

## Persistence

- Carry forward for at most three weeks while weekly context stays OK/STRONG, theme is not fading, 20/21 EMA or key support holds, no AURORA-X hard warning exists, and liquidity remains pass/partial.
- Flag `STALE_SETUP_REVIEW` after 10 completed sessions without trigger/retest when setup is no longer tight, near pivot or a pullback.
- Remove after 15 completed sessions without trigger/retest or repeated distribution failures.
- A weekday run performs lightweight discovery across the complete eligible universe. It may add, remove or replace weekly names whenever fresh AURORA evidence justifies the change; Sunday continuity never blocks discovery.
- An outside IPO/PEAD/catalyst candidate needs EOD acceptance, RS confirmation, constructive VE2, valid BasePivot/RMVP and a clear stop before promotion.

## EODHD adapter contract

The EODHD connector is authenticated for symbol lists and historical EOD prices. Fundamentals returned `403 Forbidden` in the entitlement smoke test, so the fundamentals lane must not call EODHD unless that entitlement is later verified. The adapter must:

1. Read `EODHD_API_TOKEN` only from the runtime secret manager.
2. Redact the token from URLs before logging and disable response-body logging for upstream errors.
3. Expose allowlisted tools: `list_symbols(exchange)` and `get_eod(symbol, from, to)`; enable fundamentals or earnings tools independently only after endpoint-specific entitlement tests pass.
4. Validate exchange and symbol inputs, cap date ranges and response sizes, and use TLS only.
5. Run endpoint-specific smoke tests. Enable successful lanes independently instead of disabling working symbol and EOD routes because fundamentals are unavailable.
6. Return normalized data plus `provider=EODHD`, `asof_date`, freshness, and endpoint-level status. Never return request URLs containing credentials.

The free-source router must execute first. Fundamental facts route through SEC EDGAR and issuer filings, with Yahoo Finance used for secondary enrichment. EODHD is called only for missing, stale or failed lanes for which its entitlement test passed.

## Persistent fetch-once cache

The US runtime keeps 420 normalized daily bars per eligible symbol, benchmark,
sector proxy, risk proxy and reference-basket member. A one-time Stooq bulk
bootstrap populates the cache. Every later run ingests only the expected
completed-session cross-sectional snapshot. All RS, RMV, VE2, BPX, PBX, AXM,
Stage, RRG/RLT, scanner, score, stop and risk calculations reuse that cache.
History is fetched again only for a new symbol, a gap, a corporate action, a
provider conflict or a schema migration. EODHD is the final paid repair route,
never the routine universe provider.

If the Stooq ZIP exceeds the workspace upload limit, split it locally and upload
all parts without extracting it:

```sh
split -b 45m -d -a 3 d_us_txt.zip d_us_txt.zip.part-
```

Bootstrap either the original ZIP or the ordered parts. The bootstrap tests the
reassembled ZIP before extracting or writing cache records:

```sh
npm run cache:bootstrap -- /path/to/d_us_txt.zip
npm run cache:bootstrap -- /path/to/d_us_txt.zip.part-*
```

Visual QA runs through `npm run visual:validate`. The script discovers a system
browser or Playwright browser cache; `CHROMIUM_PATH` can point to a portable
Chromium/Chrome executable when the runtime image does not include one.

## Unresolved specification inputs

- AXM provides locked ATR-distance formulas and state names but no numeric label thresholds.
- PBX locks depth/duration buckets but does not define reversal-quality, failure-cluster or institutional-defense formulas.
- HTF ADR-acceptable versus too-loose lacks a numeric ADR-unit threshold.

These fields must remain `PARTIAL` until thresholds are approved; no runtime should invent them.

## Governance decision required

The v2.18.2 master makes `LIQUIDITY_FAIL` a hard fresh-long override and makes missing average dollar volume a `DAILY_TOP1-4` blocker. The current dashboard brief says only structural damage should prevent fresh-entry promotion. Those rules cannot both govern promotion. This build preserves the v2.18.2 promotion gate and always keeps affected stocks visible; change the gate only after the newer policy is explicitly declared to supersede the master lock.
