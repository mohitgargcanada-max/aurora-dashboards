---
name: aurora-stock-analysis
description: >
  AURORA Stock & Sector Analysis Skill v2.15.
  Use whenever user asks about a stock, sector, theme, watchlist,
  or market scan using the AURORA framework.
  Triggers: any ticker + analysis, "AURORA [ticker]",
  "analyze [stock/sector]", "which sectors are leading",
  "is [stock] a buy", "rotation scan", "pocket pivot scan",
  "RS scan", "breadth analysis", "sector rotation", "RRG",
  "breakout lag", "lead-time scan", "market breadth",
  "AURORA scan", "AURORA verdict", "trade plan", "sell-risk review",
  "watchlist review", "portfolio review", "pullback entry",
  "MYH scan", "PEAD scan", "EP scan", "HVC scan", "AVWAP scan".
  Markets: US (NYSE/NASDAQ), India (NSE/BSE), Canada (TSX).
  Does NOT produce blind buy/sell calls. Classifies setup state with evidence.
---

# AURORA Stock & Sector Analysis Skill
**Version: v2.15 — EOD Scope Lock + AURORA-SIG + Consolidated Scan Menu**

---

## CORE PHILOSOPHY

```
North Star: Find the earliest, cleanest entry in the strongest stocks
            before the obvious breakout.
            Only be aggressive when market cycle AND leadership breadth confirm.
            Use weekly charts for context, daily for setup timing.
            Detect early when a setup is starting to fail or exhaust.
            Every label must be earnable. Every note must be explainable.

AURORA surfaces candidates, explains evidence, and flags risk.
It does not force trades, prescribe share quantity, or override user risk planning.
Technical Signal ≠ Trade Decision.
AURORA Verdict = final decision after ALL lanes checked.
```

---

## AURORA GATEWAY TOOL CALLS

**Always call tools FIRST in one batch, then analyze.**
**Never call one tool and comment, then call another.**
**Batch all → analyze → respond.**

### Single stock — call all in one batch:

```
Market: us / india / canada (detect from ticker or ask once)

Batch 1 (always):
  aurora-gateway: get_quote            (ticker, market)
  aurora-gateway: get_ohlcv            (ticker, market, period="2y")
  aurora-gateway: get_earnings_history (ticker, market, quarters_back=4)
  aurora-gateway: get_fundamentals     (ticker, market)
  aurora-gateway: get_analyst_ratings  (ticker, market)
  aurora-gateway: get_ohlcv            (benchmark, market, period="2y")
    Benchmarks: SPY+QQQ (US) / ^NSEI (India) / ^GSPTSE (Canada)

Batch 2 (market-specific):
  US:     get_insider_by_ticker (ticker, market="us", days_back=90)
          get_short_interest    (ticker, market="us")
  India:  get_fii_dii_flows     (market="india")
          get_shareholding      (ticker, market="india")
          get_market_pulse      (market="india")
  Canada: get_questrade_positions () [if portfolio context needed]
```

### Sector analysis:
```
  get_universe    (market)
  get_ohlcv       (sector ETF proxy, market, period="1y")
  get_market_pulse (market)
  get_fii_dii_flows (market="india") [India only]
```

---

## FULL ANALYSIS PIPELINE

Compute all layers in order after receiving tool data.

---

### LAYER 1 — AURORA-MC2: Market Cycle Confirmation

```
Purpose: Determine when market environment supports fresh long trades.

From benchmark OHLCV:
  1-2 closes above 21 EMA = CYCLE_ON
  1-2 closes below 21 EMA = CYCLE_OFF

Three-part confirmation:
  Part 1: Index cycle (above/below 21 EMA)
  Part 2: Trade feedback (are new entries working or failing?)
  Part 3: Leader action (breaking out together or breaking down?)

Market Cycle Labels:
  MARKET_CYCLE_ON / MARKET_CYCLE_OFF / MARKET_TRANSITION
  MARKET_RECONFIRMATION / MARKET_UNDER_PRESSURE
  MARKET_LEADERS_CONFIRMING / MARKET_LEADERS_DIVERGING
  TRADE_FEEDBACK_POSITIVE / TRADE_FEEDBACK_NEGATIVE

Market Permission States:
  TRADE_ALLOWED    = cycle on + leadership confirming → normal output
  SELECTIVE_ONLY   = improving but breadth/feedback mixed → best names only
  WATCHLIST_ONLY   = below cycle guide or unconfirmed → no aggressive longs
  DEFENSE_MODE     = cycle off + leaders breaking down → protect capital
  TRANSITION_MODE  = bottoming signs but no confirmation → pilot/watch only

Cycle Phase Entry Rules:
  Cycle Off:        no new buys; watchlist / protect existing only
  Transition:       RSNH watch, U&R/Oops only with tight risk, pilot only
  Cycle Turns On:   21 EMA pops, base breakouts, range breakouts
  Confirmed On:     full trigger-ready, pullbacks, gap-and-go
  Late/Pressure:    tighten quality bar; favor pullbacks; avoid chase
  Turning Off:      AURORA-X2/PX warnings increase priority
```

---

### LAYER 2 — AURORA-LB: Leadership Breadth

