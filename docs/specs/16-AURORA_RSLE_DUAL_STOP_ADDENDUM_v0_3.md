# AURORA-RSLE Leadership and Dual-Stop Addendum v0.3

**Target master:** AURORA v2.18.3
**Supersedes:** RSLE Dual Stop v0.2 and conflicting RSLE integration language
**Uses:** RS Leadership Enhancement v0.2 except where this v0.3 controls

## Module Name

```text
AURORA-RSLE = Relative Strength Leadership Entry Scan
```

Mental model:

```text
RSLE = WHICH STRONG LEADER HAS A TACTICAL ENTRY NOW?
```

## Purpose

Separate trade-entry risk from broad thesis invalidation so strong leaders are
not removed merely because the deepest structural support is far below price.
This addendum does not weaken RS Trifecta, BasePivot, RMVP, PBX, AXM, VE2 or
SellRisk rules.

## v0.3 Controlling Corrections

### A. Two Independent Ranks

RSLE must preserve two separate questions:

- leadership_rank: which stocks are becoming leaders?
- tactical_rank: which leaders have executable entries now?

Keep the v0.2 weighted RS score as rsle_leadership_score, with these
deterministic component mappings:

- RS Rating: use the 1-99 rating directly.
- RS 1W/1M/3M: use their 1-99 universe percentiles directly.
- RS21: accelerating 100; hold 85; reclaim 0-2D 75; reclaim 3-5D 65;
  approaching 40; below 10; break warning 0.
- Stock RRG: sweet spot 100; Leading with positive tail 95; Leading 85;
  early rotation 80; Improving with positive tail 80; Improving 70;
  Weakening 35; Lagging 15; breakdown 0.
- Trifecta: PASS 100; PARTIAL 65; FAIL 25.

Do not renormalize missing mandatory RS fields. Route them to RS_DATA_REPAIR.

Calculate tactical readiness separately:

- setup quality: certified trigger 100; early entry/pocket pivot 90;
  pullback/retest 80; inside bar/RMV coil 75; RSNH watch 55;
  tighter shelf 35; repair 0.
- entry-risk quality: standard <=4% 100; standard 4-7% 80;
  volatility-adjusted starter 55; tighter shelf 20; repair 0.
- VE2: strong 100; constructive 80; neutral/partial 50; weak 20; failure 0.
- extension safety: normal 100; mild 80; extended 45; no-chase 15;
  hard warning 0.

rsle_tactical_score =
  45% leadership score + 20% setup quality + 15% entry-risk quality
  + 10% VE2 + 10% extension safety.

Sort Top Tactical by entry-permission priority, tactical score, leadership
score, liquidity percentile and symbol. Sort Developing by leadership score,
then tactical score.

Top Tactical eligibility additionally requires `rsle_leadership_score >= 50`.
This prevents a merely tight stop from promoting a weak relative-strength stock.
Names below 50 remain visible in Developing or Data Repair and are never erased.
An `RSLE_WATCH_FOR_TIGHTER_SHELF` or `RSLE_DATA_REPAIR` setup lane can only
reduce entry permission; a small calculated risk cannot upgrade incomplete
setup geometry to `RSLE_STANDARD_ENTRY`.

### B. List Sizes

- RSLE_TOP_20_TACTICAL: maximum 20, never padded.
- RSLE_DEVELOPING_21_40: maximum 20, never padded.

The developing list contains emerging leaders awaiting tighter geometry,
confirmation, market permission or data repair. Both remain independent from
WEEKLY_UNIVERSE and do not consume the persistent Core basket cap.

### C. Setup Namespace

RSLE labels are diagnostics in rsle_setup_lane:

- RSLE_TRIGGER_READY
- RSLE_EARLY_ENTRY
- RSLE_PULLBACK
- RSLE_POCKET_PIVOT
- RSLE_INSIDE_BAR
- RSLE_RMV_COIL
- RSLE_RSNH_WATCH
- RSLE_WATCH_FOR_TIGHTER_SHELF
- RSLE_DATA_REPAIR

They must never be written into final_bucket. Core promotion separately uses
the nine locked AURORA buckets after all normal gates.

### D. India Benchmark and Routing

India RS calculations use one cap-matched benchmark consistently:

- large/general broad universe: ^CNX500
- mid-cap: ^CNXMID
- small-cap: ^CNXSC

If unavailable, declare a Nifty 500 proxy. Do not silently use Nifty 50 for
mid- or small-cap stocks.

