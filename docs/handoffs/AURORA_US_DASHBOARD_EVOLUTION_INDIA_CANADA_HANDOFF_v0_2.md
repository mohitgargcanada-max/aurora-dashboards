# AURORA Dashboard Evolution: India and Canada Handoff

## Objective

Bring the India and Canada dashboards to the same architecture and calculation
discipline now used by the US dashboard, while preserving each market's source,
benchmark, currency, liquidity and surveillance rules.

## Current Architecture

Use one automation and one stable HTML dashboard per market. Each dashboard has:

```text
Workspace 1: Core AURORA
Workspace 2: IPO / PEAD / EP Events
```

Do not create separate weekly, daily or event automations. Update the same HTML
file every run.

## Schedule and Dynamic Universe

Run at 9:00 a.m. in the market dashboard's locked timezone.

```text
Sunday:
  rebuild the complete eligible universe
  select a fresh persistent 15-20 stock WEEKLY_UNIVERSE

Weekdays:
  refresh IPO/PEAD/EP registry first
  append the latest completed daily bar
  run a lightweight full-universe discovery scan
  update WEEKLY_FOCUS and maximum DAILY_TOP_1_4
```

Weekday discovery must scan the full eligible universe, not merely rerank the
Sunday list. Stocks can enter, exit or be replaced midweek.

## Fetch Once, Calculate Everything

Bootstrap sufficient adjusted OHLCV history once. Cache it per symbol and
benchmark. On normal weekdays append one completed bar, validate it and run all
AURORA calculations locally in code.

Token efficiency may limit fundamentals, catalysts and web enrichment to
shortlisted candidates. It must never reduce universe-wide technical discovery.

Never blend providers inside a single indicator series. Show provider, endpoint,
data date, currency, adjustment status and fallback label.

## Tracking Lists

```text
WEEKLY_UNIVERSE: 15-20 balanced full-AURORA candidates
NEAR_WATCHLIST: 10-20 constructive candidates
hard persistent basket maximum: 50
DAILY_TOP_1_4: maximum four; never force padding
```

Keep searchable Scanner Candidate, Rejected and Data Repair routes. Rejection
blocks promotion, not discovery, and every rejected stock must show exact failed
gates and its next promotion condition.

## RS Leadership Enhancement

Preserve the locked RS Trifecta and add:

```text
RS 1W, 1M and 3M relative returns and universe percentile ratings
IBD-style weighted RS Rating 1-99
RS Rating change over 5D and 20D
RS line versus EMA21: reclaim, hold, acceleration and warning states
stock RRG quadrant and direction
deterministic RS Leadership Note
```

RS Trifecta remains confirmation. The added measures reveal stocks moving toward
leadership before all Trifecta conditions align.

## Separate AURORA-RSLE List

Add an independent dashboard section:

```text
AURORA-RSLE = Relative Strength Leadership Entry Scan
RSLE_TOP_10_TACTICAL = ranks 1-10
RSLE_QUEUE_11_20 = ranks 11-20
RSLE_TOP_20 = combined independent list
```

Do not merge RSLE into the balanced Weekly Universe. A stock may overlap both
lists and should show an overlap label. RSLE is outside the persistent 50-stock
Core tracking-basket cap because it is a calculated view, not a separately
enriched persistent portfolio list.

RSLE hard discovery gates are valid data, benchmark alignment, market-specific
liquidity, calculable RS and recognizable setup geometry. Rank using the RS stack
defined in `AURORA_RSLE_DUAL_STOP_ADDENDUM_v0_2.md`.

## Dual-Stop Correction

The earlier dashboards used the broad structural/thesis invalidation as the
entry stop. This incorrectly hid strong volatile leaders whose deeper base stop
was 15-25% away even when the current setup supplied a valid tactical stop.

RSLE must display separately:

```text
entry_stop and entry_risk_pct
thesis_stop and thesis_risk_pct
```

Entry permission:

```text
STANDARD_ENTRY: entry risk <=7%
VOLATILITY_ADJUSTED_STARTER: 7-10%, <=1.25 ATR and reduced position size
WATCH_FOR_TIGHTER_SHELF: >10% or no valid tactical support
```

Wide thesis risk must never remove a strong RSLE discovery candidate. Wait for
an inside bar, RMV5 coil, RMVP, pullback shelf or support retest when tactical
risk remains too wide.

## Core Dashboard Sections

Preserve or add:

```text
Market State
Weekly Universe
Daily Top Entries
RS21 / RSNH
AURORA-RSLE
RMVP / Early Entry
Pullback
Compression
BasePivot / Patterns
AVWAP / HVC
VE2
Sector and Theme RRG
Squat / Retest
No-Chase / Risk
Near Watchlist
All Candidates / Rejected
```

## Event Workspace

Maintain one persistent registry for IPO/New Listings, PEAD and EP with lifecycle
buckets:

```text
NEW
DEVELOPING
ACTIONABLE
EXTENDED_NO_CHASE
FAILED_REPAIR
ARCHIVED
```

The weekday full-universe scan must discover new IPO, PEAD, EP, catalyst and
non-index candidates. Promote to Core only after all locked AURORA entry rules
pass.

## India-Specific Requirements

Use NSE/BSE official files and existing India providers first, then Yahoo `.NS`
or `.BO`, then the existing India fallback, with EODHD last. Preserve ASM, GSM,
T2T, SME, BE-series, delivery and circuit-day classifications. Use the locked
India benchmark and INR liquidity gate. Do not copy the US USD threshold.

## Canada-Specific Requirements

Use official TSX, TSXV, CSE, Cboe Canada, SEDAR+ and issuer sources first; Yahoo
`.TO`/`.V` for OHLCV; EODHD last. Use the S&P/TSX Composite benchmark with
declared ETF fallback only when needed. Use CAD liquidity thresholds appropriate
to the Canadian market; do not copy the US USD threshold.

## Required Verification

```text
validate latest completed-session date
validate OHLCV integrity and adjusted/unadjusted status
verify RS percentile denominator is the full liquid eligible universe
test RS Rating point-in-time calculations at current, 5D and 20D snapshots
test exact locked RS Trifecta independently
test dual-stop noise floor and permission tiers
verify RSLE remains separate from WEEKLY_UNIVERSE
verify RSLE contains no more than 20 names without forced padding
verify ranks 1-10 and 11-20 carry their correct list-tier labels
verify persistent tracking basket never exceeds 50
render desktop and mobile dashboard views
```
