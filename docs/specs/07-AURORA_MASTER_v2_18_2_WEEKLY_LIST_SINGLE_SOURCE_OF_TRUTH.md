# AURORA Scanner Master Spec v2.18.2 — SINGLE SOURCE OF TRUTH

**Status:** ACTIVE MASTER — replaces separate master + patch/delta tracking  
**Date:** 2026-06-14  
**Scope:** EOD scanner only  
**Markets:** US, India, Canada  
**Primary purpose:** Find the earliest clean entries in the strongest stocks, while keeping market regime, leadership breadth, risk, scan-specific output discipline, and AURORA-owned weekly watchlist generation intact.

---

## 0. How to Use This File

This is the only AURORA scanner spec to maintain going forward.

```text
Use this file instead of maintaining:
  - v2.16 master baseline
  - v2.17 backtest handoff
  - v2.18 patch files
  - v2.18.1 refinement files
```

Older files are now archived references only. If any older file conflicts with this file, this file wins.

---

## 0.1 Version Hierarchy Locked Into This File

```text
v2.16 = behavioral scanner baseline preserved here
v2.17 = implementation/backtest handoff preserved here where correct
v2.18 = multi-market RMV/execution-funnel/math/label upgrade integrated here
v2.18.1 = NotebookLM v2 precision refinements integrated here
v2.18.2 = AURORA-owned Weekly Watchlist generation and persistence integrated here

ACTIVE = AURORA_MASTER_v2_18_2_WEEKLY_LIST_SINGLE_SOURCE_OF_TRUTH.md
```

This file is not an addendum. It is the merged source of truth.

---

## 0.2 Non-Negotiable Operating Locks

```text
AURORA remains EOD.
AURORA-INTRADAY remains future scope.
No live order logic.
No real-time buy-stop automation.
No account-equity sizing.
No personal journal / psychology / self-learning state inside scanner core.
No new labels without input fields, formulas, thresholds, fallback, and tests.
Every lane must be CALCULATED / PARTIAL / UNKNOWN / NOT_APPLICABLE.
```

EOD-compatible calculations remain active:

```text
AVWAP from daily bars
HVC from daily high-volume close
RMV / RANGE_RMV_PROXY from daily bars
RRG / RLT using EOD data
Market Summary Strength Stack
Theme/rank/rotation tables where data exists
```

Future-scope only:

```text
FUTURE_INTRADAY_RUN_RATE_935
FUTURE_INTRADAY_PIVOT_TRIGGER
FUTURE_INTRADAY_LOD_STOP
FUTURE_SESSION_VWAP
FUTURE_PREMARKET_GAP_SCAN
```

---

## 0.3 Final Bucket Taxonomy — Locked

Only these values may appear as `final_bucket`:

```text
TRADE_READY
TRIGGER_READY
EARLY_ENTRY_WATCH
PULLBACK_WATCH
RSNH_WATCH_ONLY
NO_CHASE
PROTECT_PROFIT_REVIEW
REPAIR_WATCH
AVOID_FRESH_LONG
```

These are not final buckets:

```text
LIQUIDITY_FAIL
WATCHLIST_ONLY
STAGE_4_DAMAGED
AURORA_X_HARD_BLOCK
PX_HARD_WARNING
MARKET_CORRECTION_WATCHLIST_ONLY
SQUAT_INTACT_SECOND_CHANCE
RMV_PIVOT_TRIGGER_READY
SLEEPER_THEME_EMERGING
DAILY_TOP1
DAILY_TOP4
```

Diagnostic states go into:

```text
setup_state
status_flag
override_reason
quality_notes
watchlist_action
execution_tier
```

---

## 0.4 AURORA-SIG Score — Active 10-Component Score

```text
AURORA-SIG = active score, 0-100.
ACS is legacy alias only: acs_score = aurora_sig_score.
Never compute ACS and SIG independently in the same runtime.
```

| Component | Weight | Measures |
|---|---:|---|
| MarketScore | 12 | MC2 cycle state + market permission + dimmer context |
| RSScore | 12 | RS Trifecta + RSNH + benchmark/peer strength |
| RRGScore | 10 | RRG quadrant + rotation phase + theme tracker |
| PatternScore | 13 | Base type + count + compression + RMV/VCP/SEPA context |
| EntryScore | 10 | Trigger quality + pocket pivot + EMA cross + RMV pivot quality + priming pattern |
| VolumeScore | 10 | Volume Edge + accumulation + effort/result |
| FundamentalScore | 10 | Q label + growth/quality/value overlay, non-blocking |
| PullbackScore | 8 | MA respect + volume dry-up + MTF + RMV/HVC/AVWAP confluence |
| RiskScore | 10 | Stop clarity + risk % + invalidation quality |
| ExtensionSafetyScore | 5 | 5 = clean; 0 = badly extended / PX danger |
| **Total** | **100** |  |

```text
TechnicalStrengthScore = MarketScore + RSScore + RRGScore + PatternScore + EntryScore + VolumeScore + PullbackScore + RiskScore
Max = 85
TECHNICALLY_ELITE    >= 70/85
TECHNICALLY_STRONG   55-69/85
TECHNICALLY_ADEQUATE 40-54/85
TECHNICALLY_WEAK     < 40/85
```

Runtime alias:

```python
candidate["aurora_sig_score"] = aurora_sig_score
candidate["acs_score"] = aurora_sig_score  # legacy read-only alias

sig = candidate.get("aurora_sig_score", None)
score = candidate.get("acs_score", 0) if sig is None else sig
```

---

## 0.5 Hard Overrides

| Condition | Final bucket / cap | Diagnostic field |
|---|---|---|
| Stage 4 | AVOID_FRESH_LONG | override_reason = STAGE_4_DAMAGED |
| AURORA-X X3/X4 | AVOID_FRESH_LONG | override_reason = AURORA_X_HARD_BLOCK |
| Market correction | cap at RSNH_WATCH_ONLY unless holding review | status_flag = MARKET_CORRECTION_WATCHLIST_ONLY |
| PX_HARD_WARNING | NO_CHASE | status_flag = PX_HARD_WARNING |
| Liquidity fail | AVOID_FRESH_LONG | override_reason = LIQUIDITY_FAIL |
| Weekly broken + no base | REPAIR_WATCH | override_reason = WEEKLY_BROKEN_NO_BASE |

Backtest may block entries using `_no_signal()`. Live scanner must not silently hide candidates unless a hard override applies. In live mode, show the candidate with visible `final_bucket`, `score_cap`, `status_flag`, and `override_reason`.

---

# PART A — Market Adapters

## A.1 Market Profile Object

All engines must use a market adapter. Never hard-code US-only symbols into India or Canada scans.

```python
market_profile = {
    "market": "US | INDIA | CANADA",
    "currency": "USD | INR | CAD",
    "benchmark_primary": "...",
    "benchmark_growth": "...",
    "benchmark_breadth": "...",
    "risk_on_proxies": [],
    "sector_proxy_map": {},
    "reference_basket_policy": "dynamic_top_market_cap_preferred",
    "reference_basket_static_fallback": [],
    "liquidity_min_addv_local": None,
    "liquidity_min_addv_usd_equiv": 20_000_000,
    "universe_default": "...",
    "classification_system": "GICS-style sector / main industry / sub-industry / theme",
}
```

## A.2 US Adapter

```python
US_PROFILE = {
    "market": "US",
    "currency": "USD",
    "benchmark_primary": "SPY",
    "benchmark_growth": "QQQ",
    "benchmark_breadth": "IWM",
    "risk_on_proxies": ["QQQ", "IWM", "SMH", "IBIT", "ARKK"],
    "sector_proxy_map": {
        "Technology": "XLK", "Financials": "XLF", "Industrials": "XLI",
        "Energy": "XLE", "Consumer Discretionary": "XLY", "Consumer Staples": "XLP",
        "Health Care": "XLV", "Utilities": "XLU", "Communication Services": "XLC",
        "Materials": "XLB", "Real Estate": "XLRE",
    },
    "reference_basket_policy": "top_10_by_market_cap_from_current_universe; fallback_static_if_unavailable",
    "reference_basket_static_fallback": ["NVDA", "MSFT", "AAPL", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "JPM", "BRK.B"],
    "liquidity_min_addv_local": 20_000_000,
    "liquidity_ideal_addv_local": 50_000_000,
    "universe_default": "liquid NYSE/NASDAQ universe or requested index universe",
}
```

## A.3 India Adapter

```python
INDIA_PROFILE = {
    "market": "INDIA",
    "currency": "INR",
    "benchmark_primary": "^NSEI",
    "benchmark_growth": "NIFTY500 or provider Nifty 500 proxy",
    "benchmark_breadth": "NIFTYMIDCAP150 / NIFTYSMALLCAP250 where available",
    "risk_on_proxies": ["NIFTY500", "NIFTYMIDCAP150", "NIFTYSMALLCAP250", "NIFTYIT", "BANKNIFTY", "NIFTYAUTO", "NIFTYMETAL"],
    "sector_proxy_map": {
        "Information Technology": "NIFTYIT", "Financials": "BANKNIFTY",
        "Automobiles": "NIFTYAUTO", "Pharma": "NIFTYPHARMA",
        "Energy": "NIFTYENERGY", "Infrastructure": "NIFTYINFRA",
        "FMCG": "NIFTYFMCG", "Metals": "NIFTYMETAL",
        "Realty": "NIFTYREALTY", "PSU Banks": "NIFTYPSUBANK",
    },
    "reference_basket_policy": "top_10_by_free_float_market_cap_from_current_NSE_universe; fallback_static_if_unavailable",
    "reference_basket_static_fallback": ["RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "SBIN", "INFY", "LT", "ITC", "HINDUNILVR"],
    "liquidity_min_addv_local": 1_600_000_000,  # approx local equivalent of $20M; adapter may refresh FX
    "liquidity_ideal_addv_local": 4_000_000_000,
    "universe_default": "Nifty 500 or liquid NSE universe unless user requests otherwise",
}
```

India shareholding note:

```text
India government / LIC shareholding is external-data-required.
Do not rely on generic holder data for India government/LIC holdings.
Use exchange filings, BSE/NSE shareholding pattern, or production-grade vendor source.
If unavailable: mark PARTIAL / UNKNOWN, do not fabricate.
```

## A.4 Canada Adapter

```python
CANADA_PROFILE = {
    "market": "CANADA",
    "currency": "CAD",
    "benchmark_primary": "^GSPTSE",
    "benchmark_growth": "XIT.TO or technology proxy where available",
    "benchmark_breadth": "XIC.TO / XIU.TO / liquid TSX universe breadth",
    "risk_on_proxies": ["XIC.TO", "XIU.TO", "XIT.TO", "XEG.TO", "SHOP.TO"],
    "sector_proxy_map": {
        "Financials": "XFN.TO", "Energy": "XEG.TO", "Technology": "XIT.TO",
        "Materials": "XMA.TO", "Industrials": "ZIN.TO or peer proxy",
        "Utilities": "ZUT.TO", "Real Estate": "XRE.TO",
    },
    "reference_basket_policy": "top_10_by_market_cap_from_current_TSX_universe; fallback_static_if_unavailable",
    "reference_basket_static_fallback": ["RY.TO", "TD.TO", "BMO.TO", "BNS.TO", "ENB.TO", "CNQ.TO", "CNR.TO", "CP.TO", "SHOP.TO", "TRI.TO"],
    "liquidity_min_addv_local": 2_000_000,
    "liquidity_ideal_addv_local": 5_000_000,
    "universe_default": "liquid TSX universe unless user requests otherwise",
}
```

---

# PART B — Core Scanner Pipeline Retained

## B.1 AURORA-MC2: Market Cycle Confirmation