```
Purpose: Is leadership broad enough to confirm the cycle?

Count quality breakouts over same day / same week:
  0         = LEADERSHIP_ABSENT
  1-2       = LEADERSHIP_ISOLATED
  3-5       = LEADERSHIP_EMERGING
  6-10      = LEADERSHIP_BREADTH_CONFIRMING
  10-15+    = LEADERSHIP_CLUSTER_CONFIRMED

Leadership Quality Filters (only count if ALL pass):
  liquidity pass
  RS line improving or near high
  price above key MAs
  base or tight range structure valid
  volume confirms or constructive
  sector/theme not deteriorating
  AURORA-X hard risk not active

Divergence flags:
  INDEX_ABOVE_21EMA_BUT_LEADERS_WEAK
  INDEX_BELOW_21EMA_BUT_LEADERS_EMERGING
  LEADERS_BREAKING_DOWN_TOGETHER
  FAILED_BREAKOUT_CLUSTER

Leadership → Tradeability:
  Market ON + cluster = normal/full trigger-ready
  Market ON + weak leadership = selective-only
  Market OFF + 1-2 leaders = RSNH/watchlist only
  Market OFF + leaders breaking down = defense mode
```

---

### LAYER 3 — AURORA-MTF: Multi-Timeframe Execution Gate

```
Purpose: Separate context from timing.
  Weekly = whether trade deserves attention
  Daily  = how and when to enter
  Intraday = future scope (AURORA-INTRADAY — not yet built)

Weekly Context Gate (resample daily → weekly):
  10-week MA rising? Price above 10-week?
  40-week MA rising? Weinstein Stage 2 on weekly?
  No close below 10-week in last 3 weeks?

Weekly Labels:
  WEEKLY_CONTEXT_STRONG  = price above rising 10W + 40W + Stage 2
  WEEKLY_CONTEXT_OK      = mostly intact, minor violation
  WEEKLY_CONTEXT_FAIL    = price below key weekly MA
  WEEKLY_CONTEXT_REPAIR  = rebuilding after violation

Daily Timing Layer:
  21 EMA / 50 SMA intact?
  Compression present?
  Volume dry-up?
  Trigger catalyst present?

MTF Alignment Scenarios:
  Weekly strong + daily trigger = TRIGGER_READY eligible
  Weekly ok + daily pullback at MA = PULLBACK_WATCH
  Weekly fail + daily bounce = REPAIR_WATCH (not trade-ready)
  Weekly strong + daily extended = wait for pullback

MTF Score: 0-3 (weekly context + daily setup + trigger each add 1)

Key Rule:
  Weekly broken + daily bounce = REPAIR_WATCH, not trade-ready.
```

---

### LAYER 4 — AURORA-PULLBACK v2

```
Purpose: High-quality entries inside established uptrends.

Pullback valid only when:
  stock in uptrend
  weekly context intact
  daily pullback controlled
  volume declines during pullback
  support is a confluence zone (not single line)
  reversal confirmation appears

Pullback Confluence Inputs (support sources):
  21 EMA / 50 SMA / 10-week MA
  prior pivot / prior resistance now support
  high-volume close (HVC)
  gap low / gap midpoint / gap origin
  AVWAP / base-low support / round-number level

Pullback Quality Labels:
  PULLBACK_CONFLUENCE_STRONG   = 3+ support levels overlap
  PULLBACK_CONFLUENCE_MODERATE = 2 levels
  PULLBACK_CONFLUENCE_WEAK     = 0-1 level
  PULLBACK_VOLUME_DRYING       = volume declining constructively
  PULLBACK_HEAVY_SELLING_WARNING = high down-volume
  PULLBACK_WIDE_AND_LOOSE      = volatile, disorderly
  PULLBACK_ORDERLY             = controlled, tight
  PULLBACK_SUPPORT_RECLAIM     = reclaimed support level

Pullback Reversal Triggers:
  OOPS_REVERSAL
  UNDERCUT_AND_RALLY
  UPSIDE_REVERSAL
  POSITIVE_EXPECTATION_BREAKER
  NO_FOLLOW_THROUGH_DOWN
  21EMA_UPSIDE_REVERSAL
  50SMA_RECLAIM
  HVC_RECLAIM
  AVWAP_RECLAIM

Pullback Score 0-12:
  10-12 = highest quality
  6-9   = valid/watch
  < 6   = skip or wait

Score factors:
  Trend context / Volume / Confluence count
  Reversal quality / Market state / Base stage
```

---

### LAYER 5 — AURORA-MA: Moving Average Character

```
Purpose: Identify which MA a stock respects and whether breaks are meaningful.

MA Systems Normalization:
  Daily 21 EMA     ≈ Weekly 10-week MA  (short-term trend)
  Daily 50 SMA     ≈ Weekly intermediate trend
  Daily 200 SMA    ≈ Weekly 40-week MA  (stage anchor)
  20 EMA ≈ 21 EMA  → display as 20/21 EMA, never double-count

MA Character Profile (compute from history):
  ma_character_primary    = which MA stock has respected most
  ma_character_secondary  = backup MA
  ma_respect_history_count = how many times respected
  ma_break_significance   = noise vs structural
  ma_slope_state          = rising / flat / declining

MA Warning Labels:
  21EMA_BREAK_WARNING       = close below rising 21 EMA
  21EMA_RECLAIM_VALID       = reclaim of rising 21 EMA
  21EMA_RESPECT_CONFIRMED   = bounce from 21 EMA with volume
  50SMA_SERIOUS_WARNING     = close below 50 SMA
  50SMA_RECLAIM             = reclaim 50 SMA
  10WEEK_FIRST_CLOSE_BELOW  = first weekly close below 10W
  10WEEK_SECOND_CLOSE_BELOW = second close = more serious
  10WEEK_WIDE_CLOSE_BELOW   = gap below 10W = structural damage
  40WEEK_SUPPORT_TEST       = testing long-term stage anchor
  40WEEK_BREAK_WARNING      = closing below 40-week = Stage change
  DECLINING_MA_RECLAIM_INVALID = reclaim of declining MA = weak
  MA_CHARACTER_CHANGE       = stock no longer respecting usual MA

MA Rule Lock:
  Use the MA the stock has previously respected.
  Do not treat every MA break the same.
  Declining MA reclaim is weaker than rising MA reclaim.
  Weekly trend wins for position trades / daily cushion.
  Daily trend wins for swing trades / fresh breakouts.
```

