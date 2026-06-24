# AURORA India Dashboard Format Lock

This file is the handoff source for the India dashboard. Any future chat, scan,
or automation update must preserve this structure unless the user explicitly
changes it.

## Operating Model

- Use one stable HTML dashboard: `AURORA_India_Unified_Dashboard.html`.
- Use one scan output JSON: `data/india-full-dashboard-scan.json`.
- Do not split weekly, daily, or event dashboards into separate automations.
- Fetch once, cache locally, calculate all technical fields locally.
- Free and official sources first. EODHD/TapeTide are fallback only.
- Never blend providers inside one indicator series.
- Token efficiency may limit enrichment, not full-universe technical discovery.

## Required Daily Flow

1. Fetch or ingest the latest completed India session files.
2. Append the latest completed daily bar.
3. Ingest NSE delivery data when available.
4. Refresh IPO / PEAD / EP / HVE registry when implemented.
5. Run full-universe technical discovery.
6. Build `WEEKLY_UNIVERSE`, `WEEKLY_FOCUS`, `DAILY_TOP_1_4`, `RSLE_TOP20`, and supporting sections.
7. Render the stable dashboard file.

## Dashboard Section Order

The dashboard must show these sections in this order:

1. Market Summary Strength Stack
2. Column Guide
3. WEEKLY_UNIVERSE
4. WEEKLY_FOCUS
5. DAILY_TOP_1_4 Conditional Trade Plans
6. AURORA-RSLE Top 20
7. Developing Watchlist Next 20
8. BSE-Exclusive Overlay
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

## Market Context Lock

Market context must appear first and use AURORA-MC2 plus an O'Neil-style
user-facing label.

Allowed O'Neil-style labels:

- `CONFIRMED_UPTREND`
- `UPTREND_RECONFIRMING`
- `RALLY_ATTEMPT`
- `UPTREND_UNDER_PRESSURE`
- `MARKET_IN_CORRECTION`

Locked AURORA MC2 labels:

- `MARKET_CYCLE_ON`
- `MARKET_RECONFIRMATION`
- `MARKET_TRANSITION`
- `MARKET_UNDER_PRESSURE`
- `MARKET_CYCLE_OFF`

Always show:

- Final Market Permission: `TRADE_ALLOWED`, `SELECTIVE_ONLY`, `TRANSITION_MODE`, `WATCHLIST_ONLY`, or `DEFENSE_MODE`
- Market Dimmer 0-5 and dimmer label
- Benchmark MA stack
- Breadth above EMA21 and EMA50 as count / denominator / percent
- RS leadership breadth as count / denominator / percent
- Distribution / churn
- Failed breakout count
- Risk proxy state
- Reference basket state
- Sector/theme evidence
- Cycle age
- Dimmer components
- One-sentence reason

## Core Lists

- `WEEKLY_UNIVERSE`: 15-20 balanced AURORA candidates from the full eligible universe.
- `WEEKLY_FOCUS`: execution funnel candidates from `WEEKLY_UNIVERSE`.
- `DAILY_TOP_1_4`: maximum four, never forced.
- `AURORA-RSLE Top 20`: separate RS leadership entry list; do not merge into Weekly Universe.
- `Developing Watchlist Next 20`: next tactical/developing candidates.
- Persistent tracking basket maximum: 50.

`DAILY_TOP_1_4` must come from `WEEKLY_FOCUS` only. If the dashboard cannot
render, still show text trade plans for Daily Top 1-4.

## Stock Theme Leadership Table

This table is a theme-clustering view, not a trade-signal table.

- `Weekly`: number of stocks in that theme inside `WEEKLY_UNIVERSE`.
- `Daily Top`: number of stocks in that theme inside `DAILY_TOP_1_4`.
- `RSLE`: number of stocks in that theme inside `AURORA-RSLE Top 20`.
- `Developing`: number of stocks in that theme inside `Developing Watchlist Next 20`.
- `Weighted Presence`: clustering score only:
  `Weekly * 3 + Daily Top * 4 + RSLE * 2 + Developing * 1`.
- `Symbols`: representative stocks from that theme.

Use it to identify where leadership is clustering. Do not use it as a buy
signal, final bucket, or replacement for stock-level setup/risk checks.

## Per-Stock Required Columns

Every rendered candidate table must preserve these columns:

- Rank
- Symbol
- User Note
- Theme
- AURORA Bucket
- Setup
- Price
- Score
- RS
- RRG
- RMV
- BasePivot / RMVP
- PBX
- VE2 Volume
- AXM
- Entry / Stop
- Liquidity
- Caution / Next

`User Note` must stay in the first visible decision columns after `Symbol`; do
not push it to the far right. The visible `Theme` column should show the Aurora
theme/leadership cluster, not raw taxonomy source names.

## Locked Final Buckets

Do not create new final buckets outside the locked AURORA set:

- `TRADE_READY`
- `TRIGGER_READY`
- `EARLY_ENTRY_WATCH`
- `PULLBACK_WATCH`
- `RSNH_WATCH_ONLY`
- `NO_CHASE`
- `PROTECT_PROFIT_REVIEW`
- `REPAIR_WATCH`
- `AVOID_FRESH_LONG`

Diagnostic labels may be added, but they must not become final buckets.

