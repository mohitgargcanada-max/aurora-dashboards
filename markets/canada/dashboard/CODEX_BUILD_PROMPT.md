# Codex Task — AURORA Canada Dashboard Production Build

You are working in `mohitgargcanada-max/aurora-dashboards`.

Branch: `codex/canada-dashboard-production`.

Objective: build the production-grade Canada dashboard independently under `markets/canada/`, preserving all locked AURORA rules and not touching US or India logic except for repo-level helpers that explicitly mention Canada.

## Non-negotiables

- AURORA is EOD only. No live order logic, no intraday automation, no account-equity sizing.
- `RS` always means benchmark-relative strength, never RSI.
- Final buckets are locked to exactly:
  `TRADE_READY`, `TRIGGER_READY`, `EARLY_ENTRY_WATCH`, `PULLBACK_WATCH`, `RSNH_WATCH_ONLY`, `NO_CHASE`, `PROTECT_PROFIT_REVIEW`, `REPAIR_WATCH`, `AVOID_FRESH_LONG`.
- Diagnostic labels such as RSLE, RMVP, PBX, BPX, VE2, AXM, setup lane, data repair, and watchlist status must never become final buckets.
- Free-first routing: official Canadian sources first where available, Yahoo Finance `.TO` / `.V` for OHLCV, EODHD only as explicit fallback with recorded reason.
- Never blend providers inside one indicator series.
- Canada must not reuse India-only surveillance, delivery, ASM/GSM/T2T or sector logic.

## Required stable outputs

- `markets/canada/AURORA_Canada_Unified_Dashboard.html`
- `markets/canada/dashboard/data/canada-full-dashboard-scan.json`
- `markets/canada/dashboard/data/canada-daily-refresh-report.json`
- `markets/canada/dashboard/data/canada-index-cache-audit.json`

## Current scaffold expectation

Build a lean production implementation with:

- Canada market adapter and theme mapper.
- Canada trading calendar.
- Yahoo chart fetcher.
- Cache store.
- Freshness guards.
- Feature matrix + renderer.
- Scripts for backfill, refresh, index audit, full scan, weekday scan.
- Tests.
- Canada-only Pages artifact helper.
- Canada GitHub Actions workflow.

## Codex work

1. Start from latest `main` and stay on this branch:

```bash
git checkout main
git pull --ff-only origin main
git checkout codex/canada-dashboard-production
```

2. Implement under these paths only unless a Canada-specific repo helper is required:

```text
markets/canada/
markets/canada/dashboard/
scripts/prepare-canada-pages-artifact.sh
.github/workflows/canada-dashboard.yml
```

Do not modify US or India workflows.

3. Required package scripts:

```json
{
  "test": "node tests/canada-dashboard.test.mjs",
  "cache:refresh:daily": "node scripts/refresh-canada-daily-bars.mjs",
  "cache:refresh:indices": "node scripts/refresh-canada-index-bars.mjs",
  "cache:audit:indices": "node scripts/audit-indices.mjs",
  "scan:full": "node scripts/run-full-dashboard-scan.mjs",
  "scan:weekday": "node scripts/run-weekday-active-refresh.mjs",
  "backfill:history": "node scripts/backfill-canada-history.mjs"
}
```

4. Canada adapter must use:

```text
market: CANADA
currency: CAD
benchmark_primary: ^GSPTSE
benchmark_growth: XIT.TO or validated Canadian technology proxy
benchmark_breadth: XIC.TO / XIU.TO / liquid TSX universe breadth
reference_basket_static_fallback: RY.TO, TD.TO, BMO.TO, BNS.TO, ENB.TO, CNQ.TO, CNR.TO, CP.TO, SHOP.TO, TRI.TO
liquidity_min_addv_local: CAD 1,000,000
liquidity_ideal_addv_local: CAD 5,000,000
liquidity_min_price: CAD 5
liquidity_min_share_volume_20d: 100,000
```

5. Dashboard sections must appear in this order:

```text
1. Market Summary Strength Stack
2. Column Guide
3. WEEKLY_UNIVERSE
4. WEEKLY_FOCUS
5. DAILY_TOP_1_4 Conditional Trade Plans
6. AURORA-RSLE Top 20
7. Developing Watchlist Next 20
8. Canada Small/Microcap Overlay or Exchange Overlay if useful
9. Sector and Theme RRG
10. Stock Theme Leadership
11. RRG Quadrant Map
12. Near RS High
13. PBX Pullback
14. BasePivot / Patterns
15. RMVP / Early Entry
16. VE2 Volume Signature
17. Compression
18. No-Chase / Risk
19. Rejected / Data Repair Routes
20. Provenance
```

6. Every candidate table must preserve columns:

```text
Rank
Symbol
User Note
Theme
AURORA Bucket
Setup
Price
Score
RS
RRG
RMV
BasePivot / RMVP
PBX
VE2 Volume
AXM
Entry / Stop
Liquidity
Caution / Next
```

7. Required Canada themes:

```text
Canadian Banks
Insurance / Asset Management
Pipelines / Midstream
Oil & Gas E&P
Oilfield Services
Uranium
Gold Miners
Silver Miners
Copper / Base Metals
Lithium / Battery Metals
Rail / Logistics
Canadian Technology / Software
E-commerce / Digital Platforms
Telecom
Utilities
Renewables / Power Producers
REITs
Industrials
Consumer Staples
Consumer Discretionary
Healthcare / Biotech
Smallcap Growth
UNMAPPED_REVIEW
```

Use explicit ticker maps and name-keyword rules if official sector files are unavailable. Never fabricate theme membership.

8. Core calculations to implement or wire from existing AURORA logic:

```text
AURORA-MC2 Market State
Leadership Breadth
RS line vs ^GSPTSE
RS EMA21
RS Trifecta
RS 1W / 1M / 3M
IBD-style 1-99 RS Rating approximation
Mansfield RS
Stock RRG
Sector RRG
RMV / range-compression proxy
BasePivot / BPX
RMVP
PBX pullback engine
VE2 volume signature
AXM ATR extension matrix
Weinstein Stage
AVWAP / HVC where available
Dual stops: entry_stop and thesis_stop
AURORA-SIG 0-100
TechnicalStrengthScore 0-85
WWL score if available in existing implementation
```

9. Freshness guards:

- `DATA_STALE_INDEX_BLOCKED`
- `EMPTY_SCAN_BLOCKED`
- `ACTIVE_REFRESH_COVERAGE_BLOCKED` or `DATA_STALE_STOCKS_BLOCKED`

Do not publish dashboard HTML if benchmark/sector data is stale, feature matrix is empty, scanned candidates are zero, or stock coverage is unusably low. Preserve last-good dashboard and write blocked JSON with reason, expected session, latest data_as_of, route, stale symbols, and next condition.

10. Add or strengthen tests for:

- cache-store contract
- Yahoo suffix mapping validation
- Canada trading-calendar expected completed session
- index freshness audit
- stale index guard
- empty scan guard
- low stock coverage guard
- RS benchmark alignment
- no provider blending
- dashboard render smoke test
- Pages artifact helper copies only Canada files

11. Validation commands:

```bash
npm ci --prefix markets/canada/dashboard
npm --prefix markets/canada/dashboard test
npm --prefix markets/canada/dashboard run cache:refresh:indices
npm --prefix markets/canada/dashboard run cache:audit:indices
npm --prefix markets/canada/dashboard run scan:full
npm --prefix markets/canada/dashboard run scan:weekday
bash -n scripts/prepare-canada-pages-artifact.sh
```

If live providers fail due to rate limits/network, do not fake data. Tests must validate logic with fixtures/mocks and logs must show clear failure reason.

12. Output quality requirements:

The dashboard must show expected completed session, latest stock data_as_of, latest index data_as_of, provider route, coverage percentage, symbols loaded, valid symbols, feature_matrix_count, scanned_candidates, rejected_count, rejection_reason_counts, stale symbols if any, and Daily Top 1-4 only when valid.

13. Commit hygiene:

Do not commit generated raw cache/data/dashboard files unless repo publication policy explicitly requires it. Prefer artifact-based Pages deployment. If workflow commits outputs, make sure it commits Canada-only paths and never references US or India files.

14. PR checklist:

- Summarize files changed.
- List tests run.
- State whether Yahoo live fetch succeeded or was fixture-only.
- Confirm EODHD was not used by default.
- Confirm US/India workflows were untouched.