```text
Purpose: Determine whether the market supports fresh long trades.
```

Inputs:

```text
benchmark close/high/low/volume
ema10, ema20_21, sma50, sma200
index distribution/churn count
leadership breadth
trade feedback
reference basket behavior
```

Cycle states:

```text
MARKET_CYCLE_ON
MARKET_CYCLE_OFF
MARKET_TRANSITION
MARKET_RECONFIRMATION
MARKET_UNDER_PRESSURE
```

Permission states:

```text
TRADE_ALLOWED
SELECTIVE_ONLY
WATCHLIST_ONLY
DEFENSE_MODE
TRANSITION_MODE
```

Core rules:

```text
1-2 closes above rising 20/21 EMA + leaders confirming = cycle improving/on.
1-2 closes below 20/21 EMA + leaders failing = cycle under pressure/off.
50 SMA rising keeps structural bias constructive unless distribution/churn confirms damage.
```

## B.2 AURORA-LB: Leadership Breadth

Count quality breakouts over the same day/week.

```text
0       = LEADERSHIP_ABSENT
1-2     = LEADERSHIP_ISOLATED
3-5     = LEADERSHIP_EMERGING
6-10    = LEADERSHIP_BREADTH_CONFIRMING
10-15+  = LEADERSHIP_CLUSTER_CONFIRMED
```

Only count leaders if:

```text
liquidity pass
RS improving or near/new high
price above key MAs
valid setup/base/tight range
volume confirms or is constructive
sector/theme not deteriorating
no AURORA-X hard risk
```

## B.3 AURORA-MTF: Multi-Timeframe Gate

```text
Weekly = context.
Daily = setup timing.
Intraday = future scope.
```

Weekly labels:

```text
WEEKLY_CONTEXT_STRONG
WEEKLY_CONTEXT_OK
WEEKLY_CONTEXT_FAIL
WEEKLY_CONTEXT_REPAIR
```

MTF scoring:

```text
weekly context intact = +1
daily setup valid = +1
trigger/retest visible = +1
MTF Score: 0-3
```

## B.4 Pullback v2

Pullback valid only when:

```text
stock in uptrend
weekly context intact
daily pullback controlled
volume declines during pullback
support is confluence zone
reversal confirmation appears
```

Support sources:

```text
10 EMA
20/21 EMA
50 SMA
10-week MA
prior pivot/resistance now support
HVC
AVWAP
gap low / midpoint / origin
round-number level
RMV pivot support flip
```

Labels:

```text
PULLBACK_CONFLUENCE_STRONG = 3+ support sources
PULLBACK_CONFLUENCE_MODERATE = 2 support sources
PULLBACK_CONFLUENCE_WEAK = 0-1 support source
PULLBACK_VOLUME_DRYING
PULLBACK_HEAVY_SELLING_WARNING
PULLBACK_ORDERLY
PULLBACK_WIDE_AND_LOOSE
PULLBACK_SUPPORT_RECLAIM
```

## B.5 Moving Average Character

```text
20 EMA and 21 EMA are equivalent. Display as 20/21 EMA and never double-count.
Daily 20/21 EMA ≈ weekly 10-week MA.
Daily 50 SMA ≈ intermediate trend.
Daily 200 SMA ≈ weekly 40-week stage anchor.
```

Labels:

```text
21EMA_BREAK_WARNING
21EMA_RECLAIM_VALID
21EMA_RESPECT_CONFIRMED
50SMA_SERIOUS_WARNING
50SMA_RECLAIM
10WEEK_FIRST_CLOSE_BELOW
10WEEK_SECOND_CLOSE_BELOW
10WEEK_WIDE_CLOSE_BELOW
40WEEK_SUPPORT_TEST
40WEEK_BREAK_WARNING
DECLINING_MA_RECLAIM_INVALID
MA_CHARACTER_CHANGE
```

## B.6 Relative Strength

```python
rs_line = stock_close / benchmark_close
rs_ema21 = ema(rs_line, span=21)
rs_slope_5d = (rs_line[-1] / rs_line[-6] - 1) * 100
```

RS Trifecta:

```text
c1 = rs_line[-1] > rs_ema21[-1]
c2 = rs_line[-1] > max(rs_line[-63:-1])
c3 = rs_slope_5d > 0
PASS = 3/3
PARTIAL = 2/3
FAIL = 0-1/3
```

Mansfield proxy:

```python
mansfield_rs = (rs_line_weekly / rolling_mean(rs_line_weekly, 52) - 1) * 100
```

Labels:

```text
ELITE_RS = RS Trifecta PASS + Mansfield > 0 + RS 52W high
STRONG_RS = RS Trifecta PASS
ACCEPTABLE_RS = RS Trifecta PARTIAL
WEAK_RS = RS Trifecta FAIL
RSNH_BEFORE_PRICE = RS line new high while price not yet at price high
```

## B.7 Weinstein Stage

Weekly 30-week SMA preferred.

```text
STAGE_2: price > sma30w AND slope positive
STAGE_1_TO_2: fresh cross above flattening/turning-up sma30w
STAGE_1: price oscillating around flat sma30w
STAGE_3: topping / flattening after uptrend
STAGE_4: price below falling sma30w
```

Lifecycle:

```text
STAGE_2A = early Stage 2, 1st base, highest aggression
STAGE_2B = mid Stage 2, 2nd base, normal aggression
STAGE_2C = mature Stage 2, 3rd+ base, reduce aggression
```

## B.8 Setup/Base Geometry

Base types:

```text
VCP_BASE
FLAT_BASE
CUP_HANDLE
DOUBLE_BOTTOM
HTF
IPO_BASE
BOTTOMING_BASE
CONTINUATION_BASE
BASE_ON_BASE
```

Base validity:

```text
Flat base depth <= 15%
Cup depth 12-30%
Handle depth <= 12% of cup depth
VCP = tightening contractions
HTF = 10-25% flag after 100%+ pole
Base count 1-2 preferred; base count 4+ late-stage warning
```

v2.17 implementation corrections:

```text
SEPA 52-week-low bug fix:
  correct: close >= low_52w * 1.25
  incorrect: close > close * 1.25

AVWAP canonical formula uses typical price:
  typical_price = (high + low + close) / 3
  avwap = cumsum(typical_price * volume) / cumsum(volume)

Close-only AVWAP may be marked AVWAP_CLOSE_PROXY, not canonical.
```

## B.9 AVWAP / HVC

```python
typical_price = (high + low + close) / 3
avwap = cumulative_sum(typical_price * volume, from_anchor) / cumulative_sum(volume, from_anchor)
```

Anchor events:

```text
AVWAP_EARNINGS
AVWAP_IPO
AVWAP_52W_LOW
AVWAP_BASE_START
AVWAP_GAP
AVWAP_YTD
```

HVC:

```text
HVC = close price of high-volume day.
HVC remains EOD-compatible.
```

Labels:

```text
AVWAP_CONFLUENCE
AVWAP_PINCH
AVWAP_RECLAIM_CLEAN
AVWAP_RECLAIM_VOLUME
AVWAP_LOSS
VE_HVC_SUPPORT
HVC_RECLAIM
```

## B.10 Volume Edge

```python
rvol_20d = volume[-1] / average(volume[-20:])
close_pos = (close[-1] - low[-1]) / max(high[-1] - low[-1], small_number)
ud_ratio_20d = up_day_volume_20d / max(down_day_volume_20d, small_number)
```

Labels:

```text
VE_ACCUMULATION = rvol_20d > 1.5 AND close_pos > 0.5 AND up day
VE_BREAKOUT_CONFIRM = rvol_20d > 1.5 AND breakout context AND close_pos >= 0.6
VE_DRY_UP_SETUP = average(volume[-5:]) / average(volume[-20:]) < 0.5
VE_HVC_SUPPORT
VE_GAP_HVE
VE_EFFORT_RESULT_POS
VE_EFFORT_RESULT_NEG
VE_DISTRIBUTION_WARNING = rvol_20d > 1.5 AND close_pos < 0.4 AND down day
VE_CLIMAX_RISK
VE_LOW_QUALITY_VOLUME
```

High volume is not automatically bullish. Always interpret with close quality, price result, stage, and extension.

## B.11 SEPA Conviction Overlay

Checks:

```text
Stage 2 uptrend
close > sma150 and close > sma200
sma150 > sma200
sma200 rising over at least 1 month
close >= low_52w * 1.25
close >= high_52w * 0.75
RS strong or elite
EPS / revenue improving where available
```

Labels:

```text
SEPA_HIGH_CONVICTION = 6-8 checks
SEPA_MEDIUM_CONVICTION = 4-5 checks
SEPA_LOW_CONVICTION = <4 checks
SEPA_NOT_APPLICABLE = Stage 1/3/4 or insufficient context
```

## B.12 PEAD / EP / Gap

```python
gap_pct = open_event / prev_close_event - 1
pead_return_N = close_N / close_event - 1
pead_hold = close_current >= gap_low and close_current >= hvc_level and close_current >= avwap_earnings
```

Labels:

```text
GAP_ACCEPTED
GAP_FAILED
PEAD_TIER_1_WATCH
PEAD_TIER_2_WATCH
PEAD_TIER_3_WATCH
PEAD_WEAK_WATCH
TRUE_EP
STOCK_IN_PLAY
NOT_ACTIONABLE_GAP
```

## B.13 RRG / RLT

RRG proxy:

```python
rs_ratio = (asset_return_52w / benchmark_return_52w) * 100
rs_momentum = change(rs_ratio, 26w) * 100
```

Quadrants:

```text
LEADING = ratio > 100 and momentum > 100
WEAKENING = ratio > 100 and momentum <= 100
IMPROVING = ratio <= 100 and momentum > 100
LAGGING = ratio <= 100 and momentum <= 100
```

Labels:

```text
ROTATION_SWEET_SPOT = IMPROVING → LEADING
EARLY_ROTATION = LAGGING → IMPROVING
LEADERSHIP_FATIGUE = LEADING + weakening tail
RRG_PROXY_MODE
RRG_MISSING_INPUT
RRG_STALE_INPUT
```

RLT tracks days from sector rotation to stock RS cross, RSNH, early entry, and breakout.

## B.14 Market Breadth Concentration

```python
stock_contribution = market_cap_weight * stock_return_N
top10_contribution_pct = sum(top10_contributions) / index_return_N * 100
breadth_ratio = positive_contributor_count / total_constituents * 100
hhi = sum(contribution_share_i ** 2)
effective_contributor_count = 1 / hhi
```

Warnings:

```text
NARROW_RALLY_WARNING = top10_contribution_pct > 70%
WEAK_PARTICIPATION_WARNING = breadth_ratio < 40%
CONCENTRATION_WARNING = hhi >= 0.10
SEVERE_FRAGILE_RALLY = top10_contribution_pct > 85% OR breadth_ratio < 30%
```

## B.15 Fundamentals / Quality

Fundamentals are score modifiers and notes unless a setup explicitly requires them.

```text
Q_STRONG = EPS growth >= 25% AND revenue growth >= 15%
Q_ADEQUATE = one metric passes
Q_THIN = below thresholds
Q_FAIL = EPS declining 2+ quarters
Q_PROXY = unavailable
Q_IPO_LANE = IPO first base; standard Q not applied
```

Financial-sector caveat:

```text
Altman, Beneish, Piotroski, Magic Formula may be NOT_APPLICABLE/PARTIAL for banks, insurers, NBFCs, and similar financials.
Do not block solely because a model is not applicable.
```

## B.16 Extension / PX Risk

```python
dist_21ema = (close - ema20_21) / ema20_21 * 100
dist_50sma = (close - sma50) / sma50 * 100
dist_10w = (close - ma10w) / ma10w * 100
```

Labels:

```text
NORMAL = dist_21ema < 5%
MILD_EXTENSION = 5-10%
EXTENDED_FROM_21EMA = 10-15%
PX_NO_CHASE = 15-20%
PX_EXHAUSTION_WATCH = 20-25%
PX_HARD_WARNING = >25% OR weak close after vertical move
```

## B.17 AURORA-X Sell Risk

```text
X0_CLEAR
X1_EARLY_WARNING
X2_SELL_RISK_REVIEW
X3_HARD_BLOCK
X4_STRUCTURAL_DAMAGE
```

X3/X4 hard-block fresh long entries.

---

# PART C — v2.18 / v2.18.2 AURORA Workflow Precision Layer

## C.1 No Proprietary AI/Vendor References

Do not name proprietary AI or platform-specific workflow tools in the scanner spec.

Provider-neutral replacement:

```text
OPTIONAL_CONTEXT_ENRICHMENT
```

Allowed fields:

```text
enrichment_status = CALCULATED / PARTIAL / UNKNOWN / NOT_APPLICABLE
bar_catalyst_source = FILINGS / NEWS / EARNINGS / EXCHANGE_DISCLOSURE / MANUAL_NOTE / UNKNOWN
bar_catalyst_confidence = HIGH / MEDIUM / LOW / UNKNOWN
bar_catalyst_note = short text note, never a trade trigger by itself
```

Rule:

```text
Enrichment can add context to notes.
It cannot create TRADE_READY, TRIGGER_READY, or override missing price/volume/setup evidence.
```

---

## C.2 Liquidity Gate — Institutional Floor

Inputs:

```text
close
volume
fx_rate_to_usd if needed
avg_volume_20
avg_dollar_volume_20_local
avg_dollar_volume_20_usd_equiv
spread_pct where available
```

Formula:

```python
avg_dollar_volume_20_local = mean(close[-20:] * volume[-20:])
avg_dollar_volume_20_usd_equiv = avg_dollar_volume_20_local * fx_rate_to_usd
```

Labels:

```text
LIQUIDITY_FAIL = avg_dollar_volume_20_usd_equiv < 20_000_000, unless market-specific adapter lower threshold is explicitly configured
LIQUIDITY_PASS = >= 20M USD equivalent
LIQUIDITY_IDEAL = >= 50M USD equivalent
LIQUIDITY_INSTITUTIONAL = >= 100M USD equivalent
LIQUIDITY_PARTIAL = missing FX or incomplete volume; do not silently block unless requested scan requires strict liquidity
```

Rule:

```text
Liquidity fail blocks fresh long candidates from trade-ready buckets.
Show in live scanner as AVOID_FRESH_LONG + override_reason = LIQUIDITY_FAIL.
```

---

## C.3 RMV / RANGE_RMV_PROXY Engine

Exact proprietary RMV may be unavailable. AURORA uses exact RMV only if supplied by an approved data feed. Otherwise use a transparent range-compression proxy.

```python
def range_rmv_proxy(high, low, close, n):
    return (max(high[-n:]) - min(low[-n:])) / mean(close[-n:]) * 100

rmv5_proxy  = range_rmv_proxy(high, low, close, 5)
rmv10_proxy = range_rmv_proxy(high, low, close, 10)
rmv15_proxy = range_rmv_proxy(high, low, close, 15)
rmv25_proxy = range_rmv_proxy(high, low, close, 25)
rmv50_proxy = range_rmv_proxy(high, low, close, 50)
```

Use fields:

```text
rmv_source = EXACT_RMV | RANGE_RMV_PROXY | UNKNOWN
rmv_active_lookback = 5 | 10 | 15 | 25 | 50 | UNKNOWN
rmv_value
rmv_reason
rmv_tight_label
```

Tightness labels:

```text
RMV_ZERO = rmv_value <= 5
RMV_VERY_TIGHT = 5 < rmv_value <= 10
RMV_TIGHT = 10 < rmv_value <= 15
RMV_NORMAL = 15 < rmv_value <= 25
RMV_EXPANDING = rmv_value > 25
RMV_UNKNOWN = missing exact and proxy data
```

---

## C.4 Adaptive RMV5 After Gaps / IPOs

Inputs:

```text
event_type = NONE / EARNINGS_GAP / NEWS_GAP / EP / PEAD / IPO / HVE / HV1
event_gap_age_days
ipo_age_days
gap_pct
gap_range_pctile
hve_hv1_inside_last_15_bars
base_duration_days
position_trade_mode
```

Lookback selection:

```python
if event_gap_age_days is not None and event_gap_age_days <= 15:
    rmv_active_lookback = 5
    rmv_reason = "RECENT_GAP"
elif ipo_age_days is not None and ipo_age_days < 20:
    rmv_active_lookback = 5
    rmv_reason = "IPO_INSUFFICIENT_BARS"
elif gap_range_pctile is not None and gap_range_pctile >= 95:
    rmv_active_lookback = 5
    rmv_reason = "EXTREME_EVENT_RANGE"
elif hve_hv1_inside_last_15_bars:
    rmv_active_lookback = 5
    rmv_reason = "HVE_HV1_INSIDE_RMV15"
elif position_trade_mode or base_duration_days >= 50:
    rmv_active_lookback = 25 if base_duration_days < 100 else 50
    rmv_reason = "POSITION_BASE"
else:
    rmv_active_lookback = 15
    rmv_reason = "NORMAL_SWING"
```

Rule:

```text
RMV15 remains normal swing default.
RMV5 is required for post-gap / IPO / event-coil detection.
RMV25/50 are context smoothing for longer position bases.
```

---

## C.5 RMV Pivot High/Low Extraction

Purpose:

```text
Low RMV only says contraction exists.
AURORA must extract the range high, range low, pivot, stop, and direction.
```

Inputs:

```text
high, low, close, volume
atr14_pct
rmv_value
rmv_active_lookback
ema10, ema20_21, sma50
market_permission
close_pos
rvol_20d
```

Pivot math:

```python
pivot_window_min = 3
pivot_window_max = 7
pivot_tolerance_pct = max(1.0, 0.25 * atr14_pct)

# Candidate highs from last 3-7 bars.
recent_highs = high[-pivot_window_max:]
recent_lows = low[-pivot_window_max:]

# Aligned highs are highs within tolerance of the highest cluster level.
cluster_anchor = median(top_values(recent_highs, k=min(4, len(recent_highs))))
aligned_highs = [h for h in recent_highs if abs(h - cluster_anchor) / cluster_anchor * 100 <= pivot_tolerance_pct]

rmv_range_high = max(aligned_highs) if len(aligned_highs) >= 2 else max(recent_highs[-pivot_window_min:])
rmv_range_low = min(recent_lows[-len(aligned_highs):]) if len(aligned_highs) >= 2 else min(recent_lows[-pivot_window_min:])
rmv_pivot_price = rmv_range_high
rmv_stop_anchor = min(rmv_range_low, ema10, ema20_21) if values_available else rmv_range_low
```

Pivot quality:

```text
RMV_PIVOT_QUALITY_A = 3+ aligned highs within pivot_tolerance_pct and range orderly
RMV_PIVOT_QUALITY_B = 2 aligned highs within pivot_tolerance_pct
RMV_PIVOT_QUALITY_C = visible but loose pivot
RMV_PIVOT_QUALITY_NONE = no usable pivot
```

Directional labels:

```text
RMV_PIVOT_FORMING
RMV_PIVOT_TRIGGER_READY
RMV_PIVOT_BREAKOUT_CONFIRMED
RMV_PIVOT_DOWNSIDE_RESOLUTION
RMV_PIVOT_FAKEOUT_REPAIR
```

Trigger rules:

```text
Bullish EOD trigger:
  close > rmv_pivot_price
  AND close_pos >= 0.60
  AND volume constructive: rvol_20d >= 1.2 OR pocket_pivot_pass OR close_quality strong
  AND market_permission not in DEFENSE_MODE
  AND no PX_HARD_WARNING

Bearish / avoid-fresh-long trigger:
  close < rmv_range_low
  OR range breaks below declining 50 SMA
  OR high-volume weak close below pivot after breakout
```

Important:

```text
RMV contraction is not bullish by itself.
Direction is determined by price resolution through range high or range low.
```

---

## C.6 RMV Pivot Quality Score

This score feeds PatternScore/EntryScore. It is not a new AURORA-SIG component.

```text
RMV_Pivot_Quality_Score = 0-12
```

| Factor | Points |
|---|---:|
| Prior power / special event | 0-2 |
| Constructive base / right-side action / post-gap acceptance | 0-2 |
| RMV tightness | 0-2 |
| Pivot clarity | 0-2 |
| MA / HVC / AVWAP / gap confluence | 0-2 |
| RS + theme confirmation | 0-2 |

Scoring:

```text
RMV tightness:
  <=5 = 2.0
  >5 to 10 = 1.5
  >10 to 15 = 1.0
  >15 = 0

Pivot clarity:
  A = 2
  B = 1
  C/NONE = 0
```

Interpretation:

```text
10-12 = RMV_PIVOT_TRIGGER_READY
7-9   = RMV_PIVOT_DEFINED / EARLY_ENTRY_WATCH
4-6   = RMV_TIGHT_WATCH
<4    = compression only / ignore unless watchlist context
```

---

## C.7 RMV Pivot Retest / Support Flip

Inputs:

```text
prior_rmv_pivot_triggered_date
bars_since_rmv_trigger
rmv_pivot_price
low, close, volume
ema10, ema20_21, sma50
hvc_level, avwap_level
rvol_20d
close_pos
```

Formula:

```python
retest_window_valid = 1 <= bars_since_rmv_trigger <= 10
pivot_zone_low = rmv_pivot_price * (1 - pivot_tolerance_pct / 100)
pivot_zone_high = rmv_pivot_price * (1 + pivot_tolerance_pct / 100)
retested_pivot = low[-1] <= pivot_zone_high and close[-1] >= pivot_zone_low
held_pivot = close[-1] >= rmv_pivot_price
volume_controlled = rvol_20d <= 1.2 or close_pos >= 0.60
ma_confluence = any(abs(close[-1] - x) / close[-1] <= 0.03 for x in [ema10, ema20_21, sma50] if x is not None)
```

Labels:

```text
RMV_PIVOT_FLIPPED_SUPPORT = prior trigger + retest holds pivot
RMV_RETEST_ENTRY_WATCH = retest holds + MA/HVC/AVWAP confluence + risk <= acceptable
RMV_PIVOT_RETEST_HOLD = retest holds and closes above pivot
RMV_RETEST_FAILED = close < rmv_pivot_price or close < rmv_range_low with poor volume/close quality
```

Confluence effect:

```text
If RMV pivot + 10 EMA or 20/21 EMA + HVC/AVWAP overlap, feed PULLBACK_CONFLUENCE_STRONG.
```

---

## C.8 Show of Power

Inputs:

```text
recent_swing_high
prior_base_low
lookback_power_days = 60 default
base_low_lookback_days = 120 default
```

Formula:

```python
show_of_power_pct = (recent_swing_high / prior_base_low - 1) * 100
```

Labels:

```text
SHOW_OF_POWER_STRONG = show_of_power_pct >= 40
SHOW_OF_POWER_VALID = 30 <= show_of_power_pct < 40
SHOW_OF_POWER_THIN = 15 <= show_of_power_pct < 30
NO_SHOW_OF_POWER = show_of_power_pct < 15
SHOW_OF_POWER_UNKNOWN = insufficient swing/base data
```

Rule:

```text
Show of Power is a priority/ranking upgrade, not a universal hard gate.
RMV entries without SHOW_OF_POWER_VALID can remain watchable, but cannot be Daily Top1-4 unless RS Trifecta + theme strength + post-event acceptance compensate.
```

---

## C.9 Priming Pattern Labels

