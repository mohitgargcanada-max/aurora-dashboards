# AURORA Cache Backup, Sell/Extension Watchlist and FOMO/ATR Context Policy

Scope: US, India, and Canada.

This is a policy and design document only. It does not change AURORA formulas, scoring, RS/RMV logic, pivots, buckets, ranking, provider routing, execution logic, data acquisition, workflow cadence, dashboard rendering, or generated artifacts.

## 1. Design intent

```text
Main repo = source code + small tracking state + decision history.
Separate cache repo = recoverable OHLCV/index/sector history.
Dashboard = latest view + tracked lifecycle + sell/extension context.
AURORA-MFH/FOMO/ATR = context-only user layer, not a blocker.
```

The same policy applies to US, India, and Canada. Market-specific differences belong in market notes, provider manifests, calendar/session metadata, or future implementation PRs, not in formula or ranking changes.

## 2. Artifact classes

`SOURCE_CODE`: Human-authored source files, tests, workflow definitions, renderer templates, configs, and supporting scripts.

`RAW_MARKET_CACHE`: Provider-specific raw or normalized historical OHLCV, index, benchmark, sector, and universe data used to restore or extend dashboard inputs.

`CACHE_BACKUP_PACKAGE`: A validated, recoverable cache bundle with manifests, checksums, schema version, provider metadata, and market calendar/session notes.

`PUBLISHED_DASHBOARD_LATEST`: The current user-facing dashboard view for a market.

`PUBLISHED_DASHBOARD_SNAPSHOT`: A retained point-in-time dashboard snapshot used for decision history, audit review, or weekly/monthly references.

`AURORA_TRACKING_LEDGER`: Small per-market state tracking names that appeared in AURORA lists until AURORA exits or archives them.

`SELL_EXTENSION_WATCHLIST_STATE`: Small per-market state for review-only extension, sell-risk, and lifecycle caution notes.

`AUDIT_DOCUMENT`: Read-only review output documenting findings, validation, risks, and recommended follow-up work.

`POLICY_DOCUMENT`: Human-authored policy/design material that constrains future implementation PRs.

## 3. Main repo policy

The main repo may contain:

```text
source code
tests
workflow definitions
renderer templates
configs
small tracking ledgers
weekly decision snapshots
sell/extension watchlist state
audit docs
policy docs
```

The main repo should not contain:

```text
raw 5-year OHLCV cache
large provider raw downloads
temporary raw index cache
unbounded daily generated artifacts
```

This policy does not retroactively remove any currently tracked artifact. It defines the desired boundary for future work: source code and small review state stay in the main repo; large recoverable market cache history belongs in the separate cache repo.

## 4. Separate cache repo

Separate repo:

```text
aurora-market-cache
```

Purpose: recover validated OHLCV, index, benchmark, sector, and universe history for US, India, and Canada when free providers fail.

Structure:

```text
aurora-market-cache/
  us/latest/
  us/weekly/YYYY-WW/
  us/monthly/YYYY-MM/
  india/latest/
  india/weekly/YYYY-WW/
  india/monthly/YYYY-MM/
  canada/latest/
  canada/weekly/YYYY-WW/
  canada/monthly/YYYY-MM/
  manifests/us-cache-manifest.json
  manifests/india-cache-manifest.json
  manifests/canada-cache-manifest.json
```

Each backup package should include:

```text
OHLCV files
benchmark/index files
sector files
universe files
provider manifest
data_as_of manifest
checksum manifest
schema version
market calendar/session note
```

The cache repo is recoverable infrastructure, not a scoring or signal source. It must preserve provider identity and data session metadata so restored history can be validated before dashboard publication.

## 5. Restore / append / backup flow

For US, India, and Canada:

```text
1. Restore latest validated cache from aurora-market-cache.
2. Validate manifest/checksums.
3. Append latest completed session from locked free-first provider route.
4. Run AURORA feature matrix and dashboard.
5. If validation passes, back up changed cache files.
6. Weekly full-universe run writes weekly full backup.
7. Monthly backup is compressed and retained longer.
```

Weekday policy:

```text
restore latest backup
append latest completed bar
backup changed active/current symbols only after validation
```

Weekly policy:

```text
full universe refresh
validate all current universe symbols
write weekly full backup
```

Monthly policy:

```text
compressed permanent archive
```

No dashboard should treat a restored cache as fresh unless the expected completed session is present and validated.

## 6. Provider/failure policy

If free data fails:

```text
use last valid restored cache
mark dashboard stale/partial when latest session is missing
do not publish bad empty dashboard
do not fabricate bars
```

If EODHD is needed:

```text
provider-consistent repair only
never append one EODHD bar into a Yahoo/free-source historical series
```

India guard:

```text
EODHD_REQUIRES_PROVIDER_CONSISTENT_REPAIR
```

The no-provider-blending rule applies to US, India, and Canada. Any future paid-provider repair must preserve provider consistency for the affected history and must not silently blend an EODHD bar into a Yahoo/free-source historical series.

## 7. Active tracking ledger

Per-market files:

```text
markets/us/dashboard/state/active-tracking-ledger.json
markets/india/dashboard/state/active-tracking-ledger.json
markets/canada/dashboard/state/active-tracking-ledger.json
```

Purpose: track stocks from Weekly Universe, Weekly Focus, Daily Top, RSLE, or Developing Watchlist until AURORA exits or archives them.

Suggested schema fields:

```text
symbol
market
first_published_date
first_published_list
theme
initial_bucket
current_bucket
entry_reference
entry_stop
thesis_stop
highest_close_since_publish
latest_close
latest_axm21_label
latest_axm50_label
latest_px_label
latest_aurora_x_state
extension_status
lifecycle_status
last_review_date
exit_date
exit_reason
notes
```

Lifecycle statuses:

```text
ACTIVE
WATCH_ONLY
EXTENDED_REVIEW
PROTECT_PROFIT_REVIEW
SELL_RISK_REVIEW
EXITED
DATA_REPAIR
```

The ledger is small tracking state, not raw market history. It supports lifecycle review and decision history without changing candidate inclusion, buckets, or rankings.

## 8. Sell / Extension Watchlist

Dashboard section for all three markets:

```text
AURORA Sell / Extension Watchlist
```

Rules:

```text
starts empty
only tracked names can enter
extension alone is not a sell signal
sell/extension list is review/caution only
does not replace final_bucket
```

Columns:

```text
Symbol
Original List
First Published
Entry Reference
Latest Close
Gain/Loss from Entry
AXM10 / AXM21 / AXM50
Distance from 21EMA / 50SMA
PX Label
AURORA-X State
VE2 Risk
Sell / Extension Reason
Caution Note
Next Action
Lifecycle Status
```

Allowed review reasons:

```text
AXM21_HOT
AXM21_EXTREME
AXM50_VERY_EXTENDED
AXM50_EXTREME
PX_NO_CHASE
PX_HARD_WARNING
VE2_CLIMAX_VOLUME_WARNING
AURORA_X2_SELL_RISK_REVIEW
AURORA_X3_HARD_BLOCK
21EMA_BREAK_WARNING
50SMA_SERIOUS_WARNING
FAILED_BREAKOUT
THESIS_STOP_BREACH
```

The watchlist is a caution surface. It must not replace final buckets, generate sell signals by itself, or remove names from tracked review without a future implementation contract.

## 9. AURORA-MFH — Market FOMO / ATR Heat Overlay

Definition:

```text
AURORA-MFH = Market FOMO / ATR Heat Overlay
```

Scope:

```text
US
India
Canada
```

Purpose: provide user-facing market heat and chase-risk context using ATR-normalized extension and leadership heat.

Critical rule:

```text
MFH is additional context only.
MFH must not block, remove, rank, promote, demote, buy, sell, or alter any existing AURORA logic.
```

MFH must not:

```text
create final buckets
remove candidates
block candidates
change ranking
change AURORA-SIG
change WWL Score
change RSLE score
change Market Dimmer calculation
change provider routing
create buy signals
create sell signals
replace AXM
replace PX
replace AURORA-X
replace VE2
```

MFH may:

```text
add market heat notes
add user caution notes
support Sell / Extension Watchlist context
explain why fresh chase is risky
highlight when pullback/retest patience is preferred
```

Inputs:

```text
index_axm21
index_axm50
reference_basket_axm21_median
reference_basket_axm50_median
universe_axm21_hot_pct
weekly_universe_axm21_hot_pct
daily_top_no_chase_pct
leader_ve2_climax_count
failed_breakout_count_10d
distribution_churn_count_10d
leadership_breadth_pct
gap_chase_pressure_pct
```

Outputs:

```text
market_fomo_score: 0-100
market_fomo_label
market_fomo_note
market_fomo_context_status
```

Labels:

```text
FOMO_0_COOL
FOMO_1_NORMAL
FOMO_2_WARM
FOMO_3_HOT
FOMO_4_EUPHORIC
FOMO_5_CLIMAX_RISK
```

Interpretation:

```text
FOMO_0_COOL = no broad chase pressure
FOMO_1_NORMAL = healthy participation
FOMO_2_WARM = leadership strong but not dangerously stretched
FOMO_3_HOT = many leaders extended; avoid low-quality chase
FOMO_4_EUPHORIC = broad extension pressure; prefer pullbacks/retests
FOMO_5_CLIMAX_RISK = climax/overheat risk; protect profits and avoid fresh chase
```

User notes examples:

```text
Market heat is elevated; prefer pullback/retest entries over chasing breakouts.
Stock is extended 4.2 ATR above 21EMA; avoid fresh entry until reset.
Leadership cohort is hot; keep position review active, but extension alone is not a sell signal.
Sell-risk review requires failed breakout, weak close, VE2 distribution, MA break, or thesis-stop breach.
```

## 10. Market-specific notes

US:

```text
Use US benchmark/reference basket context. Examples: SPY/QQQ/IWM/risk-on proxies and US mega-cap/reference-basket behavior.
```

India:

```text
Use India benchmark/reference basket context. Preserve ASM/GSM/T2T/SME/BE/circuit caution in sell-extension notes. Do not treat surveillance as FOMO.
```

Canada:

```text
Use Canada benchmark/reference basket context. Use TSX/TSXV suffix mapping and Canadian liquidity context. Resource-sector heat must not be mixed with US sector behavior.
```

## 11. Future implementation PRs

1. Create aurora-market-cache repo and restore/upload scripts.
2. Add per-market active tracking ledger schema.
3. Add Sell / Extension Watchlist dashboard section.
4. Add AURORA-MFH fields to market context as context-only output.
5. Wire AXM/PX/AURORA-X/VE2 review reasons into sell-watchlist population.
6. Add tests proving MFH does not alter buckets, scores, ranking, provider routing, or candidate inclusion.