---

### LAYER 6 — RS Calculation

```
rs_line = stock_close / benchmark_close
rs_ema21 = ewm(span=21) of rs_line

RS Trifecta:
  c1 = rs_line[-1] > rs_ema21[-1]       (above 21 EMA)
  c2 = rs_line[-1] > max(rs_line[-63:-1]) (3M new high)
  c3 = rs_slope_5d > 0                  (positive slope)
  PASS = all 3 / PARTIAL = 2 / FAIL < 2

Mansfield RS Proxy:
  MANSFIELD_RS = (RS_LINE_t / RollingMean(RS_LINE,52) - 1) * 100

RS Trifecta Bridge (highest quality):
  RS_TRIFECTA_POSITIVE =
    RS_LINE_NEW_52W_HIGH
    AND RS_LINE_ABOVE_20_21
    AND MANSFIELD_RS > 0

RS Classification:
  ELITE_RS      = Trifecta PASS + Mansfield > 0 + 52W high
  STRONG_RS     = Trifecta PASS
  ACCEPTABLE_RS = Trifecta PARTIAL
  WEAK_RS       = Trifecta FAIL

Best signal: RS line makes new high BEFORE price breakout.
RS strength during market correction = most reliable leadership signal.

Benchmark Mapping:
  US:     SPY (broad) / QQQ (growth/innovation)
          Sector proxies: XLK, XLF, XLI, XLE, XLY, XLP, XLV, XLU
  India:  ^NSEI (broad) / Nifty 500 (universe)
          Sector: Nifty IT, Bank Nifty, Nifty Auto, Nifty Pharma,
                  Nifty Energy, Nifty Infra, Nifty FMCG, Nifty Metal
  Canada: ^GSPTSE (broad) / XIC.TO, XIU.TO, ZCN.TO
          Sector proxies: XEG.TO and commodity proxies
```

---

### LAYER 7 — Weinstein Stage

```
Weekly 30-week SMA + slope:
  Stage 2:   price > sma30w AND slope > 0.1%
  Stage 1→2: just crossed above rising sma30w
  Stage 1:   within 5% of sma30w, slope flat (-0.1% to +0.1%)
  Stage 3:   near sma30w, slope < -0.1%
  Stage 4:   price < sma30w, slope < -0.1%

Stage 2 lifecycle:
  Stage 2A = early Stage 2 (1-13 weeks) + 1st base = maximum aggression
  Stage 2B = mid Stage 2 (14-39 weeks) + 2nd base = normal aggression
  Stage 2C = mature Stage 2 (40+ weeks) = reduce size, tighten
```

---

### LAYER 8 — Setup & Base Geometry

```
ATR14 + compression:
  atr14 = Wilder 14-day ATR
  dcr_5 = 5-day range / 5-day avg price * 100
  vol_dryup = tail(5).mean() / tail(20).mean()
  inside_day = high[-1] < high[-2] AND low[-1] > low[-2]

Pivot proximity:
  base_high_10w = weekly_close.tail(10).max()
  price_vs_pivot = (close[-1] - base_high_10w) / base_high_10w * 100
  AT_PIVOT=0-1% below / PIVOT_BOX=1-5% below
  EXTENDED_MILD=5-10% above / EXTENDED_FAR=>20% above

Base type:
  VCP_BASE / FLAT_BASE / CUP_HANDLE / DOUBLE_BOTTOM
  HTF / IPO_BASE / BOTTOMING_BASE / CONTINUATION_BASE / BASE_ON_BASE

Base Depth:
  BaseDepthPct = (BaseHigh - BaseLow) / BaseHigh * 100

Base Validity:
  Valid if depth is appropriate for type:
    Flat base: <= 15%
    Cup: 12-30%
    VCP: tightening contractions
    HTF: 10-25% flag after 100%+ pole

Base Count (O'Neil):
  BASE_COUNT_1 = best quality — highest probability
  BASE_COUNT_2 = still strong
  BASE_COUNT_3 = caution
  BASE_COUNT_4+ = high failure risk / late stage

Stage Classification for base:
  STAGE_2A + BASE_COUNT_1 = highest conviction setup
  STAGE_2B + BASE_COUNT_2 = good but manage carefully
  STAGE_2C + BASE_COUNT_3+ = reduce size significantly
```

---

### LAYER 8b — AURORA-VA: AVWAP (EOD Calculation)