India source order is official NSE/BSE, other reliable free public sources,
Yahoo .NS/.BO, connected India provider, then EODHD last.

### E. India Liquidity

Remove the fixed INR 1.6B discovery exclusion from RSLE. Calculate ADDV20 INR,
its valid-universe percentile, zero-volume days, circuit days and surveillance
class.

- HIGH: percentile >=70
- ADEQUATE: 40-69
- THIN: 15-39
- VERY_THIN: below 15
- DATA_REPAIR: invalid turnover

Liquidity and ASM/GSM/T2T/SME/BE/circuit classifications remain visible. They
may cap execution permission but cannot erase discovery.

### F. Stable Stock RRG

The raw-return division proxy is superseded because it is unstable when the
benchmark return is zero, near zero or negative.

Using aligned weekly closes:

- weekly_rs_line = stock_weekly_close / benchmark_weekly_close
- rrg_ratio = 100 * weekly_rs_line / EMA(weekly_rs_line, 10)
- rrg_momentum = 100 * rrg_ratio / EMA(rrg_ratio, 10)

Use the locked 100/100 quadrants and persist prior quadrant, transition, tail
deltas, direction, transition date and age. RRG evidence belongs only in
RRGScore, not RSScore.

### G. Entry Reference and Dual Stops

Entry reference:

- pending certified trigger: active trigger
- trigger accepted at EOD: completed-session close
- failed or stale trigger: no reference until a new setup is certified

Do not use max(close, trigger) without validating trigger state.

Choose a tactical anchor owned by the active setup. Apply:

- buffer = max(tick size, 0.5% of entry reference)
- anchor_stop = tactical anchor - buffer
- noise_floor_stop = entry reference - 0.50 * ATR14
- entry_stop = min(anchor_stop, noise_floor_stop)
- entry_risk_per_share = entry reference - entry_stop
- entry_risk_pct = entry risk per share / entry reference * 100
- entry_risk_atr = entry risk per share / ATR14

Keep thesis_stop as the certified base/trend/structural invalidation.

Mandatory invariants:

- thesis_stop <= entry_stop < entry_reference
- ATR14 > 0
- tactical anchor belongs to the active completed-EOD setup
- entry stop is below the buffered support anchor

Failure is STOP_DATA_REPAIR, never a permissive default.

### H. Permission Tiers

- RSLE_STANDARD_ENTRY: valid anchor and entry risk <=7%.
- RSLE_VOLATILITY_ADJUSTED_STARTER: entry risk >7% and <=10%,
  entry_risk_atr <=1.25, liquidity not DATA_REPAIR, and Trifecta PASS or
  PARTIAL with a fresh RS21 reclaim.
- RSLE_WATCH_FOR_TIGHTER_SHELF: entry risk >10% or no valid tactical anchor.
- RSLE_EXECUTION_CAUTION: technically valid but liquidity, surveillance or
  circuit conditions cap execution.

Never compare entry_risk_pct directly with ATR14 in price units.

For reporting only, risk_budget_multiplier is 1.00 standard, 0.50 starter and
0.00 watch/caution unless a separate user policy overrides it. This is not a
position recommendation.

### I. Structural Damage

A wide but intact thesis stop cannot reject discovery. Actual thesis-stop
violation, Stage 4, AURORA-X hard block, confirmed failed breakout or an
execution prohibition can still block Core promotion.

Use entry_stop and entry_risk_pct for entry permission, RiskScore and Daily Top
ranking. Show thesis_stop and thesis_risk_pct as structural context.

### J. Point-in-Time Ratings

Recalculate the RS Rating independently at current, 5D-prior and 20D-prior
snapshots using the valid eligible universe at each date. Persist denominators.
If historical membership is unavailable, label CURRENT_UNIVERSE_BACKCAST and
disclose survivorship risk.

### K. Required Acceptance Tests

1. Both lists contain at most 20 and are never padded.
2. Trifecta remains unchanged.
3. RSLE setup labels never enter final_bucket.
4. India benchmarks are cap matched and consistent.
5. Stable RRG never divides one raw return by another.
6. entry_risk_atr compares price risk with ATR price units.
7. thesis_stop <= entry_stop < entry_reference.
8. Wide intact thesis risk never erases discovery.
9. Structural failure still blocks Core promotion.
10. Tactical sorting favors executable setups without erasing leadership rank.
11. Liquidity/surveillance remain visible and do not erase discovery.
12. No additional OHLCV fetch is made for RSLE calculations.