Purpose:

```text
Explicitly detect the final tightening cues before a pivot move.
```

Inputs:

```text
open, high, low, close, volume
prior_high, prior_low, prior_close
rmv_pivot_price
ema10, ema20_21
atr14_pct
```

Labels and formulas:

```text
PRIMING_INSIDE_DAY:
  high[-1] < high[-2] AND low[-1] > low[-2]

PRIMING_UPSIDE_REVERSAL:
  low[-1] < low[-2]
  AND close[-1] > close[-2]
  AND close_pos >= 0.60

PRIMING_SLIGHT_GAP_UNDER_PIVOT:
  open[-1] > close[-2]
  AND open[-1] < rmv_pivot_price
  AND (rmv_pivot_price - open[-1]) / rmv_pivot_price * 100 <= 2

PRIMING_DCC_TIGHT_CLOSE_COMPRESSION:
  dcc_5 = (max(close[-5:]) - min(close[-5:])) / mean(close[-5:]) * 100
  dcc_5 <= max(2.0, 0.5 * atr14_pct)

PRIMING_PATTERN_READY:
  at least 2 priming labels present
  AND close within 0-3% below pivot
  AND no distribution warning
```

DCR/DCC naming lock:

```text
DCR = Daily Close Range / close-location percentage.
DCC = Daily Close Compression over N days.
Tight daily closing-range compression maps to DCC, not DCR.
```

---

## C.10 Pullback Sequence After Power

Inputs:

```text
show_of_power_label
pullback_count_since_power
ema10_touch
ema20_21_touch
support_reclaim
volume_dryup
```

Labels:

```text
FIRST_PULLBACK_AFTER_POWER = pullback_count_since_power == 1 AND show_of_power_label in VALID/STRONG
SECOND_PULLBACK_AFTER_POWER = pullback_count_since_power == 2 AND show_of_power_label in VALID/STRONG
LATE_PULLBACK_LOWER_PRIORITY = pullback_count_since_power >= 3
PULLBACK_AFTER_POWER_UNKNOWN = insufficient swing count data
```

Priority rule:

```text
First and second pullbacks to 10 EMA or 20/21 EMA after Show of Power rank above later repeated MA tests.
```

---

## C.11 Broad Routine — Weekly/Daily/RMV Funnel Seed

Purpose:

```text
Create the wide candidate pool mechanically before narrowing to focus list.
```

Inputs:

```text
curated_leader_universe
weekly_pct_change
daily_pct_change
monthly_pct_change
rmv15 or rmv15_proxy
liquidity_label
rs_rating_12m or rs_score_pct
theme_primary
near_key_ma
```

Formulas:

```python
weekly_pct_change = (close / close_5d_ago - 1) * 100
daily_pct_change = (close / close_1d_ago - 1) * 100
monthly_pct_change = (close / close_20d_ago - 1) * 100
near_key_ma = (
    abs(close - ema10) / close <= 0.03
    or abs(close - ema20_21) / close <= 0.03
    or abs(close - sma50) / close <= 0.03
)
```

Eligibility:

```text
BROAD_ROUTINE_ELIGIBLE:
  liquidity_label != LIQUIDITY_FAIL
  AND rmv15 or proxy available
  AND rs_rating_12m >= 80 OR RS_TRIFECTA != FAIL OR theme_tracker_label in {SLEEPER_THEME_EMERGING, THEME_CONFIRMED}
```

Labels:

```text
BROAD_WEEKLY_POWER = weekly_pct_change top 20% of eligible universe OR weekly_pct_change >= 5%
BROAD_DAILY_POWER = daily_pct_change >= 5%
BROAD_DAILY_REVIEW = 0 <= daily_pct_change < 5 AND weekly_pct_change top 20%
BROAD_RMV_PRIORITY = rmv15 <= 15 AND near_key_ma
BROAD_ROUTINE_SKIP = liquidity fail / damaged stage / no leadership evidence
```

Score:

```python
weekly_power_score = percentile_rank(weekly_pct_change) * 100
daily_power_score = min(100, max(0, daily_pct_change / 5 * 100))
rmv_sort_score = 100 - percentile_rank(rmv15) * 100
rs_score = rs_rating_12m if available else rs_score_pct
ma_location_score = 100 if near_key_ma else 50 if close > ema20_21 else 0

broad_routine_score = (
    0.25 * weekly_power_score
  + 0.15 * daily_power_score
  + 0.30 * rmv_sort_score
  + 0.20 * rs_score
  + 0.10 * ma_location_score
)
```

Output:

```text
weekly_pct_change
daily_pct_change
monthly_pct_change
near_key_ma
broad_routine_label
broad_routine_score
broad_routine_rank
```

---

## C.12 Theme Tracker — Top 5/6 and 3-of-4 Rule

Inputs:

```text
theme_daily_rank_last4_days
theme_rank_1w
theme_rank_1m
theme_rank_3m
theme_return_today
theme_return_1w
theme_return_1m
theme_rank_cutoff = 5 default; 6 allowed
subindustry_rank_current
subindustry_rank_prior
```

Formulas:

```python
theme_topN_hits_last4_days = sum(rank <= theme_rank_cutoff for rank in theme_daily_rank_last4_days if rank is not None)
theme_rank_change_delta = theme_rank_prior - theme_rank_current  # positive = improving
subindustry_rank_change_delta = subindustry_rank_prior - subindustry_rank_current
```

Labels:

```text
SLEEPER_THEME_EMERGING:
  theme_topN_hits_last4_days >= 3
  AND theme_rank_1m > theme_rank_cutoff

THEME_CONFIRMED:
  theme_rank_1m <= theme_rank_cutoff
  AND theme_topN_hits_last4_days >= 2

THEME_FADING:
  theme_rank_1m <= theme_rank_cutoff
  AND theme_topN_hits_last4_days == 0

RANK_CHANGE_LEADER:
  theme_rank_change_delta or subindustry_rank_change_delta in top decile of universe

THEME_NEUTRAL:
  no confirmed/fading/emerging condition

THEME_UNKNOWN:
  missing theme data
```

Rule:

```text
Theme Tracker improves ranking and watchlist priority.
It cannot create a tradeable candidate without price setup, trigger, stop, risk, and market permission.
```

---

## C.13 Theme Leaders Representatives

Purpose:

```text
Maintain top 1-4 liquid high-ADR representatives from each leading theme.
These are theme watchlist representatives, not automatically immediate entries.
```

Inputs:

```text
theme_primary
adr_pct_20d
avg_dollar_volume_20_usd_equiv
rs_score_pct
technical_strength_score
setup_proximity_score
liquidity_label
theme_tracker_label
```

Formula:

```python
adr_score = percentile_rank(adr_pct_20d) * 100
liquidity_score = min(100, log_scale(avg_dollar_volume_20_usd_equiv, floor=20_000_000, cap=100_000_000))
rs_score = rs_score_pct
technical_score = technical_strength_score / 85 * 100
setup_score = setup_proximity_score

theme_rep_score = (
    0.20 * adr_score
  + 0.20 * liquidity_score
  + 0.25 * rs_score
  + 0.20 * technical_score
  + 0.15 * setup_score
)
```

Labels:

```text
THEME_REP_1
THEME_REP_2
THEME_REP_3
THEME_REP_4
THEME_REP_EXCLUDED_LIQUIDITY
THEME_REP_UNKNOWN
```

Selection:

```text
For each top theme, select max 4 names with liquidity pass.
If fewer than 4 qualify, do not pad.
If theme has no liquid reps, mark THEME_REP_UNKNOWN.
```

---

## C.14 Daily Execution Funnel — Wide List → Focus List → Daily Top 1-4

AURORA workflow precision is now a real ranking engine.

### Stage 1 — Wide List

```text
Target: 30-45 names.
Meaning: remotely actionable within next 48 hours.
Source: broad routine, RMV/compression, pullback, RSNH, theme leader reps, PEAD/EP.
```

### Stage 2 — Focus List

```text
Target: 10-16 names.
Requirements:
  liquidity pass
  leading or improving theme / sector
  RS acceptable or better
  valid setup state
  clear trigger
  clear stop
  market permission not DEFENSE_MODE
```

### Stage 3 — Daily Top 1-4

```text
Maximum: 4.
Ideal: 1 if one candidate is clearly superior.
Do not force exactly four.
```

Score:

```python
trigger_proximity_score = max(0, 100 - abs(close - trigger_price) / trigger_price * 100 / 3 * 100)  # 0-3% from trigger
rs_component = rs_score_pct
setup_tightness_score = max(rmv_tightness_score_pct, compression_score_pct)
theme_component = theme_score_pct
risk_clarity_score = 100 if 2 <= risk_pct <= 4 else 70 if risk_pct < 2 else 40 if risk_pct <= 7 else 0
market_permission_score = {
    "TRADE_ALLOWED": 100,
    "SELECTIVE_ONLY": 75,
    "TRANSITION_MODE": 50,
    "WATCHLIST_ONLY": 25,
    "DEFENSE_MODE": 0,
}.get(market_permission, 25)

execution_focus_score = (
    0.25 * trigger_proximity_score
  + 0.20 * rs_component
  + 0.20 * setup_tightness_score
  + 0.15 * theme_component
  + 0.10 * risk_clarity_score
  + 0.10 * market_permission_score
)
```

Selection logic:

```python
eligible = [c for c in focus_list if c.execution_focus_score >= 70 and c.final_bucket not in ["AVOID_FRESH_LONG", "NO_CHASE"]]
ranked = sort_desc(eligible, key="execution_focus_score")

if not ranked:
    daily_list = []
elif ranked[0].execution_focus_score >= 75:
    daily_list = [ranked[0]]
    for c in ranked[1:4]:
        if c.execution_focus_score >= 70 and (ranked[0].execution_focus_score - c.execution_focus_score) <= 12:
            daily_list.append(c)
else:
    daily_list = []
```

Labels:

```text
execution_tier = WIDE_LIST / FOCUS_LIST / DAILY_TOP1 / DAILY_TOP2 / DAILY_TOP3 / DAILY_TOP4 / NOT_FOCUS
focus_rank
why_top1_to_4
next_trigger
invalidation
```


---

## C.14B AURORA-WWL — Weekly Watchlist Generation & Persistence

Purpose:

```text
Create AURORA's own weekly list of 15-20 stocks from the full selected market universe.
This is not an external-list comparison layer and not a benchmark-recall audit.
AURORA must discover, rank, persist, and daily re-rank its own candidates.
```

Scope:

```text
EOD only.
Runs through US / India / Canada market adapters.
Produces a weekly workflow object, not a final_bucket.
Does not issue buy/sell commands, live orders, or user-specific position sizing.
```

### C.14B.1 Inputs

Required candidate fields:

```text
ticker
market
week_id
asof_eod_date
source_scan_ids
source_reason
price
avg_dollar_volume_20_usd_equiv
liquidity_label
gics_sector
main_industry
sub_industry
theme_primary
market_state
market_permission
market_dimmer
reference_basket_state
weekly_context_label
stage_label
stage_lifecycle
base_count_label
final_bucket
override_reason
status_flag
aurora_sig_score
technical_strength_score
rs_score_pct
rs_trifecta_label
rsnh_status
mansfield_rs_label
setup_state
rmv_active_lookback
rmv_value
rmv_tight_label
rmv_pivot_quality
rmv_pivot_price
trigger_price
trigger_proximity_pct
initial_stop
risk_pct
risk_bucket
theme_tracker_label
theme_score_pct
theme_rank_1m
theme_topN_hits_last4_days
theme_rep_rank
show_of_power_label
pullback_sequence_label
squat_label
watchlist_action
px_label
aurora_x_label
```

Fallback rules:

```text
Missing theme/GICS: mark PARTIAL / UNKNOWN, do not block.
Missing RMV: allow non-RMV lanes but cap RMV score contribution to 40.
Missing trigger or stop: cannot be WEEKLY_FOCUS; may remain WEEKLY_UNIVERSE.
Missing market state: reduce market contribution; do not silently block.
Missing average dollar volume: LIQUIDITY_UNKNOWN; cannot become DAILY_TOP1-4.
```

### C.14B.2 Weekly Eligibility

Hard exclusions:

```text
weekly_list_eligible = False if any:
  final_bucket == AVOID_FRESH_LONG
  override_reason in {STAGE_4_DAMAGED, AURORA_X_HARD_BLOCK, LIQUIDITY_FAIL}
  liquidity_label == LIQUIDITY_FAIL
  stage_label == STAGE_4
  weekly_context_label == WEEKLY_CONTEXT_FAIL and setup_state not in {REPAIR_WATCH, RSNH_WATCH_ONLY}
```

Soft inclusion despite weak market:

```text
If market_permission in {WATCHLIST_ONLY, DEFENSE_MODE}:
  AURORA may still create WEEKLY_UNIVERSE / RSNH watch candidates,
  but cannot promote candidates to DAILY_TOP1-4 until market permission improves.
```

### C.14B.3 Component Scores

All components normalize to 0-100.

```python
technical_component = clamp(technical_strength_score / 85 * 100, 0, 100)
rs_component = rs_score_pct if rs_score_pct is not None else {
    "ELITE_RS": 95,
    "STRONG_RS": 85,
    "ACCEPTABLE_RS": 65,
    "WEAK_RS": 30,
}.get(rs_trifecta_label, 40)

setup_maturity_component = {
    "TRADE_READY": 100,
    "TRIGGER_READY": 92,
    "EARLY_ENTRY_WATCH": 84,
    "PULLBACK_WATCH": 78,
    "RSNH_WATCH_ONLY": 64,
    "REPAIR_WATCH": 48,
    "NO_CHASE": 35,
    "PROTECT_PROFIT_REVIEW": 20,
    "AVOID_FRESH_LONG": 0,
}.get(final_bucket, 40)

rmv_component = {
    "RMV_ZERO": 100,
    "RMV_VERY_TIGHT": 90,
    "RMV_TIGHT": 75,
    "RMV_NORMAL": 50,
    "RMV_EXPANDING": 20,
    "RMV_UNKNOWN": 40,
}.get(rmv_tight_label, 40)

pivot_component = {
    "RMV_PIVOT_QUALITY_A": 100,
    "RMV_PIVOT_QUALITY_B": 80,
    "RMV_PIVOT_QUALITY_C": 55,
    "RMV_PIVOT_QUALITY_NONE": 30,
}.get(rmv_pivot_quality, 40)

rmv_setup_component = max(rmv_component * 0.65 + pivot_component * 0.35, 0)

theme_component = theme_score_pct if theme_score_pct is not None else {
    "THEME_CONFIRMED": 90,
    "SLEEPER_THEME_EMERGING": 82,
    "RANK_CHANGE_LEADER": 78,
    "THEME_NEUTRAL": 55,
    "THEME_FADING": 20,
    "THEME_UNKNOWN": 45,
}.get(theme_tracker_label, 45)

risk_component = {
    "RISK_IDEAL": 100,
    "RISK_TIGHT": 80,
    "RISK_WIDE": 45,
    "RISK_TOO_WIDE": 0,
    "RISK_UNKNOWN": 35,
}.get(risk_bucket, 35)

liquidity_component = min(100, max(0,
    (log10(max(avg_dollar_volume_20_usd_equiv, 1)) - log10(20_000_000)) /
    (log10(100_000_000) - log10(20_000_000)) * 100
)) if avg_dollar_volume_20_usd_equiv else 35

power_component = {
    "SHOW_OF_POWER_STRONG": 100,
    "SHOW_OF_POWER_VALID": 85,
    "SHOW_OF_POWER_THIN": 55,
    "NO_SHOW_OF_POWER": 25,
    "SHOW_OF_POWER_UNKNOWN": 45,
}.get(show_of_power_label, 45)

market_component = clamp((market_dimmer or 0) / 5 * 100, 0, 100)

persistence_component = {
    "SQUAT_INTACT_SECOND_CHANCE": 80,
    "SQUAT_RETEST_WATCH": 85,
    "SQUAT_FAILED_AURORA_X2": 10,
    "WATCHLIST_KEEP": 65,
    "WATCHLIST_DOWNGRADE": 35,
    "WATCHLIST_REPAIR_ONLY": 30,
    "WATCHLIST_REMOVE_21EMA_BREAK_FOLLOWTHROUGH": 0,
    "WATCHLIST_REMOVE_THEME_LOSS": 0,
}.get(squat_label or watchlist_action, 50)
```

### C.14B.4 Weekly Watchlist Score

Formula:

```python
weekly_watchlist_score = (
    0.16 * technical_component
  + 0.14 * rs_component
  + 0.14 * setup_maturity_component
  + 0.12 * theme_component
  + 0.10 * rmv_setup_component
  + 0.10 * risk_component
  + 0.08 * liquidity_component
  + 0.06 * power_component
  + 0.06 * market_component
  + 0.04 * persistence_component
)
```

Interpretation:

```text
WWL_A_PLUS = weekly_watchlist_score >= 85
WWL_A      = 75 <= score < 85
WWL_B      = 65 <= score < 75
WWL_C      = 55 <= score < 65
WWL_REJECT = score < 55 or hard exclusion
```

### C.14B.5 Weekly List Selection

Selection target:

```text
AURORA_WEEKLY_WATCHLIST target = 15-20 names.
No forced padding.
If fewer than 15 names pass quality, output fewer and state candidate_supply_thin = TRUE.
```

Selection logic:

```python
eligible = [c for c in market_candidates if c.weekly_list_eligible and c.weekly_watchlist_score >= 55]
ranked = sort_desc(eligible, key=(weekly_watchlist_score, technical_strength_score, rs_component))

per_theme_cap_default = 4
per_theme_cap_strong = 5 if market_dimmer >= 4 and theme_tracker_label == "THEME_CONFIRMED" else 4

weekly_watchlist = []
theme_counts = defaultdict(int)
for c in ranked:
    cap = 5 if c.market_dimmer >= 4 and c.theme_tracker_label == "THEME_CONFIRMED" else 4
    if theme_counts[c.theme_primary] >= cap:
        continue
    weekly_watchlist.append(c)
    theme_counts[c.theme_primary] += 1
    if len(weekly_watchlist) >= 20:
        break
```

Quality lock:

```text
Do not insert low-quality names just to reach 15-20.
If market is poor, AURORA may output 8-14 names and mark WEEKLY_SUPPLY_THIN.
```

### C.14B.6 Weekly Tiers

Labels:

```text
weekly_tier =
  WEEKLY_CORE
  WEEKLY_FOCUS
  DAILY_TOP1
  DAILY_TOP2
  DAILY_TOP3
  DAILY_TOP4
  WEEKLY_PULLBACK_RETEST
  WEEKLY_SQUAT_INTACT
  WEEKLY_REPAIR_ONLY
  WEEKLY_REMOVE
  NOT_WEEKLY_LIST
```

Tier rules:

```text
WEEKLY_CORE:
  selected into 15-20 list

WEEKLY_FOCUS:
  weekly_watchlist_score >= 70
  AND trigger/stop are known
  AND risk_pct <= 7
  AND final_bucket in {TRIGGER_READY, EARLY_ENTRY_WATCH, PULLBACK_WATCH, RSNH_WATCH_ONLY}

DAILY_TOP1-4:
  inherits C.14 Daily Top 1-4 logic
  AND market_permission not in {WATCHLIST_ONLY, DEFENSE_MODE}

WEEKLY_PULLBACK_RETEST:
  final_bucket == PULLBACK_WATCH
  OR rmv retest/support-flip is active
  OR pullback_sequence_label in {FIRST_PULLBACK_AFTER_POWER, SECOND_PULLBACK_AFTER_POWER}

WEEKLY_SQUAT_INTACT:
  squat_label in {SQUAT_INTACT_SECOND_CHANCE, SQUAT_RETEST_WATCH}

WEEKLY_REPAIR_ONLY:
  watchlist_action == WATCHLIST_REPAIR_ONLY
  OR final_bucket == REPAIR_WATCH

WEEKLY_REMOVE:
  watchlist_action starts with WATCHLIST_REMOVE
  OR override_reason in hard exclusions
```

### C.14B.7 Persistence Rules

Weekly object:

```text
week_id = ISO year-week of the weekend scan.
weekly_list_created_asof = latest completed EOD bar.
weekly_list_source = AURORA_WEEKLY_DISCOVERY.
```

Carry-forward:

```text
A candidate can carry forward up to 3 weeks if:
  weekly_context_label remains OK/STRONG
  theme is not fading
  20/21 EMA or key support is intact
  no AURORA-X hard warning
  liquidity remains pass/partial
```

Staleness:

```text
STALE_SETUP_REVIEW:
  no trigger/retest after 10 completed sessions
  AND setup_state no longer tight/near pivot/pullback

STALE_REMOVE:
  no trigger/retest after 15 completed sessions
  OR repeated failed attempts with distribution
```

Daily review:

```text
Daily EOD review updates daily_status, trigger proximity, risk, and removal flags.
Daily EOD review does not replace the weekly source list unless a hard removal fires.
```

### C.14B.8 Weekly Output Contract

Required table columns:

```text
Rank
Ticker
Market
Theme
Weekly Tier
AURORA Bucket
WWL Score
SIG
Technical Strength
RS
Stage
Setup State
RMV / Pivot
Trigger
Stop
Risk %
Market State
Why on list
Invalidation / Remove reason
```

Header summary:

```text
AURORA Weekly Watchlist — MARKET — week_id
Market Dimmer: 0-5 + label
Candidate Supply: HEALTHY / THIN / DEFENSIVE_ONLY
List Count: N / target 15-20
Daily Top 1-4: shown only if available and market permission allows
```

### C.14B.9 Commands

```text
AURORA weekly list us
AURORA weekly watchlist US 20
AURORA WWL India
AURORA weekly focus Canada
AURORA daily top from weekly list US
```

Router rule:

```text
A weekly-list request runs AURORA-WWL.
Do not relabel it as generic AURORA Top 10.
Do not compare it to any external watchlist unless the user explicitly asks for an audit.
```
---

## C.15 Squat-Intact Second-Chance Watchlist

Inputs:

```text
breakout_date
bars_since_breakout
breakout_pivot
highest_close_since_breakout
close
ema20_21
hvc_level
avwap_level
rs_line
volume
rvol_20d
close_pos
```

Formula:

```python
breakout_age_valid = 1 <= bars_since_breakout <= 10
follow_through_pct = (highest_close_since_breakout / breakout_pivot - 1) * 100
support_held = close >= breakout_pivot or close >= ema20_21 or close >= hvc_level or close >= avwap_level
high_volume_bearish_close = rvol_20d >= 1.5 and close_pos < 0.40 and close < prior_close
rs_breakdown = rs_line < rs_ema21 and rs_slope_5d < 0
```

Labels:

```text
SQUAT_INTACT_SECOND_CHANCE:
  breakout_age_valid
  AND follow_through_pct <= 5
  AND support_held
  AND not high_volume_bearish_close
  AND not rs_breakdown

SQUAT_RETEST_WATCH:
  SQUAT_INTACT_SECOND_CHANCE
  AND close within pivot/support zone

SQUAT_FAILED_AURORA_X2:
  close below pivot and 20/21 EMA
  OR high_volume_bearish_close
  OR rs_breakdown
```

Watchlist action:

```text
watchlist_action = SQUAT_INTACT / REPAIR_ONLY / DOWNGRADE / REMOVE / KEEP / UNKNOWN
```

---

## C.16 Watchlist Removal / Downgrade

Inputs:

```text
close
ema20_21
prior_close
follow_through_day
rvol_20d
close_pos
theme_tracker_label
unfilled_gap_down
major_distribution
```

Labels:

```text
WATCHLIST_KEEP
WATCHLIST_DOWNGRADE
WATCHLIST_REMOVE_21EMA_BREAK_FOLLOWTHROUGH
WATCHLIST_REMOVE_THEME_LOSS
WATCHLIST_REPAIR_ONLY
```

Rules:

```text
WATCHLIST_REMOVE_21EMA_BREAK_FOLLOWTHROUGH:
  close < ema20_21
  AND next completed bar fails to reclaim / makes downside progress
  AND volume or close quality confirms distribution

WATCHLIST_REMOVE_THEME_LOSS:
  theme_tracker_label = THEME_FADING
  AND stock RS no longer confirms

WATCHLIST_REPAIR_ONLY:
  technical damage exists, but stock remains liquid and former leader
```

---

## C.17 Market Dimmer Switch 0-5

Purpose:

```text
Convert market state into incremental aggression, not binary on/off.
```

Inputs:

```text
index_close > ema10 / ema20_21 / sma50
ema20_21 rising
sma50 rising
leadership_breadth_state
trade_feedback_state
failed_breakout_count_10d
distribution_churn_count_10d
risk_on_proxy_state
reference_basket_state
market_cycle_age_days
```

Component scores:

```python
index_score = 0
if index_close > ema20_21 and ema20_21_rising: index_score += 1
if index_close > sma50 and sma50_rising: index_score += 1
if index_close > ema10 and ema10_rising: index_score += 0.5
index_score = min(index_score, 2.5)

breadth_score = {
    "LEADERSHIP_ABSENT": 0,
    "LEADERSHIP_ISOLATED": 0.25,
    "LEADERSHIP_EMERGING": 0.5,
    "LEADERSHIP_BREADTH_CONFIRMING": 0.85,
    "LEADERSHIP_CLUSTER_CONFIRMED": 1.0,
}.get(leadership_breadth_state, 0.25)

trade_feedback_score = {
    "TRADE_FEEDBACK_POSITIVE": 1.0,
    "TRADE_FEEDBACK_MIXED": 0.5,
    "TRADE_FEEDBACK_NEGATIVE": 0.0,
}.get(trade_feedback_state, 0.25)

risk_proxy_score = {
    "RISK_ON_CONFIRMING": 1.0,
    "RISK_ON_MIXED": 0.5,
    "RISK_OFF": 0.0,
    "UNKNOWN": 0.25,
}.get(risk_on_proxy_state, 0.25)

reference_basket_score = {
    "REFERENCE_BASKET_CONFIRMING": 1.0,
    "REFERENCE_BASKET_MIXED": 0.5,
    "REFERENCE_BASKET_SQUATTING": 0.25,
    "REFERENCE_BASKET_BREAKING_SUPPORT": 0.0,
}.get(reference_basket_state, 0.25)

penalty = 0
if failed_breakout_count_10d >= 5: penalty += 0.5
if distribution_churn_count_10d >= 3: penalty += 0.5
if market_cycle_age_days > 60 and distribution_churn_count_10d >= 2: penalty += 0.5

raw = index_score + breadth_score + trade_feedback_score + risk_proxy_score + reference_basket_score - penalty
market_dimmer = round(clamp(raw, 0, 5))
```

Dimmer labels:

```text
0 = DIMMER_0_DEFENSE_ONLY
1 = DIMMER_1_WATCHLIST_PROTECT_CAPITAL
2 = DIMMER_2_PILOT_ONLY
3 = DIMMER_3_SELECTIVE_NORMAL
4 = DIMMER_4_AGGRESSIVE_NO_CHASE
5 = DIMMER_5_FULL_AGGRESSION_LEADERS_CONFIRMING
```

Cycle age labels:

```text
NEW_CYCLE_ACCELERATION = market_cycle_age_days <= 15 AND leaders confirming
CYCLE_MID_NORMAL = 16 <= market_cycle_age_days <= 60
CYCLE_LONG_IN_TOOTH = market_cycle_age_days > 60
CHOPPY_CYCLE = repeated crosses around 20/21 EMA + churn
```

---

## C.18 Reference Basket / Mega-Cap Tell — All Three Markets

Name:

```text
AURORA-REFERENCE-BASKET-TELL
```

Reason:

```text
Large-cap / mega-cap leadership behavior is a market tell.
Use dynamic top market-cap basket by market whenever possible.
Use static fallback only if current market-cap data is unavailable.
```

Inputs:

```text
market_profile.reference_basket_policy
market_cap
close
ema10
ema20_21
sma50
stage_label
rs_line
close_pos
rvol_20d
basket_member_weight
```

Basket state per symbol:

```text
REF_CONFIRMING = close > ema20_21 and ema20_21 rising and rs_slope_5d >= 0
REF_MIXED = close near ema20_21 or support, no hard distribution
REF_SQUATTING = recent breakout/power move but no follow-through, support still held
REF_BREAKING_SUPPORT = close < ema20_21 with follow-through or close < sma50
```

Basket aggregate:

```python
confirming_pct = count(REF_CONFIRMING) / basket_count
breaking_pct = count(REF_BREAKING_SUPPORT) / basket_count
squatting_pct = count(REF_SQUATTING) / basket_count

if confirming_pct >= 0.60 and breaking_pct <= 0.20:
    reference_basket_state = "REFERENCE_BASKET_CONFIRMING"
elif breaking_pct >= 0.40:
    reference_basket_state = "REFERENCE_BASKET_BREAKING_SUPPORT"
elif squatting_pct >= 0.40:
    reference_basket_state = "REFERENCE_BASKET_SQUATTING"
else:
    reference_basket_state = "REFERENCE_BASKET_MIXED"
```

Labels:

```text
REFERENCE_BASKET_CONFIRMING
REFERENCE_BASKET_MIXED
REFERENCE_BASKET_SQUATTING
REFERENCE_BASKET_BREAKING_SUPPORT
REFERENCE_BASKET_UNKNOWN
```

Static fallback baskets are defined in market adapters and must be treated as fallback examples only. Production should refresh the basket dynamically from the current market universe.

---

## C.19 EOD-Safe Alert Fields

AURORA does not place orders. It can output EOD-safe alert fields.

```text
trigger_price
alert_price
buy_stop_candidate = YES / NO
execution_note = "EOD alert only; not an order instruction"
invalidation
initial_stop
risk_pct
risk_bucket
```

Risk buckets:

```text
RISK_IDEAL = 2 <= risk_pct <= 4
RISK_TIGHT = risk_pct < 2, confirm not noise-prone
RISK_WIDE = 4 < risk_pct <= 7
RISK_TOO_WIDE = risk_pct > 7
RISK_UNKNOWN = missing stop/trigger
```

---

# PART D — Scan Menu Additions

Existing menus A-Q remain active. Add MENU R as the AURORA workflow precision menu.

| Scan ID | Display Name | Runtime Purpose |
|---|---|---|
| R01_RMV5_EVENT_COIL | Adaptive RMV5 Event Coil | Post-gap / IPO / event tightness with RMV5 |
| R02_RMV_PIVOT_HIGH_LOW | RMV Pivot High/Low Extraction | Finds aligned range high/low and pivot |
| R03_RMV_PIVOT_RETEST_SUPPORT | RMV Pivot Retest Support | Finds support flip/retest after RMV breakout |
| R04_SHOW_OF_POWER | Show of Power Scan | Prior 30-40% power move / sponsorship evidence |
| R05_EXECUTION_FUNNEL | Execution Funnel | Wide List → Focus List → Daily Top 1-4 |
| R06_SQUAT_INTACT | Squat-Intact Watchlist | Breakout squats but support remains intact |
| R07_THEME_TRACKER_TOPN | Theme Tracker Top 5/6 | 3-of-4 emerging theme and confirmed/fading theme rules |
| R08_BROAD_ROUTINE | Broad Routine Pre-Sort | Weekly % → daily % → RMV15 low-to-high funnel seed |
| R09_PRIMING_PATTERN | Priming Pattern Scan | Inside day, upside reversal, slight gap under pivot, DCC compression |
| R10_THEME_LEADERS_REP | Theme Leaders Representatives | Top 1-4 liquid high-ADR reps per leading theme |
| R11_DAILY_TOP1_TO_4 | Daily Top 1-4 Focus | Max 4, ideally 1, no forced padding |
| R12_WATCHLIST_ABANDONMENT | Watchlist Removal/Downgrade | 21 EMA break + follow-through / theme loss |
| R13_MARKET_CYCLE_AGE_DIMMER | Market Cycle Age Dimmer | Fresh-cycle boost / long-in-tooth penalty |
| R14_REFERENCE_BASKET_TELL | Multi-Market Reference Basket Tell | US/India/Canada large-cap risk tell |
| R15_AURORA_WEEKLY_WATCHLIST | AURORA Weekly Watchlist | AURORA-owned 15-20 name weekly discovery/persistence list |

These are scan IDs and diagnostic workflow states only. They do not create final buckets.

---

# PART E — Output Contracts

## E.1 Single-Stock Output Fields

Minimum operational fields:

```text
ticker
market
gics_sector
main_industry
sub_industry
theme_primary
market_state
market_permission
market_dimmer
reference_basket_state
weinstein_stage
stage_lifecycle
rs_status
rs_line_state
rrg_state
theme_tracker_label
setup_state
source_lane
rmv_source
rmv_active_lookback
rmv_reason
rmv_value
rmv_tight_label
rmv_pivot_price
rmv_range_high
rmv_range_low
rmv_pivot_quality
show_of_power_pct
show_of_power_label
priming_pattern_labels
trigger_price
alert_price
initial_stop
risk_pct
risk_bucket
aurora_sig_score
technical_strength_score
final_bucket
status_flag
override_reason
watchlist_action
quality_notes
additional_setup_notes
```

## E.2 RMV Pivot Scan Output Columns

```text
Ticker
Market
GICS Sector / Main Industry / Sub-Industry
Theme
Market State
Market Dimmer
Setup State
Active RMV / Source
RMV Pivot
Distance to Pivot
MA of Note
RS Status
Theme Rank / Rank Change
Show of Power
Trigger
Stop
Risk %
2R / 3R
AURORA Bucket
Additional Notes
```

## E.3 Market State Output

When user asks for market state / market scan / sector leadership, show Market Summary Strength Stack first.

Always show count + denominator + percentage:

```text
Correct: 312 / 500 stocks = 62.4%
Wrong: 62.4%
```

End with:

```text
Final Market Permission: TRADE_ALLOWED / SELECTIVE_ONLY / WATCHLIST_ONLY / DEFENSE_MODE / TRANSITION_MODE
Market Dimmer: 0-5
Action Bias: Normal / selective / pilot-only / watchlist-only / defensive
Reason: one sentence using MA stack + breadth + RS leadership + sector/theme evidence + reference basket.
```

## E.4 Scan Router

```text
If user asks bare "scan" and market missing:
  ask market: India, US, or Canada.

If market known but scan type missing:
  ask scan type: market state, early entry, pullback, breakout, RSNH, sector/rotation, sell-risk, or Top 10.

If user asks a specific scan:
  output that scan's relevant table and fields.
  Do not relabel it as AURORA Top 10.

Top 10 appears only when requested as Top 10 / best candidates / full scan.
```

---

# PART F — Fallback / Missing Data Policy