```
AVWAP is fully EOD-compatible. No intraday data needed.

Formula (from anchor date to today using daily bars):
  typical_price = (high + low + close) / 3  [daily bar]
  avwap = cumsum(typical_price * volume) / cumsum(volume)
  anchor = specific event date

Anchor events:
  AVWAP_EARNINGS  = anchor at most recent earnings date
  AVWAP_IPO       = anchor at IPO date (from get_quote ipo_date)
  AVWAP_52W_LOW   = anchor at 52-week low date
  AVWAP_BASE_START = anchor at base formation start
  AVWAP_GAP       = anchor at gap-up/EP date
  AVWAP_YTD       = anchor Jan 1 current year

AVWAP interpretation:
  Price above AVWAP = demand in control since anchor event
  Price below AVWAP = supply in control since anchor event
  Price at AVWAP    = decision point / key support-resistance

AVWAP signals:
  AVWAP_CONFLUENCE = AVWAP within 1% of 21 EMA or 50 SMA
                     → strongest support zone / tightest stop
  AVWAP_PINCH      = price contracting between AVWAP and MA
                     → compression before move
  AVWAP_RECLAIM_CLEAN  = reclaim on dry volume
  AVWAP_RECLAIM_VOLUME = reclaim on expanding volume (strong)
  AVWAP_LOSS           = structural sell-risk (X2 warning)

Gateway sources for anchor dates:
  get_earnings_history (ticker, market) → earnings dates
  get_quote (ticker, market) → ipo_date
  get_ohlcv (ticker, market, period="2y") → price history for AVWAP calc
```

---

### LAYER 9 — Volume Edge (AURORA-VE)

```
Explicit lane — not just a supporting indicator.
Pattern tells us structure. Volume tells us conviction.
Effort/result tells us quality.

rvol_20d = volume[-1] / volume.tail(20).mean()
close_pos = (close[-1] - low[-1]) / (high[-1] - low[-1])
ud_ratio_20d = up_day_vol_20d / down_day_vol_20d

HV Tiers (from full OHLCV history):
  HVE  = today_vol > ALL historical volume
  HV1  = today_vol > max of last 252 days
  HVLE = today_vol > max since last earnings
  HVC  = close price on a high-volume day (support level)

Volume Edge Labels:
  VE_ACCUMULATION       = rvol > 1.5 + close_pos > 0.5 + up day
  VE_BREAKOUT_CONFIRM   = rvol > 1.5 + breakout context + upper close
  VE_DRY_UP_SETUP       = vol_dryup < 0.5 (constructive)
  VE_HVC_SUPPORT        = holding prior HVC level
  VE_GAP_HVE            = gap day with HVE/HV1 character
  VE_DELIVERY_CONFIRM   = delivery pct >= 50% on up day (India)
  VE_EFFORT_RESULT_POS  = high effort + positive result
  VE_EFFORT_RESULT_NEG  = high effort + poor result (warning)
  VE_DISTRIBUTION_WARNING = rvol > 1.5 + close_pos < 0.4 + down day
  VE_CLIMAX_RISK        = rvol > 3.0 + extended + upper close
  VE_RAW_VOLUME_EXHAUST = abnormal raw volume after vertical move
  VE_LOW_QUALITY_VOLUME = volume without price follow-through

Rule: High volume is NOT automatically bullish.
      Interpret with close quality + trend stage + PX + context.
```

---

### LAYER 10 — AURORA-SEPA: Conviction Overlay

```
Purpose: Stage 2 quality / trend-template conviction grading.

SEPA (Stan Weinstein + CANSLIM + Trend Template) checks:
  Stock in Stage 2 uptrend (Weinstein)
  Price above 150 SMA and 200 SMA
  150 SMA above 200 SMA
  200 SMA trending up (at least 1 month)
  Price at least 25% above 52-week low
  Price within 25% of 52-week high
  RS vs benchmark: STRONG or ELITE
  EPS + revenue trending upward

SEPA Conviction Grades:
  SEPA_HIGH_CONVICTION   = 6-8 checks pass → trend template confirmed
  SEPA_MEDIUM_CONVICTION = 4-5 checks pass → partial confirmation
  SEPA_LOW_CONVICTION    = < 4 checks pass → not a trend leader
  SEPA_NOT_APPLICABLE    = Stage 1/3/4 → different framework

SEPA is applied AFTER base/pattern detection, not instead of it.
High SEPA conviction = setup quality multiplier.
```

---

### LAYER 11 — AURORA-PEAD: Post-Earnings Drift

```
Purpose: Identify and score post-earnings drift candidates.

PEAD Math:
  GapPct = Open_E / PrevClose_E - 1
  PEAD_Return_N = Close_{E+N} / Close_E - 1
  PEAD_Hold = price above GapLow / HVC / AVWAP_EARNINGS
  PEAD_Drift_Valid = PEAD_Return_5D > 0 AND no GapLow failure

Gap Acceptance:
  GAP_ACCEPTED = strong close (upper 50% of bar) + holds gap low
  GAP_FAILED   = weak close or gap-low breach

PEAD Score 0-100:
  +20 earnings/catalyst surprise quality
  +20 gap accepted / HVC day
  +15 RS improvement / RSNH
  +15 holds AVWAP / gap low / HVC
  +10 volume quality
  +10 market permission
  +10 no AURORA-X/PX warning

PEAD Labels:
  PEAD_TIER_1_WATCH = 80-100
  PEAD_TIER_2_WATCH = 65-79
  PEAD_TIER_3_WATCH = 50-64
  PEAD_WEAK_WATCH   = 35-49
  NO_PEAD_SIGNAL    = < 35

EP Score 0-100:
  +20 game-changing catalyst
  +15 neglect present before event
  +15 sales/earnings acceleration
  +10 guidance raise
  +10 volume HVE/HV1
  +10 market cap / supply-demand room
  +10 RS confirmation
  +10 market condition

EP Labels:
  TRUE_EP          = EP_SCORE >= 75
  STOCK_IN_PLAY    = 50 <= EP_SCORE < 75
  NOT_ACTIONABLE_GAP = EP_SCORE < 50

Drift window:
  Swing: 5-15 days post-event
  Position: 15-45 days post-event
  Expired: > 45 days
```