## Independent List Governance

RSLE is a separate list inside the same market dashboard. It must not replace,
merge into, pad or automatically displace the balanced `WEEKLY_UNIVERSE`.

```text
WEEKLY_UNIVERSE       = balanced full-AURORA 15-20 stock selection
NEAR_WATCHLIST        = broader constructive tracking list
RSLE_TOP_10_TACTICAL  = ranks 1-10, highest-priority tactical list
RSLE_QUEUE_11_20      = ranks 11-20, developing leadership queue
RSLE_TOP_20           = combined independent RS + liquidity list
DAILY_TOP_1_4         = full execution funnel after all required confirmation
```

A stock may appear in both RSLE and another list. Show the overlap label rather
than deleting either record. RSLE discovery does not itself promote a stock to
Core Top Entries.

RSLE has a maximum of 20 names and must not be padded. It is a calculated view,
not part of the persistent 50-stock Core tracking-basket cap.

```text
Ranks 1-10:
  highest RSLE scores with tactical setup priority
  label TOP_10_TACTICAL

Ranks 11-20:
  next-highest RSLE scores retained for developing entry structure
  label LEADERSHIP_QUEUE_11_20
```

Every row retains its actual setup and permission tier. Queue membership must
not falsely imply that a valid entry is unavailable, and Top 10 membership must
not override `WATCH_FOR_TIGHTER_SHELF` when tactical risk is too wide.

## Schedule

```text
Sunday:
  calculate RSLE from the rebuilt complete market universe

Weekdays:
  recalculate RSLE after the lightweight full-universe discovery update
  use the newly appended completed daily bar
  permit stocks to enter or leave RSLE immediately
```

The Sunday list provides no membership protection. RSLE is always dynamic.

## Discovery Gates

Only these are hard RSLE discovery gates:

```text
valid completed-session OHLCV history
correct benchmark alignment
market-specific liquidity pass
calculable RS stack
recognizable tactical setup geometry
```

Fundamentals, sector, theme, Stage, AXM, VE2 and catalysts may enrich or caution
RSLE but must not suppress universe-wide discovery. Full AURORA promotion still
uses all locked requirements.

## RS Leadership Stack

Calculate and display:

```text
RS relative return and universe percentile: 1W, 1M and 3M
IBD-style weighted RS Rating: 1-99
RS Rating change: 5D and 20D
RS line versus EMA21: reclaim, hold, acceleration or warning
RS Trifecta: PASS, PARTIAL or FAIL without changing its locked definition
stock RRG quadrant and direction
```

RSLE ranking score:

```text
25% IBD-style RS Rating
10% RS 1W percentile
15% RS 1M percentile
15% RS 3M percentile
15% RS21 timing state
10% stock RRG state/direction
10% RS Trifecta state
```

Liquidity is a gate and capacity field, not a momentum-score substitute.

## Setup Lanes

```text
TRIGGER_READY
EARLY_ENTRY
PULLBACK
POCKET_PIVOT
INSIDE_BAR
RMV_COIL
RSNH_WATCH
WATCH_FOR_TIGHTER_SHELF
```

RSLE may use AURORA setup geometry to classify timing, but the RSLE rank remains
an RS leadership rank.

## Dual-Stop Contract

Every actionable candidate must expose both stops:

```text
entry_stop       = tactical failure of the current setup
thesis_stop      = failure of the broader base, trend or structural thesis
entry_risk_pct   = (entry_reference - entry_stop) / entry_reference * 100
thesis_risk_pct  = (entry_reference - thesis_stop) / entry_reference * 100
```

`entry_risk_pct` controls entry permission and position sizing.
`thesis_risk_pct` is context and must not reject an otherwise valid discovery
candidate.

## Entry Reference

```text
entry_reference = active certified trigger when pending
entry_reference = completed-session close after accepted trigger
entry_reference = UNKNOWN when trigger is stale or failed
```

For a future trigger, use the active BasePivot, RMVP or setup trigger. For a
trigger already cleared at EOD, use the completed-session close.

## Tactical Entry Stop

Choose the stop from the setup that is actually being traded:

```text
setup_bar_stop = setup_bar_low - 0.5% price buffer
noise_floor_stop = entry_reference - 0.50 * ATR14
entry_stop = min(setup_bar_stop, noise_floor_stop)
```

Production setup-specific anchors take precedence when certified:

```text
RMVP entry       -> below RMVP range low
BasePivot probe  -> below setup/probe bar low
Pullback entry   -> below pullback low or defended MA/AVWAP/HVC shelf
Inside-bar entry -> below mother-bar or inside-bar low, according to trigger
Retest entry     -> below support-flip/retest low
```

The 0.50 ATR floor prevents a visually tight but noise-prone stop. A stop is
invalid if it is above the relevant support anchor or if no completed EOD setup
bar exists.

## Permission Tiers

```text
STANDARD_ENTRY:
  entry_risk_pct <= 7

VOLATILITY_ADJUSTED_STARTER:
  7 < entry_risk_pct <= 10
  AND entry_risk_atr <= 1.25
  AND liquidity passes
  AND RS Trifecta is PASS or PARTIAL with fresh RS21 reclaim
  AND position size is reduced to preserve fixed portfolio risk

WATCH_FOR_TIGHTER_SHELF:
  entry_risk_pct > 10
  OR no valid tactical support anchor
```

The volatility-adjusted tier is a starter entry, not permission for normal
position size. Portfolio loss budget remains unchanged:

```text
position_size = allowed_portfolio_loss / entry_risk_per_share
```

## Routing

Wide thesis risk must not cause candidate rejection:

```text
strong RS + liquidity + valid setup + wide thesis stop
  -> retain in TRIGGER_READY, EARLY_ENTRY_WATCH or PULLBACK_WATCH
  -> display tactical permission tier
  -> display broad thesis invalidation separately
```

If tactical risk is too wide, route to `WATCH_FOR_TIGHTER_SHELF`, not the
rejected universe. Recalculate after every completed bar because a new inside
bar, RMV5 coil, pullback shelf or support retest can create a valid entry.

## Dashboard Fields

```text
entry_reference
entry_stop
entry_risk_pct
entry_risk_tier
thesis_stop
thesis_risk_pct
position_size_factor
next_tactical_condition
rsle_rank
rsle_score
rs_rating
rs_rating_delta_5d
rs_rating_delta_20d
rs_1w_rating
rs_1m_rating
rs_3m_rating
rs21_state
rs_trifecta
rrg_quadrant
rrg_direction
weekly_overlap_label
```

Never label a stock `TRADE_READY` using thesis risk alone. Never hide a strong
leader solely because thesis risk exceeds 7%.

## Cross-Market Application

RSLE is mandatory for US, India and Canada dashboards. The formula and dual-stop
logic remain identical; only universe, benchmark, ticker mapping, currency,
liquidity and local surveillance rules change.

### United States

```text
Universe: active Nasdaq, NYSE and NYSE American common stocks
Benchmark: dashboard-selected US benchmark, SPY default for broad RSLE
Liquidity: existing US gate, currently USD 20M average dollar volume
Currency: USD
```

### India

```text
Universe: active NSE/BSE eligible equities from the India dashboard
Benchmark: cap-matched ^CNX500 / ^CNXMID / ^CNXSC; declared Nifty 500 proxy only when required
Liquidity: ADDV20 universe-percentile label; caution/cap, not discovery erasure
Currency: INR
Preserve: ASM, GSM, T2T, SME, BE-series and circuit-day labels
```

Surveillance labels do not erase discovery. They can block execution permission
or force a caution tier according to the locked India rules.

### Canada

```text
Universe: active TSX, TSX Venture, CSE and Cboe Canada eligible equities
Benchmark: S&P/TSX Composite; XIC.TO/ZCN.TO/VCN.TO only as declared fallback
Liquidity: use the existing Canada CAD-value/volume gate
Currency: CAD
```

Do not apply the US USD 20M threshold mechanically to India or Canada.

## Data and Token Efficiency

RSLE uses the same fetch-once feature plane as the market dashboard. After the
historical cache is established, append one completed daily bar and recalculate
in code. Deep fundamentals, catalyst research and web enrichment are limited to
shortlisted names. Universe-wide RSLE discovery must never be reduced for token
economy.

Never blend providers inside one stock or benchmark indicator series. Preserve
the market-specific free-first routing and provenance labels.

## Promotion Rule

RSLE inclusion means `TACTICAL_RS_CANDIDATE`, not automatic Core promotion.
Promotion into Core Top Entries requires the locked AURORA confirmation stack,
including EOD acceptance, RS confirmation, constructive VE2, valid BasePivot or
RMVP, manageable AXM extension and a clear executable stop.