```text
Missing OHLCV: INSUFFICIENT_HISTORY; cannot calculate technical lanes.
RMV missing: use RANGE_RMV_PROXY; if unavailable mark RMV_UNKNOWN.
Theme rank missing: THEME_UNKNOWN; do not block.
GICS missing: classification_status = PARTIAL / UNKNOWN; do not block.
Volume missing: trigger can be price-only PARTIAL, not full TRIGGER_READY.
Market state missing: market_state UNKNOWN and reduce MarketScore; do not silently block.
Reference basket missing: REFERENCE_BASKET_UNKNOWN; do not block individual setup.
External data scan missing required feed: PARTIAL / UNKNOWN, never silently CALCULATED.
```

---

# PART G — Test Harness Requirements

Before production threshold changes, test across US / India / Canada with winners and failures.

## G.1 Regression Tests

```text
1. AURORA-SIG remains 10 components / 100 max.
2. TechnicalStrengthScore remains max 85.
3. ACS equals AURORA-SIG alias, not separate score.
4. Final bucket values are only the locked 9 buckets.
5. Diagnostic labels never appear as final_bucket.
6. Top 10 only appears when requested.
7. Bare scan does not assume India and does not assume Top 10.
8. Quality/fundamental weakness does not block by itself.
9. Every stock row carries market state note.
10. US / India / Canada adapters all run.
```

## G.2 RMV / AURORA Workflow Tests

```text
1. Recent gap within 15 bars uses RMV5.
2. IPO with fewer than 20 bars uses RMV5.
3. Normal swing base uses RMV15.
4. Long position base uses RMV25/50.
5. RMV tight without prior power = RMV_TIGHT_WATCH only.
6. RMV <=10 + clear aligned highs + stop visible = RMV_PIVOT_DEFINED.
7. Quality score >=10 + near pivot = RMV_PIVOT_TRIGGER_READY.
8. Close above pivot with constructive volume = RMV_PIVOT_BREAKOUT_CONFIRMED.
9. Breakout retest holds pivot within 1-10 bars = RMV_PIVOT_RETEST_HOLD.
10. Break below range low = RMV_PIVOT_DOWNSIDE_RESOLUTION / RMV_PIVOT_FAIL.
11. RMV contraction alone never creates bullish verdict.
12. RMV pivot + 10/20/21 EMA + HVC/AVWAP confluence upgrades pullback confluence.
```

## G.3 Theme / Funnel / Watchlist Tests

```text
1. Theme top 5/6 for 3 of 4 daily views and not monthly top 5/6 = SLEEPER_THEME_EMERGING.
2. Monthly top 5/6 + daily confirmation = THEME_CONFIRMED.
3. Monthly top 5/6 + no daily hits = THEME_FADING.
4. Theme leaders select 1-4 names only, no padding.
5. Broad routine sorts weekly %, daily %, then RMV15 low-to-high.
6. Focus list target 10-16 but no forced padding.
7. Daily Top 1-4 max 4, ideally 1; no forced Top 4.
8. Squat intact retains second-chance watchlist if support holds.
9. 21 EMA break + follow-through removes/downgrades watchlist name.
10. Market dimmer caps aggression when reference basket breaks support.
```

## G.3B Weekly Watchlist Tests

```text
1. AURORA weekly list produces its own market-native candidates without external-list comparison.
2. Weekly watchlist target is 15-20 but no forced padding below score threshold.
3. Per-theme cap prevents one theme from dominating the entire list unless market/theme confirmation allows cap expansion.
4. Missing trigger/stop prevents WEEKLY_FOCUS but not WEEKLY_UNIVERSE.
5. WATCHLIST_ONLY / DEFENSE_MODE can still create weekly watchlist, but cannot promote DAILY_TOP1-4.
6. Carry-forward survives valid squat/retest/pullback behavior.
7. 21 EMA break with follow-through or theme loss creates WEEKLY_REMOVE.
8. No weekly_tier value appears as final_bucket.
9. Weekly list output is labelled AURORA Weekly Watchlist, not AURORA Top 10.
10. US / India / Canada adapters all produce comparable WWL fields with market-specific universe, liquidity, and currency mapping.
```

## G.4 EOD / Intraday Boundary Tests

```text
1. 9:35 run-rate volume always future scope.
2. Intraday LOD stop always future scope.
3. Live buy-stop execution never emitted.
4. EOD-safe alert_price / trigger_price allowed with execution_note.
5. Session VWAP not calculated in EOD scanner.
```

## G.5 Data / Robustness Tests

```text
1. Missing theme/GICS marks PARTIAL/UNKNOWN, not block.
2. Missing reference basket marks UNKNOWN, not block.
3. External-data-required scans never silently pass as calculated.
4. India shareholding scanner does not rely on generic holder feed for LIC/government claims.
5. Candidate count must not collapse below 50% unless regime/hard overrides explain it.
6. Preservation rate from previous master should be >=80%, ideally 100%.
```

---

# PART H — Implementation Handoff

## H.1 Mode Separation

```python
if runtime_mode == "BACKTEST":
    # Hard entry gates may return no signal for performance measurement.
    # Example: liquidity fail, PX over 15%, correction, base_count >= 4.
    allow_no_signal_blocks = True
else:
    # Live scanner shows visible candidate state unless hard override applies.
    # Use final_bucket, status_flag, score_cap, override_reason.
    allow_no_signal_blocks = False
```

## H.2 Backtest/Engine Wiring Still Required

All markets:

```text
wire liquidity engine
wire regime engine
wire rotation/RRG engine
wire quality/fundamental engine
wire risk/PX engine
wire EP/PEAD with earnings prefetch
wire IPO lane with IPO date prefetch
wire HVC/AVWAP anchors
wire base shape detectors
wire RS cross / RSNH-before-price tracking
```

Base detectors to preserve:

```text
Flat Base
Double Bottom / W-base
Cup & Handle
Continuation Base
Base-on-Base
IPO Base
HTF
```

Lanes to preserve/add:

```text
AURORA-CB
AURORA-BOB
AURORA-HVC
AURORA-OOPS
AURORA-EP
AURORA-IPO
AURORA-HTF
AURORA-MYH
R01-R14 Menu R scans
```

---

# PART I — Prompt for Future Claude / Agent Handoff

Use this prompt when handing the build to Claude or another coding agent:

```text
You are implementing AURORA v2.18.1 SINGLE SOURCE OF TRUTH.
Use only AURORA_MASTER_v2_18_1_SINGLE_SOURCE_OF_TRUTH.md as the active spec.
Do not maintain separate v2.16/v2.17/v2.18 delta files.

Non-negotiables:
- AURORA remains EOD.
- US, India, and Canada adapters are required.
- AURORA-SIG is 10 components / 100 max.
- TechnicalStrengthScore max is 85.
- ACS is alias only.
- Final buckets are locked to the 9 values in the master.
- Diagnostic labels never become final_bucket.
- No live order logic or intraday automation.
- Every new label requires fields, formula, threshold, fallback, and tests.
- Proprietary AI/vendor-specific references are not allowed; use provider-neutral enrichment if needed.

Implementation priority:
1. Preserve v2.16 behavior and output router.
2. Wire v2.17 engines correctly without hiding live scanner candidates.
3. Implement v2.18/v2.18.1 RMV, Theme Tracker, Daily Top 1-4, reference basket, and Market Dimmer modules.
4. Run regression tests across US, India, and Canada.
```

---

# PART J — Final Active Rule

```text
AURORA finds opportunity. It does not force trades.

Best candidate =
  market permission supportive
  + market dimmer >= 3
  + liquidity pass
  + reference basket not breaking support
  + GICS/theme known or proxied
  + sector/theme improving or leading
  + Stage 2 / Stage 1-to-2 / constructive transition
  + RS strong or improving
  + valid setup lane
  + RMV/compression/pullback/trigger evidence
  + structural stop visible
  + risk ideally 2-4%, acceptable up to 7% with caution
  + no PX/AURORA-X hard warning
  + final bucket from locked taxonomy
```

**Active file:** `AURORA_MASTER_v2_18_1_SINGLE_SOURCE_OF_TRUTH.md`  
**Do not maintain separate master + delta files after this version.**

---

# APPENDIX K — Runtime Helper Functions

These helpers remove ambiguity from formulas above. Production may replace internals, but output semantics must remain the same.

```python
from __future__ import annotations
from math import log10, isfinite
from statistics import mean, median

SMALL = 1e-9


def clamp(value: float, low: float, high: float) -> float:
    if value is None or not isfinite(value):
        return low
    return max(low, min(high, value))


def safe_div(num: float, den: float, default: float = 0.0) -> float:
    if den is None or abs(den) < SMALL:
        return default
    if num is None:
        return default
    return num / den


def pct_change(current: float, prior: float, default: float = 0.0) -> float:
    return safe_div(current, prior, default=default) * 100 - 100


def percentile_rank(value: float, values: list[float]) -> float:
    """Returns 0.0 to 1.0. Higher value = higher percentile."""
    clean = sorted(v for v in values if v is not None and isfinite(v))
    if not clean or value is None or not isfinite(value):
        return 0.0
    below_or_equal = sum(1 for v in clean if v <= value)
    return below_or_equal / len(clean)


def top_values(values: list[float], k: int) -> list[float]:
    clean = [v for v in values if v is not None and isfinite(v)]
    return sorted(clean, reverse=True)[:max(0, k)]


def log_scale(value: float, floor: float, cap: float) -> float:
    """Maps floor..cap to 0..100 on log scale."""
    if value is None or value <= 0 or floor <= 0 or cap <= floor:
        return 0.0
    if value <= floor:
        return 0.0
    if value >= cap:
        return 100.0
    return safe_div(log10(value) - log10(floor), log10(cap) - log10(floor)) * 100


def close_position(close: float, low: float, high: float) -> float:
    return clamp(safe_div(close - low, high - low, default=0.5), 0.0, 1.0)


def range_rmv_proxy(highs: list[float], lows: list[float], closes: list[float], n: int) -> float | None:
    if len(highs) < n or len(lows) < n or len(closes) < n:
        return None
    h = max(highs[-n:])
    l = min(lows[-n:])
    c = mean(closes[-n:])
    return safe_div(h - l, c, default=0.0) * 100


def rmv_tight_label(rmv_value: float | None) -> str:
    if rmv_value is None:
        return "RMV_UNKNOWN"
    if rmv_value <= 5:
        return "RMV_ZERO"
    if rmv_value <= 10:
        return "RMV_VERY_TIGHT"
    if rmv_value <= 15:
        return "RMV_TIGHT"
    if rmv_value <= 25:
        return "RMV_NORMAL"
    return "RMV_EXPANDING"


def select_rmv_lookback(event_gap_age_days=None, ipo_age_days=None, gap_range_pctile=None,
                        hve_hv1_inside_last_15_bars=False, base_duration_days=0,
                        position_trade_mode=False) -> tuple[int, str]:
    if event_gap_age_days is not None and event_gap_age_days <= 15:
        return 5, "RECENT_GAP"
    if ipo_age_days is not None and ipo_age_days < 20:
        return 5, "IPO_INSUFFICIENT_BARS"
    if gap_range_pctile is not None and gap_range_pctile >= 95:
        return 5, "EXTREME_EVENT_RANGE"
    if hve_hv1_inside_last_15_bars:
        return 5, "HVE_HV1_INSIDE_RMV15"
    if position_trade_mode or base_duration_days >= 50:
        return (25 if base_duration_days < 100 else 50), "POSITION_BASE"
    return 15, "NORMAL_SWING"


def extract_rmv_pivot(highs: list[float], lows: list[float], closes: list[float], atr14_pct: float,
                      pivot_window_max: int = 7, pivot_window_min: int = 3) -> dict:
    if len(highs) < pivot_window_min or len(lows) < pivot_window_min:
        return {"rmv_pivot_quality": "RMV_PIVOT_QUALITY_NONE"}

    n = min(pivot_window_max, len(highs), len(lows))
    recent_highs = highs[-n:]
    recent_lows = lows[-n:]
    tolerance_pct = max(1.0, 0.25 * (atr14_pct or 0.0))
    anchor_candidates = top_values(recent_highs, k=min(4, len(recent_highs)))
    cluster_anchor = median(anchor_candidates) if anchor_candidates else max(recent_highs)
    aligned_highs = [h for h in recent_highs if abs(h - cluster_anchor) / max(cluster_anchor, SMALL) * 100 <= tolerance_pct]

    if len(aligned_highs) >= 3:
        quality = "RMV_PIVOT_QUALITY_A"
    elif len(aligned_highs) == 2:
        quality = "RMV_PIVOT_QUALITY_B"
    else:
        quality = "RMV_PIVOT_QUALITY_C"

    rmv_range_high = max(aligned_highs) if len(aligned_highs) >= 2 else max(recent_highs[-pivot_window_min:])
    rmv_range_low = min(recent_lows[-max(len(aligned_highs), pivot_window_min):])
    return {
        "rmv_range_high": rmv_range_high,
        "rmv_range_low": rmv_range_low,
        "rmv_pivot_price": rmv_range_high,
        "pivot_tolerance_pct": tolerance_pct,
        "aligned_high_count": len(aligned_highs),
        "rmv_pivot_quality": quality,
    }


def show_of_power_label(show_of_power_pct: float | None) -> str:
    if show_of_power_pct is None:
        return "SHOW_OF_POWER_UNKNOWN"
    if show_of_power_pct >= 40:
        return "SHOW_OF_POWER_STRONG"
    if show_of_power_pct >= 30:
        return "SHOW_OF_POWER_VALID"
    if show_of_power_pct >= 15:
        return "SHOW_OF_POWER_THIN"
    return "NO_SHOW_OF_POWER"


def risk_bucket(risk_pct: float | None) -> str:
    if risk_pct is None:
        return "RISK_UNKNOWN"
    if 2 <= risk_pct <= 4:
        return "RISK_IDEAL"
    if risk_pct < 2:
        return "RISK_TIGHT"
    if risk_pct <= 7:
        return "RISK_WIDE"
    return "RISK_TOO_WIDE"


def final_bucket_guard(value: str) -> str:
    allowed = {
        "TRADE_READY", "TRIGGER_READY", "EARLY_ENTRY_WATCH", "PULLBACK_WATCH",
        "RSNH_WATCH_ONLY", "NO_CHASE", "PROTECT_PROFIT_REVIEW", "REPAIR_WATCH",
        "AVOID_FRESH_LONG",
    }
    if value not in allowed:
        raise ValueError(f"Invalid final_bucket: {value}")
    return value
```