---

### LAYER 12 — AURORA-RRG: Sector Rotation

```
RS Ratio = (stock or sector 52W return / benchmark 52W return) * 100
RS Momentum = 26W change in RS Ratio * 100

JdK-Style Proxies:
  JdK_RS_Ratio = rs_line / sma(rs_line, 10) * 100
  JdK_RS_Momentum = rs_momentum_line / sma(rs_momentum_line, 10) * 100

Quadrant:
  LEADING   = RS Ratio > 100 AND Momentum > 100
  WEAKENING = RS Ratio > 100 AND Momentum <= 100
  IMPROVING = RS Ratio <= 100 AND Momentum > 100
  LAGGING   = RS Ratio <= 100 AND Momentum <= 100

Tail Delta (direction of rotation):
  tail_delta_ratio    = RS_Ratio_today - RS_Ratio_prior
  tail_delta_momentum = RS_Momentum_today - RS_Momentum_prior
  Positive both = accelerating into quadrant
  Negative both = decelerating / risk of reversal

Quadrant Transitions:
  LAGGING → IMPROVING   = early rotation watch
  IMPROVING → LEADING   = confirmed leadership
  LEADING → WEAKENING   = fatigue — reduce aggression
  WEAKENING → LAGGING   = avoid fresh longs

Rotation Quality:
  ROTATION_SWEET_SPOT = IMPROVING → LEADING transition
  LEADERSHIP_FATIGUE  = LEADING + weakening tail
  EARLY_ROTATION      = LAGGING → IMPROVING

RRG Confidence Flags (always include):
  RRG_PRODUCTION_GRADE = live validated inputs, aligned dates
  RRG_PROXY_MODE       = live but sector is proxy, not official index
  RRG_REVIEW_ONLY      = synthetic or test context
  RRG_MISSING_INPUT    = required series unavailable
  RRG_STALE_INPUT      = data older than freshness threshold

Hard Rule:
  RRG alone cannot generate Buy/Sell/Hold.
  RRG only modifies sector context and ranking.
  Tradeability still requires: price setup + trigger + risk + market gate.
```

---

### LAYER 13 — AURORA-RLT: Rotation Lead-Time

```
Track timing from sector rotation to stock breakout:

Sector event dates (record when they occur):
  Sector_Lagging_To_Improving_Date
  Sector_Improving_To_Leading_Date
  Sector_Leading_To_Weakening_Date

Stock event dates (compute from OHLCV):
  RS_Line_Cross_21_Date    = when RS crosses above 21 EMA
  RSNH_3M_Date             = when RS makes 3M new high
  RSNH_52W_Date            = when RS makes 52W new high
  Early_Entry_Date         = pocket pivot / EMA cross / reclaim
  Base_Breakout_Date       = price pivot breakout

Lead-Time Calculations:
  Days_RS_Cross_After_Improving  = RS_Cross - Sector_Improving
  Days_RSNH_After_Improving      = RSNH_Date - Sector_Improving
  Days_Entry_After_Improving     = Early_Entry - Sector_Improving
  Days_Breakout_After_Improving  = Breakout - Sector_Improving

Breakout Lag Buckets:
  0-5d   = BREAKOUT_LAG_FAST
  6-15d  = BREAKOUT_LAG_NORMAL
  16-30d = BREAKOUT_LAG_DELAYED_VALID
  31+d   = BREAKOUT_LAG_LATE
  N/A    = BREAKOUT_PENDING

Strongest sequence:
  Sector Lagging → Improving
  → stock RS crosses above 21 EMA (early signal)
  → stock RS makes new high BEFORE price
  → pocket pivot / EMA cross / reclaim
  → price breaks out

Sector Breakout Confirmation Score 0-10:
  +2 sector in IMPROVING or LEADING quadrant
  +2 >60% stocks in sector above 50 SMA
  +2 >3 stocks breaking out in same week
  +2 RS breadth improving across sector
  +2 no leadership fatigue signal

Missing Data Policy:
  Sector date unknown:    RLT_TIMEFRAME_ONLY_MODE
  Stock events partial:   RLT_PARTIAL_STOCK_EVENT_DATA
  Sector mapping missing: RLT_SECTOR_MAPPING_REQUIRED
```

---

### LAYER 14 — Market Breadth Concentration (AURORA-MBC)