## Conviction Layers

The scanner must calculate and display these layers:

- RS leadership and RS Trifecta
- RS21 / RSNH
- RRG quadrant, ratio, and momentum
- AXM extension matrix
- PBX pullback quality
- VE2 volume signature
- NSE delivery confirmation when available
- BasePivot / BPX
- RMVP
- RMV compression
- Dual stops
- Market context
- Stock-level Aurora theme mapping

Stock-level theme mapping may preserve internal high-level sector metadata, but
the rendered dashboard should show the Aurora theme/leadership cluster.

- India-specific Aurora theme tag for local leadership groups

If a proper ticker-to-sector or NSE/BSE sector file is available, use that source.
Otherwise, use explicit Aurora mappings and name-keyword rules, with source and
confidence stored in data. Unmapped stocks must show `UNMAPPED_REVIEW`; do not
fabricate theme membership.

Ownership rules:

- BPX/BasePivot/RMVP identify structure.
- VE2 validates fuel.
- AXM guards extension.
- PBX grades pullback quality.
- RRG provides rotation/leadership context. Show user-facing quadrant, ratio,
  and momentum only; do not show compass-style direction labels.
- None of these create standalone buy signals.

## Dual-Stop Rule

Always show tactical and thesis stops separately:

- `entry_stop`
- `entry_risk_pct`
- `thesis_stop`
- `thesis_risk_pct`

Entry permission:

- `STANDARD_ENTRY`: entry risk <= 7%
- `VOLATILITY_ADJUSTED_STARTER`: 7-10%, <= 1.25 ATR, reduced size
- `WATCH_FOR_TIGHTER_SHELF`: > 10% or no valid tactical support

Wide thesis risk must not remove an RS leadership discovery candidate when
tactical entry risk is valid. It should add caution, not erase discovery.

## Delivery Data Rule

Use NSE official delivery data when available:

- `DELIV_QTY`
- `DELIV_PER`

VE2 delivery labels:

- `VE2_DELIVERY_ACCUMULATION_CONFIRM`
- `VE2_DELIVERY_DISTRIBUTION_WARNING`
- `VE2_DELIVERY_NEUTRAL`
- `VE2_DELIVERY_NOT_AVAILABLE`

Delivery is a conviction input only. It is not a standalone trade signal.

## Pattern Context Lock

Pattern context is shortlist-only. Do not run expensive or fragile confirmed
pattern classification on the full universe.

Apply only to:

- `WEEKLY_UNIVERSE`
- `WEEKLY_FOCUS`
- `DAILY_TOP_1_4`
- `RSLE_TOP20`
- `Developing Watchlist 20`

Allowed fields:

- `base_stage_count`
- `base_stage_risk`
- `pattern_proxy`
- `pattern_note`

Allowed proxy labels:

- `VCP_STYLE`
- `FLAT_BASE_SHELF`
- `PULLBACK_BASE`
- `IPO_BASE`
- `BASE_ON_BASE_POSSIBLE`
- `CUP_HANDLE_POSSIBLE`
- `DOUBLE_BOTTOM_POSSIBLE`
- `NO_CLEAR_BASE`

Use `POSSIBLE` for cup-with-handle and double-bottom unless a future approved
pattern engine implements confirmed segmentation. Pattern context may update
`user_note`, improve conviction, or add caution. It must not hard-reject
candidate discovery.

Base count guidance:

- `BASE_1_EARLY`: constructive odds
- `BASE_2_VALID`: still valid
- `BASE_3_CAUTION`: require more confirmation
- `BASE_4_LATE_STAGE_RISK`: late-stage caution / no chase / smaller size

Base count is a proxy context field, not a hard O'Neil-certified count. It is
shown in `BasePivot / RMVP` and can update `User Note`. It should add caution
for later-stage bases, not remove full-universe discovery candidates.

## Event Workspace Lock

Maintain one persistent IPO / PEAD / EP / HVE registry inside the main dashboard
when implemented.

Lifecycle labels:

- `NEW`
- `DEVELOPING`
- `ACTIONABLE`
- `EXTENDED_NO_CHASE`
- `FAILED_REPAIR`
- `ARCHIVED`

PEAD must not be inferred from chart alone. It requires earnings/result date
data. EP/HVE can be discovered from OHLCV but must remain event-lane context
until entry rules pass.

## Rejection and Caution Rules

- Rejection blocks promotion, not discovery.
- Show exact failed gates and next promotion condition.
- Liquidity, surveillance class, BSE-only status, restricted series, and wide
  thesis stop should add caution unless they are explicitly locked hard gates.
- Do not fabricate missing data.
- `RS` always means relative strength versus benchmark, never RSI.

## Verification Required After Changes

Run:

```bash
npm test
npm run scan:full -- 2026-06-22
```

Then verify:

- Dashboard renders to `AURORA_India_Unified_Dashboard.html`
- `Market Summary Strength Stack` appears first
- `DAILY_TOP_1_4` is not forced
- Dual stops appear in every candidate table
- Delivery labels appear where NSE delivery data exists
- VE2/PBX/AXM/BPX/RMVP columns remain visible
- RRG quadrant map remains visible
- Rejected/Data Repair route remains visible
- Provenance shows provider route and benchmark