---

# APPENDIX L — Minimal Runtime Contract Example

```python
def compute_eod_alert_fields(trigger_price: float | None, initial_stop: float | None) -> dict:
    if trigger_price is None or initial_stop is None or trigger_price <= 0:
        return {
            "alert_price": trigger_price,
            "buy_stop_candidate": "NO",
            "execution_note": "EOD alert only; not an order instruction",
            "risk_pct": None,
            "risk_bucket": "RISK_UNKNOWN",
        }

    risk_pct_value = (trigger_price - initial_stop) / trigger_price * 100
    return {
        "alert_price": trigger_price,
        "buy_stop_candidate": "YES" if risk_pct_value <= 7 else "NO",
        "execution_note": "EOD alert only; not an order instruction",
        "risk_pct": risk_pct_value,
        "risk_bucket": risk_bucket(risk_pct_value),
    }
```



---

# APPENDIX M — Weekly Watchlist Runtime Reference

```python
from collections import defaultdict
from math import log10


def clamp(x, lo=0, hi=100):
    if x is None:
        return lo
    return max(lo, min(hi, x))


def scaled_technical_strength(technical_strength_score):
    return clamp((technical_strength_score or 0) / 85 * 100)


def weekly_setup_maturity_score(final_bucket):
    return {
        "TRADE_READY": 100,
        "TRIGGER_READY": 92,
        "EARLY_ENTRY_WATCH": 84,
        "PULLBACK_WATCH": 78,
        "RSNH_WATCH_ONLY": 64,
        "REPAIR_WATCH": 48,
        "NO_CHASE": 35,
        "PROTECT_PROFIT_REVIEW": 20,
        "AVOID_FRESH_LONG": 0,
    }.get(final_bucket, 40)


def weekly_risk_score(risk_bucket):
    return {
        "RISK_IDEAL": 100,
        "RISK_TIGHT": 80,
        "RISK_WIDE": 45,
        "RISK_TOO_WIDE": 0,
        "RISK_UNKNOWN": 35,
    }.get(risk_bucket, 35)


def weekly_liquidity_score(addv_usd_equiv):
    if not addv_usd_equiv or addv_usd_equiv <= 0:
        return 35
    floor = 20_000_000
    cap = 100_000_000
    return clamp((log10(max(addv_usd_equiv, 1)) - log10(floor)) / (log10(cap) - log10(floor)) * 100)


def weekly_watchlist_score(c):
    technical_component = scaled_technical_strength(c.get("technical_strength_score"))
    rs_component = c.get("rs_score_pct")
    if rs_component is None:
        rs_component = {
            "ELITE_RS": 95,
            "STRONG_RS": 85,
            "ACCEPTABLE_RS": 65,
            "WEAK_RS": 30,
        }.get(c.get("rs_trifecta_label"), 40)

    setup_component = weekly_setup_maturity_score(c.get("final_bucket"))

    rmv_component = {
        "RMV_ZERO": 100,
        "RMV_VERY_TIGHT": 90,
        "RMV_TIGHT": 75,
        "RMV_NORMAL": 50,
        "RMV_EXPANDING": 20,
        "RMV_UNKNOWN": 40,
    }.get(c.get("rmv_tight_label"), 40)
    pivot_component = {
        "RMV_PIVOT_QUALITY_A": 100,
        "RMV_PIVOT_QUALITY_B": 80,
        "RMV_PIVOT_QUALITY_C": 55,
        "RMV_PIVOT_QUALITY_NONE": 30,
    }.get(c.get("rmv_pivot_quality"), 40)
    rmv_setup_component = rmv_component * 0.65 + pivot_component * 0.35

    theme_component = c.get("theme_score_pct")
    if theme_component is None:
        theme_component = {
            "THEME_CONFIRMED": 90,
            "SLEEPER_THEME_EMERGING": 82,
            "RANK_CHANGE_LEADER": 78,
            "THEME_NEUTRAL": 55,
            "THEME_FADING": 20,
            "THEME_UNKNOWN": 45,
        }.get(c.get("theme_tracker_label"), 45)

    risk_component = weekly_risk_score(c.get("risk_bucket"))
    liquidity_component = weekly_liquidity_score(c.get("avg_dollar_volume_20_usd_equiv"))
    power_component = {
        "SHOW_OF_POWER_STRONG": 100,
        "SHOW_OF_POWER_VALID": 85,
        "SHOW_OF_POWER_THIN": 55,
        "NO_SHOW_OF_POWER": 25,
        "SHOW_OF_POWER_UNKNOWN": 45,
    }.get(c.get("show_of_power_label"), 45)
    market_component = clamp((c.get("market_dimmer") or 0) / 5 * 100)
    persistence_key = c.get("squat_label") or c.get("watchlist_action")
    persistence_component = {
        "SQUAT_INTACT_SECOND_CHANCE": 80,
        "SQUAT_RETEST_WATCH": 85,
        "SQUAT_FAILED_AURORA_X2": 10,
        "WATCHLIST_KEEP": 65,
        "WATCHLIST_DOWNGRADE": 35,
        "WATCHLIST_REPAIR_ONLY": 30,
        "WATCHLIST_REMOVE_21EMA_BREAK_FOLLOWTHROUGH": 0,
        "WATCHLIST_REMOVE_THEME_LOSS": 0,
    }.get(persistence_key, 50)

    return round(
        0.16 * technical_component
        + 0.14 * rs_component
        + 0.14 * setup_component
        + 0.12 * theme_component
        + 0.10 * rmv_setup_component
        + 0.10 * risk_component
        + 0.08 * liquidity_component
        + 0.06 * power_component
        + 0.06 * market_component
        + 0.04 * persistence_component,
        2,
    )


def weekly_list_eligible(c):
    hard_overrides = {"STAGE_4_DAMAGED", "AURORA_X_HARD_BLOCK", "LIQUIDITY_FAIL"}
    if c.get("final_bucket") == "AVOID_FRESH_LONG":
        return False
    if c.get("override_reason") in hard_overrides:
        return False
    if c.get("liquidity_label") == "LIQUIDITY_FAIL":
        return False
    if c.get("stage_label") == "STAGE_4":
        return False
    if c.get("weekly_context_label") == "WEEKLY_CONTEXT_FAIL" and c.get("setup_state") not in {"REPAIR_WATCH", "RSNH_WATCH_ONLY"}:
        return False
    return True


def assign_weekly_tier(c):
    if c.get("watchlist_action") in {"WATCHLIST_REMOVE_21EMA_BREAK_FOLLOWTHROUGH", "WATCHLIST_REMOVE_THEME_LOSS"}:
        return "WEEKLY_REMOVE"
    if c.get("final_bucket") == "REPAIR_WATCH" or c.get("watchlist_action") == "WATCHLIST_REPAIR_ONLY":
        return "WEEKLY_REPAIR_ONLY"
    if c.get("squat_label") in {"SQUAT_INTACT_SECOND_CHANCE", "SQUAT_RETEST_WATCH"}:
        return "WEEKLY_SQUAT_INTACT"
    if c.get("final_bucket") == "PULLBACK_WATCH" or c.get("pullback_sequence_label") in {"FIRST_PULLBACK_AFTER_POWER", "SECOND_PULLBACK_AFTER_POWER"}:
        return "WEEKLY_PULLBACK_RETEST"
    if c.get("weekly_watchlist_score", 0) >= 70 and c.get("trigger_price") and c.get("initial_stop") and (c.get("risk_pct") or 999) <= 7:
        return "WEEKLY_FOCUS"
    if c.get("weekly_watchlist_score", 0) >= 55:
        return "WEEKLY_CORE"
    return "NOT_WEEKLY_LIST"


def select_aurora_weekly_watchlist(candidates, target_min=15, target_max=20):
    scored = []
    for c in candidates:
        c = dict(c)
        c["weekly_list_eligible"] = weekly_list_eligible(c)
        c["weekly_watchlist_score"] = weekly_watchlist_score(c) if c["weekly_list_eligible"] else 0
        if c["weekly_list_eligible"] and c["weekly_watchlist_score"] >= 55:
            scored.append(c)

    ranked = sorted(scored, key=lambda x: (x["weekly_watchlist_score"], x.get("technical_strength_score", 0), x.get("rs_score_pct") or 0), reverse=True)
    selected = []
    theme_counts = defaultdict(int)

    for c in ranked:
        theme = c.get("theme_primary") or "UNKNOWN"
        cap = 5 if c.get("market_dimmer", 0) >= 4 and c.get("theme_tracker_label") == "THEME_CONFIRMED" else 4
        if theme_counts[theme] >= cap:
            continue
        c["weekly_tier"] = assign_weekly_tier(c)
        selected.append(c)
        theme_counts[theme] += 1
        if len(selected) >= target_max:
            break

    supply_state = "HEALTHY" if len(selected) >= target_min else "THIN"
    return {
        "weekly_watchlist": selected,
        "list_count": len(selected),
        "target_min": target_min,
        "target_max": target_max,
        "candidate_supply": supply_state,
    }
```