```
Purpose: Is this a broad rally or a narrow one propped by a few names?

Math:
  IndexReturn_N = IndexClose_today / IndexClose_N_days_ago - 1
  StockReturn_i = StockClose_i / StockClose_i_N_days_ago - 1
  Weight_i = MarketCap_i / sum(MarketCap_all)  [proxy if official unavailable]
  StockContribution_i = Weight_i * StockReturn_i
  Top10ContributionPct = sum(top 10) / IndexReturn_N * 100
  BreadthRatio = PositiveContributionCount / TotalConstituents * 100
  HHI = sum(ContributionShare_i^2)
  EffectiveContributorCount = 1 / HHI

Warnings:
  Top10ContributionPct > 70%  = NARROW_RALLY_WARNING
  BreadthRatio < 40%          = WEAK_PARTICIPATION_WARNING
  HHI >= 0.10                 = CONCENTRATION_WARNING
  Top10Pct > 85% OR breadth < 30% = SEVERE_FRAGILE_RALLY

Classifications:
  BROAD_RALLY_HEALTHY  / BREADTH_MONITOR
  NARROW_RALLY_WARNING / FRAGILE_RALLY / SEVERE_FRAGILE_RALLY

Rule: Narrow rally does NOT automatically turn market off.
      It raises the quality bar and reduces position aggression.
```

---

### LAYER 15 — Q Label (Fundamentals)

```
From get_earnings_history + get_fundamentals:
  eps_trend:     accelerating / flat / decelerating
  revenue_trend: accelerating / flat / decelerating

  Q_STRONG   = eps growth >= 25% AND revenue growth >= 15%
  Q_ADEQUATE = one metric passes
  Q_THIN     = below thresholds
  Q_FAIL     = eps declining 2+ consecutive quarters
  Q_PROXY    = data unavailable
  Q_IPO_LANE = IPO 1st base — standard Q not applied

  Q_FAIL = FLAG not BLOCKER (except HTF_TRUE requires Q_ADEQUATE minimum)

Delivery Confirmation (India — from institutional data):
  DELIVERY_CONFIRM      = delivery_pct >= 50%
  HIGH_DELIVERY         = delivery_pct >= 60%
  VERY_HIGH_DELIVERY    = delivery_pct >= 70%
  DELIVERY_ACCUMULATION = HIGH_DELIVERY + price up + upper-half close
  DELIVERY_DISTRIBUTION = HIGH_DELIVERY + price down + lower-half close
```

---

### LAYER 16 — Extension / PX Risk (AURORA-X2.PX)

```
dist_21ema = (close[-1] - ema21[-1]) / ema21[-1] * 100
dist_50sma = (close[-1] - sma50[-1]) / sma50[-1] * 100
dist_10w   = (close[-1] - ma10w[-1]) / ma10w[-1] * 100

PX Exhaustion Composite:
  Track: consecutive up days, range expansion, raw volume spike,
         highest-volume event, slope change, weak close after vertical

Extension Labels:
  NORMAL              = dist_21ema < 5%
  MILD_EXTENSION      = dist_21ema 5-10%
  EXTENDED_FROM_21EMA = dist_21ema 10-15%
  EXTENDED_FROM_50SMA = dist_50sma > 10%
  PX_NO_CHASE         = dist_21ema 15-20%
  PX_EXHAUSTION_WATCH = dist_21ema 20-25%
  PX_HARD_WARNING     = dist_21ema > 25% OR weak close after vertical

Classification:
  Strong + not extended    = trigger-ready
  Strong + mild extension  = selective entry only
  Strong + very extended   = no fresh chase
  Strong + PX warning      = protect-profit review
  Weak + extended + breaks = repair / avoid

Rule: Strong + extended = do not chase.
      Extension does NOT automatically block a genuine leader.
      Classify correctly instead of blocking.
```

---

### LAYER 17 — AURORA-X2: Structural Sell-Risk + Stop

```
structural_stop = base_low or compression_low or MA invalidation
risk_pct = (close[-1] - structural_stop) / close[-1] * 100

Stop Selection Hierarchy:
  1st: final contraction low (VCP/RMV)
  2nd: handle low / base low
  3rd: gap low / HVC low
  4th: AVWAP support failure level
  5th: 21 EMA or 50 SMA invalidation
  6th: ATR-based floor (minimum noise buffer)

Invalidation Signals:
  2 closes below key MA
  Break of gap low / AVWAP
  Failed reclaim of breakout pivot
  Heavy volume break of base low
  Sharp break of multiple lows

Risk Buckets:
  IDEAL     = 0-3%   (full position eligible)
  NORMAL    = 3-4.5% (normal/half)
  WIDE      = 4.5-6% (pilot only)
  VERY_WIDE = 6-8%   (watch/tiny)
  SKIP      = > 8%   (not early entry)

ATR Validation:
  stop_atr_ratio = risk_pct / atr_noise_floor
  ATR_STOP_VALID   = ratio 0.75-2.5x
  ATR_TOO_TIGHT    = ratio < 0.75
  ATR_TOO_WIDE     = ratio > 2.5x

X2 Verdict:
  X2_CLEAR / X2_WATCH / X2_WARNING
  X2_HARD_WARNING / X2_REPAIR_REQUIRED
```

---

### LAYER 18 — AURORA-SIG Score (0-100)

```
Component         Weight  What it measures
─────────────────────────────────────────────────────
MarketScore        12 pts  MC2 cycle state + permission
RSScore            12 pts  RS Trifecta + Mansfield + RSNH
RRGScore           10 pts  RRG quadrant + rotation phase
PatternScore       13 pts  Base type + count + SEPA + compression
EntryScore         10 pts  Trigger quality + pocket pivot + EMA cross
VolumeScore        10 pts  VE tier + accumulation + UD ratio
FundamentalScore   10 pts  Q label (EPS + revenue trend)
PullbackScore       8 pts  MA respect + vol dryup + MTF + confluence
RiskScore          10 pts  Stop clarity + risk % bucket
ExtensionScore      5 pts  PX risk modifier (negative)
─────────────────────────────────────────────────────
Total             100 pts

Thresholds:
  80+  = high quality
  70-79 = trigger watch
  60-69 = watchlist
  50-59 = repair / conditional
  <50  = avoid / weak

Hard Overrides (always win regardless of score):
  Stage 4                 → SKIP_DAMAGED
  AURORA-X X3/X4          → SKIP_DAMAGED
  Market CORRECTION       → cap WATCHLIST_ONLY
  PX_HARD_WARNING         → cap NO_CHASE
  Liquidity fail          → LIQUIDITY_FAIL
  Weekly broken + no base → cap REPAIR_WATCH

Technical Strength Score (no fundamentals):
  max 83 pts (sum of all except FundamentalScore)
  TECHNICALLY_ELITE    >= 70
  TECHNICALLY_STRONG   55-69
  TECHNICALLY_ADEQUATE 40-54
  TECHNICALLY_WEAK     < 40

Note: ACS = legacy alias for AURORA-SIG (acs_score = aurora_sig_score)
```

---

### LAYER 19 — Tradeability Classifier

```
Requires ALL of:
  market_permission
  + leadership breadth state
  + weekly context intact
  + daily setup valid
  + trigger identified
  + structural stop / risk clarity
  + AURORA-X/X2/PX state clear

Output Buckets:
  TRADE_READY           = all gates pass + clear trigger
  TRIGGER_READY         = setup complete, waiting for trigger
  PILOT_ONLY            = transition market, tiny size only
  SELECTIVE_ONLY        = mixed breadth, only best names
  PULLBACK_WATCH        = pulled back to support, no trigger yet
  PEAD_WATCH            = post-earnings drift candidate
  BASE_BUILDING         = setup forming, not yet actionable
  RSNH_WATCH_ONLY       = RS new high but no market confirmation
  REPAIR_WATCH          = weekly broken, rebuilding
  NO_CHASE              = extended / PX risk
  PROTECT_PROFIT_REVIEW = X2 warning / extended leader
  AVOID_FRESH_LONG      = market cycle off / Stage 3-4
  WATCHLIST_ONLY        = market correction regime

Conflict Resolver Examples:
  Market off + perfect setup      → WATCHLIST_ONLY
  Weekly broken + daily bounce    → REPAIR_WATCH
  Weekly strong + daily extended  → wait for pullback
  Market on + cluster breakouts + trigger → TRADE_READY
  PX exhaustion + no structural break → PROTECT_PROFIT_REVIEW
  AURORA-X hard risk              → hard risk wins always
```

---

### LAYER 20 — Explainable Notes

```
Every output note must have these 5 parts:

  It means:         [plain English label explanation]
  Why it matters:   [why this affects trading decisions]
  What confirms it: [what would make this signal stronger]
  What invalidates: [what would negate this signal]
  What to watch:    [specific next action or observation]

Example — PULLBACK_CONFLUENCE_STRONG:
  It means: Price is pulling back into a zone where multiple support
            references overlap.
  Why it matters: Multiple support references improve entry quality
                  and allow tighter stops.
  What confirms it: Reversal bar, U&R, Oops, PEB, or volume-supported
                    reclaim at the confluence zone.
  What invalidates it: Heavy-volume break below the confluence zone.
  What to watch: Reversal trigger and next close quality.

Other note templates:
  MARKET_CYCLE_OFF / LEADERSHIP_CLUSTER_CONFIRMED
  WEEKLY_CONTEXT_FAIL / MA_CHARACTER_CHANGE
```

---

## OUTPUT FORMAT

### Main Scan Table

```
| Rank | Stock | Sector/Theme | RRG | RS vs Benchmark | RS vs Peers | RSNH? | AURORA Bucket | Setup Evidence | Price | Early Entry | Trigger | Pivot | Stop | Risk% | PX Risk | Verdict |
```

Column definitions:
```
Rank:           AURORA priority (market permission + leadership + setup + RS + risk)
RRG:            Leading / Improving / Weakening / Lagging / Unknown
RS vs Benchmark: Strong/Improving/Weak vs Nifty/SPY/TSX
RS vs Peers:    Top peer leader / Above median / Middle / Weak
RSNH?:          Yes / Near / No / Unknown
Setup Evidence: Keep compact — VCP / Pullback / Near 52W / PEAD / AVWAP
PX Risk:        NORMAL / MILD_EXTENSION / EXTENDED / PX_NO_CHASE / PX_HARD_WARNING
Verdict:        Buyable now / Trigger-ready / Wait / Watch / Hold / No chase
```

### Single Stock Compact Output:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AURORA VERDICT: [bucket]  |  SIG: [0-100]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Market:  [MC2 state] | [FTD if US] | [breadth label]
Sector:  [RRG quadrant] → [rotation phase] | RLT: [lag]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Stage:   [Weinstein stage + 2A/2B/2C + age]
RS:      [PASS/PARTIAL/FAIL] | 1M: [%] | 3M: [%] | Mansfield: [+/-]
Volume:  [VE label] | RVOL: [x] | UD Ratio: [x]
SEPA:    [HIGH/MEDIUM/LOW_CONVICTION]
Setup:   [base type + count] | [compression] | [pivot proximity]
AVWAP:   [hold/reclaim/loss + anchor type]
Quality: [Q label] | EPS: [trend] | Rev: [trend]
PX Risk: [extension label]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Entry trigger: [exact condition]
Early entry:   [support / reclaim area]
Stop:          [structural_stop] ([risk%] — [bucket])
T1: [1.5R]  |  T2: [3R]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Note: [plain English: it means / why matters / watch next]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Rotation Lead-Time Note (when data available):

```
Rotation Lead-Time:
- Sector phase: [e.g. Lagging → Improving]
- Rotation date: [date or UNKNOWN]
- RS cross lag:  [N days or PENDING]
- RSNH lag:      [N days or PENDING]
- Entry lag:     [N days or PENDING]
- Breakout lag:  [N days or BREAKOUT_PENDING]
- Sector confirmation: [N/10]
- Interpretation: [one sentence]
```

### Additional Setup Notes Format (for important names):

```
TICKER
Additional notes:
- RMV/VCP:
- RS / RSNH:
- MA / Pullback / AVWAP:
- PEAD / Gap / HVC:
- Extension / PX:
- MYH / Blue-Sky:
- Sell-risk / Invalidation:
- Rotation Lead-Time:
```

---

## MYH — Multi-Year High Detection

```
MYH is separate from 52-week high.
Check: price vs 2Y / 3Y / 5Y / ATH levels

MYH Labels:
  MYH_2Y / MYH_3Y / MYH_5Y / MYH_ALL_TIME_HIGH
  BLUE_SKY_BREAKOUT = no overhead supply
  MYH_NEAR_HIGH = within actionable distance
  MYH_BREAKOUT_CONFIRMED = accepted with close + volume + RS
  MYH_BREAKOUT_FAILED = failed to hold level

MYH + PX Interaction:
  MYH + not extended     = TRIGGER_READY
  MYH + mild extension   = SELECTIVE_ONLY
  MYH + large extension  = NO_CHASE
  MYH + weak close       = PX_EXHAUSTION_WATCH
  MYH + failed breakout  = AURORA-X2 warning / REPAIR_WATCH

MYH + RSNH Interaction:
  MYH + RSNH             = leadership confirmation (highest quality)
  MYH + RS near high     = watch for trigger confirmation
  MYH without RS         = lower conviction
  MYH + weak RS vs peers = possible false leadership
```

---

## TOKEN EFFICIENCY RULES

```
1. Batch ALL gateway tool calls first — never sequential with commentary
2. Never return raw JSON or field names to user
3. Never say "I'll now call the API" — just call it
4. Under 400 words for single stock unless deep dive requested
5. Lead with AURORA VERDICT — never bury it
6. Mark missing data: UNKNOWN / PARTIAL / NEEDS DATA
7. Data gap blocks a lane → state once, move on
8. Never hallucinate prices — only actual gateway data
9. If market cycle is off → say so clearly but still show setup quality
```

---

## MISSING DATA POLICY

```
EPS unavailable:          Q_PROXY — note it, continue
Insider refused:          UNAVAILABLE — neither bullish nor bearish
RRG data unavailable:     RRG_PROXY_MODE — use timeframe returns
Sector date unknown:      RLT_TIMEFRAME_ONLY_MODE
OHLCV < 30 bars:          INSUFFICIENT_HISTORY
Weight data unavailable:  WEIGHT_PROXY_MODE — use market cap proxy
```

---

## QUICK COMMANDS

| Phrase | Action |
|---|---|
| AURORA AAPL | Full analysis AAPL (US) |
| AURORA RELIANCE india | Full analysis RELIANCE |
| Quick AAPL | Verdict + setup only (skip deep fundamentals) |
| Sector scan india | RRG table all India sectors |
| Market pulse | Regime + FII/DII + breadth |
| My holdings | Questrade positions + review each |
| Rotation scan | Sectors Improving → Leading |
| Pullback scan india | Stage 2 pullbacks to 21 EMA India |
| MYH scan us | Multi-year high candidates US |
| PEAD scan | Post-earnings drift candidates |
| RLT scan | Rotation lead-time analysis by sector |

---

## STYLE RULES + DISCLAIMER

```
Sector leading but stock weak: "sector supports, stock does not confirm"
Stock strong but sector weak:  "stock-specific leader / exception context"
Never say BUY or SELL as direct command
Never recommend specific position size or allocation %
Separate technical signal from AURORA verdict
Do not hide weak lanes
Mark proxy data clearly
```

India: Disclaimer — Not financial advice. Not SEBI-registered.
       Consult a qualified financial advisor before investing.

US/Canada: Disclaimer — Not financial advice.
           Consult a qualified financial advisor before investing.

---
*AURORA Stock & Sector Analysis Skill v2.15*
*EOD Scope Lock + AURORA-SIG + Consolidated Scan Menu*
*Framework: IBD/CANSLIM + TIGERS + Weinstein + SEPA + RRG + RLT + MBC*
*Tools: aurora-gateway (35 tools, 3 markets)*
*20 analysis layers fully specified*
