# RS Trifecta — Multi-Timeframe Relative Strength Scanner
### IBD RS Rating · RS Line New High · Mansfield RS
*The single most powerful momentum filter in growth investing*

---

## Concept & Rationale

Three methods, one question: **Is this stock outperforming the market?**

```
IBD RS Rating   → 12-month weighted performance percentile  [STRUCTURAL — 1 year]
RS Line New High→ Stock/Benchmark ratio at new high         [CURRENT — daily momentum]
Mansfield RS    → Trend-adjusted outperformance vs index    [TREND — weekly timeframe]
```

Each measure has a different lookback, different smoothing, and different sensitivity:

| Measure | Timeframe | What it captures | False signal risk |
|---------|-----------|-----------------|-------------------|
| IBD RS Rating | 12 months (weighted, Q4=40%) | Sustained outperformance | Slow to react to new trends |
| RS Line New High | Daily, rolling 52W | Real-time leadership | Can spike on single volatile day |
| Mansfield RS | Weekly, 52W MA smoothed | Trend-quality outperformance | Lags RS Line; more reliable |

**When all three confirm simultaneously**, they are telling you the same story across three independent timeframes. This triple-confirmation is the market's most consistent signal that institutions are systematically buying a stock ahead of a major move.

---

## Mathematical Definitions

### Measure 1 — IBD RS Rating

```
Q4_ret = C_t / C_{t-63}  - 1          [Most recent 3 months, ≈63 trading days]
Q3_ret = C_{t-63}  / C_{t-126} - 1
Q2_ret = C_{t-126} / C_{t-189} - 1
Q1_ret = C_{t-189} / C_{t-252} - 1

Raw_RS = (2×Q4 + Q3 + Q2 + Q1) / 5   [Q4 double-weighted]

IBD_RS_Rating = Percentile_Rank(Raw_RS, Universe) × 98 + 1   → range: 1 to 99

Signal threshold:
  RS >= 80  → Strong (entry minimum for most scanners)
  RS >= 85  → Elite  (VCP, ATH, sector leader minimum)
  RS >= 90  → Top-tier (HTF, power leaders)
  RS >= 95  → Exceptional (1-in-20 stocks in universe)
```

### Measure 2 — RS Line New High

```
RS_Line_t = Close_stock_t / Close_benchmark_t

RS_Line_52W_High = max{ RS_Line_{t-252}, ..., RS_Line_{t-1} }   [Prior year, exclude today]

New_High = RS_Line_t > RS_Line_52W_High

Scenario classification:
  LEADING    : RS_Line New High AND price NOT at 52W high   → A+ (RS line ahead of price)
  CONFIRMING : RS_Line New High AND price AT 52W high       → A  (simultaneous)
  LAGGING    : RS_Line NOT at high but price IS             → B  (weak; divergence warning)
  DIVERGING  : Price declining; RS_Line declining faster    → AVOID
```

### Measure 3 — Mansfield RS

```
Mansfield_RS_t = [Close_t / SMA52W_stock_t] / [Index_t / SMA52W_index_t] - 1

Where SMA52W = 52-week (1-year) simple moving average on weekly data

Mansfield_RS > 0   → Stock outperforming index on trend-adjusted basis
Mansfield_RS < 0   → Underperforming

Signal conditions:
  MRS_t  > +0.05                            [Positively above zero with buffer]
  MRS_t  > MRS_{t-4}  (rising, 4-week lag)  [Trend improving]
  MRS_t  recently crossed above 0           [Zero-line breakout = strong entry signal]
```

---

## RS Trifecta Scanner Implementation

```python
import yfinance as yf
import pandas as pd
import numpy as np
from typing import Optional

# ── Core functions (reused from framework + Weinstein files) ──────────────

def compute_raw_rs(close: pd.Series) -> float:
    """IBD-approximation Raw RS score. Requires 252+ days."""
    if len(close) < 252:
        return np.nan
    p = close.values
    q4 = p[-1]   / p[-63]  - 1 if len(p) >= 63  else 0
    q3 = p[-63]  / p[-126] - 1 if len(p) >= 126 else 0
    q2 = p[-126] / p[-189] - 1 if len(p) >= 189 else 0
    q1 = p[-189] / p[-252] - 1 if len(p) >= 252 else 0
    return (2 * q4 + q3 + q2 + q1) / 5


def rs_line(stock_close: pd.Series, benchmark_close: pd.Series) -> pd.Series:
    """Daily RS Line = stock / benchmark."""
    bm = benchmark_close.reindex(stock_close.index, method='ffill')
    return stock_close / bm


def rs_line_analysis(rsl: pd.Series, stock_close: pd.Series,
                     lookback: int = 252) -> dict:
    """
    Full RS Line analysis: new high detection + scenario classification.
    rsl        : RS Line series (stock / benchmark)
    stock_close: stock daily close
    """
    if len(rsl) < lookback + 1:
        return {"new_high": False, "scenario": "INSUFFICIENT_DATA"}

    current_rsl  = rsl.iloc[-1]
    prior_rsl_max= rsl.iloc[-lookback:-1].max()
    new_high     = current_rsl > prior_rsl_max

    # Price new high check
    price_52w_hi = stock_close.iloc[-lookback:-1].max()
    price_new_hi = stock_close.iloc[-1] > price_52w_hi

    # RS Line slope (momentum within RS Line)
    rsl_slope_10d = (rsl.iloc[-1] - rsl.iloc[-11]) / rsl.iloc[-11] if rsl.iloc[-11] > 0 else 0

    if new_high and not price_new_hi:
        scenario = "LEADING"      # Strongest signal: RS line leads price
    elif new_high and price_new_hi:
        scenario = "CONFIRMING"   # Both confirming simultaneously
    elif not new_high and price_new_hi:
        scenario = "DIVERGING"    # Price breaking out but RS line lagging — caution
    else:
        scenario = "NEUTRAL"

    # Distance from RS Line 52W high (how far below its peak?)
    rs_distance = (current_rsl - prior_rsl_max) / prior_rsl_max

    return {
        "new_high"         : new_high,
        "scenario"         : scenario,
        "rs_line_value"    : current_rsl,
        "rs_distance_pct"  : round(rs_distance * 100, 2),   # Negative = below peak
        "rs_slope_10d"     : round(rsl_slope_10d * 100, 2),
        "grade"            : "A+" if scenario == "LEADING"    else
                             "A"  if scenario == "CONFIRMING" else
                             "B"  if scenario == "NEUTRAL"    else "WARN",
    }


def mansfield_rs_analysis(stock_weekly: pd.Series,
                           index_weekly: pd.Series,
                           period: int = 52) -> dict:
    """
    Full Mansfield RS analysis: value, trend, zero-line crossover.
    Use weekly close series for both inputs.
    """
    if len(stock_weekly) < period + 5 or len(index_weekly) < period + 5:
        return {"value": np.nan, "positive": False, "rising": False}

    sma_s   = stock_weekly.rolling(period).mean()
    sma_i   = index_weekly.rolling(period).mean()
    mrs     = (stock_weekly / sma_s) / (index_weekly / sma_i) - 1

    mrs_cur    = mrs.iloc[-1]
    mrs_4w_ago = mrs.iloc[-5]
    mrs_rising = mrs_cur > mrs_4w_ago

    # Zero-line crossover: was negative 4W ago, positive now
    zero_cross = (mrs_cur > 0) and (mrs_4w_ago <= 0)

    # Strength classification
    if mrs_cur > 0.15:   mrs_strength = "STRONG"
    elif mrs_cur > 0.05: mrs_strength = "POSITIVE"
    elif mrs_cur > 0:    mrs_strength = "WEAKLY_POSITIVE"
    elif mrs_cur > -0.05:mrs_strength = "NEUTRAL"
    else:                mrs_strength = "NEGATIVE"

    return {
        "value"        : round(mrs_cur, 4),
        "value_4w_ago" : round(mrs_4w_ago, 4),
        "positive"     : mrs_cur > 0.02,    # Buffer above zero
        "rising"       : mrs_rising,
        "zero_cross"   : zero_cross,
        "strength"     : mrs_strength,
        "grade"        : "A+" if (zero_cross and mrs_cur > 0.05)          else
                         "A"  if (mrs_cur > 0.05 and mrs_rising)          else
                         "B+" if (mrs_cur > 0.02 and mrs_rising)          else
                         "B"  if (mrs_cur > 0)                            else
                         "C"  if (mrs_cur > -0.05)                        else "D",
    }
```

---

## Full Trifecta Composite

```python
def rs_trifecta(ticker        : str,
                daily_df      : pd.DataFrame,
                benchmark_daily: pd.Series,
                ibd_rs_rating : float,
                # Thresholds
                rs_min        : float = 80.0,
                mrs_min       : float = 0.02) -> dict:
    """
    Complete RS Trifecta evaluation for a single stock.

    Grades:
      A+ → All 3 confirmed + RS Line LEADING (before price) + RS >= 85
      A  → All 3 confirmed + RS >= 80
      B+ → IBD RS >= 80 + RS Line new high (Mansfield not yet confirmed)
      B  → IBD RS >= 80 + Mansfield positive + rising (RS Line not at new high yet)
      C  → Only 1 of 3 confirmed (developing setup)
      D  → None confirmed (not a momentum leader)
    """
    close  = daily_df['Close']

    # ── Measure 1: IBD RS Rating ─────────────────────────────────────────────
    m1_ok    = ibd_rs_rating >= rs_min
    m1_elite = ibd_rs_rating >= 85

    # ── Measure 2: RS Line New High ──────────────────────────────────────────
    rsl = rs_line(close, benchmark_daily.reindex(close.index, method='ffill'))
    m2  = rs_line_analysis(rsl, close)
    m2_ok = m2["new_high"]

    # ── Measure 3: Mansfield RS (weekly) ────────────────────────────────────
    bm_weekly    = benchmark_daily.resample('W-FRI').last()
    stock_weekly = close.resample('W-FRI').last()
    idx_aligned  = bm_weekly.reindex(stock_weekly.index, method='ffill')
    m3           = mansfield_rs_analysis(stock_weekly, idx_aligned)
    m3_ok        = m3["positive"] and m3["rising"]

    # ── Trifecta scoring ─────────────────────────────────────────────────────
    measures_passed = sum([m1_ok, m2_ok, m3_ok])
    all_three       = m1_ok and m2_ok and m3_ok

    # Grade logic
    if   all_three and m2["scenario"] == "LEADING" and m1_elite: grade = "A+"
    elif all_three and ibd_rs_rating >= 80:                       grade = "A"
    elif m1_ok and m2_ok and not m3_ok:                          grade = "B+"
    elif m1_ok and m3_ok and not m2_ok:                          grade = "B"
    elif measures_passed == 1:                                    grade = "C"
    else:                                                         grade = "D"

    # ── Additional context ───────────────────────────────────────────────────
    # RS Line trend acceleration: slope of RS Line over 20 days
    rsl_accel = (rsl.iloc[-1] - rsl.iloc[-21]) / rsl.iloc[-21] if len(rsl) > 21 else 0

    # RS momentum: IBD RS trend (is rating improving?)
    # Proxy: compare Q4 return vs Q1 return — positive = accelerating
    if len(close) >= 252:
        q4_ret = close.iloc[-1]   / close.iloc[-63]  - 1
        q1_ret = close.iloc[-189] / close.iloc[-252] - 1
        rs_accelerating = q4_ret > q1_ret   # Recent quarter stronger than oldest
    else:
        rs_accelerating = False

    return {
        # Summary
        "ticker"          : ticker,
        "trifecta_signal" : all_three,
        "grade"           : grade,
        "measures_passed" : measures_passed,

        # Measure 1
        "ibd_rs_rating"   : ibd_rs_rating,
        "m1_pass"         : m1_ok,

        # Measure 2
        "rs_line_new_high": m2_ok,
        "rs_scenario"     : m2["scenario"],
        "rs_distance_pct" : m2["rs_distance_pct"],
        "rs_slope_10d"    : m2["rs_slope_10d"],
        "m2_grade"        : m2["grade"],
        "m2_pass"         : m2_ok,

        # Measure 3
        "mansfield_rs"    : m3["value"],
        "mansfield_strength": m3["strength"],
        "mansfield_rising": m3["rising"],
        "mansfield_zero_x": m3["zero_cross"],
        "m3_grade"        : m3["grade"],
        "m3_pass"         : m3_ok,

        # Bonus signals
        "rs_accelerating" : rs_accelerating,
        "rsl_accel_20d_pct": round(rsl_accel * 100, 2),

        # Action
        "action"          : "HIGH PRIORITY" if grade in ["A+", "A"] else
                            "WATCHLIST"     if grade in ["B+", "B"] else
                            "MONITOR"       if grade == "C"         else "SKIP",
    }
```

---

## Universe Scanner

```python
def run_rs_trifecta_universe(universe_data   : dict,
                              benchmark_daily : pd.Series,
                              rs_ratings      : pd.Series,
                              min_grade       : str = "B") -> pd.DataFrame:
    """
    Scans entire universe for RS Trifecta signals.

    universe_data : {ticker: daily_OHLCV_df}
    benchmark_daily: benchmark daily close aligned by date
    rs_ratings    : pd.Series of IBD RS Ratings indexed by ticker
    min_grade     : minimum grade to include in output ("A+","A","B+","B","C")
    """
    GRADE_ORDER = {"A+": 6, "A": 5, "B+": 4, "B": 3, "C": 2, "D": 1}
    min_rank    = GRADE_ORDER.get(min_grade, 3)

    results = []
    for ticker, df in universe_data.items():
        rs = float(rs_ratings.get(ticker, 50))
        try:
            result = rs_trifecta(ticker, df, benchmark_daily, rs)
            if GRADE_ORDER.get(result["grade"], 0) >= min_rank:
                results.append(result)
        except Exception as e:
            print(f"[WARN] {ticker}: {e}")

    if not results:
        return pd.DataFrame()

    df_out = pd.DataFrame(results)
    # Sort: grade descending, then IBD RS descending
    df_out["grade_rank"] = df_out["grade"].map(GRADE_ORDER)
    df_out = df_out.sort_values(["grade_rank", "ibd_rs_rating"], ascending=[False, False])
    df_out = df_out.drop(columns=["grade_rank"])

    return df_out.reset_index(drop=True)
```

---

## Trifecta Signal Interpretation Guide

### Grade A+ — RS Line LEADING + All Three Confirmed

```
What it means:
  The stock's RS Line is making a new 52-week high BEFORE the price makes a new high.
  This means the stock is outperforming the benchmark even on a day the price hasn't
  technically broken out yet. Institutions are buying relative to the market.
  This is William O'Neil's highest-conviction signal.

Historical context:
  Most of IBD's biggest winners showed RS Line new highs WEEKS before the price breakout.
  Example pattern: RS Line makes new high → stock forms 3WT or VCP → price breaks out.
  The A+ trifecta identifies the stock DURING that consolidation before the breakout.

What to do:
  → Add to priority watchlist immediately
  → Set price alert at nearest resistance/pivot level
  → Wait for breakout confirmation (S01/S10/S19 scanner)
  → Position size: full (highest conviction)
```

### Grade A — All Three Confirmed Simultaneously

```
What it means:
  Stock is outperforming on 12-month basis (IBD RS), outperforming right now
  (RS Line), and outperforming on trend-adjusted weekly basis (Mansfield).
  The market is voting with money across three independent timeframes.

What to do:
  → Buy on next constructive setup (pullback to SMA10W, VCP pivot, flat base break)
  → Don't chase if already extended > 10% above last base
  → Position size: full
```

### Grade B+ — IBD RS Strong + RS Line New High (Mansfield Lagging)

```
What it means:
  Structurally strong (12 months) and currently outperforming daily, but Mansfield's
  weekly trend-adjusted measure hasn't yet confirmed. This is COMMON early in a new
  leader's run — Mansfield RS lags by design (52W MA smoothing).

What to do:
  → Add to watchlist; check again in 2–4 weeks
  → If Mansfield crosses zero and starts rising → upgrades to Grade A
  → Treat as early-stage momentum — reduce position size vs Grade A
```

### Grade B — IBD RS Strong + Mansfield Positive (RS Line Not Yet at High)

```
What it means:
  Structural outperformance confirmed, weekly trend positive, but RS Line hasn't
  yet made a new high. Stock may be recovering from sector rotation or building
  a new base after a correction.

What to do:
  → Monitor for RS Line new high → that's the upgrade trigger to Grade A
  → Check if stock is in Stage 2 (Weinstein) — if yes, patience is warranted
  → Acceptable entry point if price pattern is constructive
```

---

## Multi-Timeframe RS Dashboard Logic

```python
def rs_trifecta_dashboard(ticker: str,
                           daily_df: pd.DataFrame,
                           benchmark_daily: pd.Series,
                           ibd_rs: float) -> str:
    """
    Human-readable dashboard summary for a single stock's RS profile.
    """
    result = rs_trifecta(ticker, daily_df, benchmark_daily, ibd_rs)

    lines = [
        f"{'='*50}",
        f"RS TRIFECTA REPORT: {ticker}",
        f"{'='*50}",
        f"OVERALL GRADE : {result['grade']}  |  ACTION: {result['action']}",
        f"{'─'*50}",
        f"M1 IBD RS Rating  : {result['ibd_rs_rating']:.0f}/99  {'✅' if result['m1_pass'] else '❌'}",
        f"   RS Accelerating: {'Yes ↑' if result['rs_accelerating'] else 'No  →'}",
        f"{'─'*50}",
        f"M2 RS Line        : {'NEW HIGH ✅' if result['rs_line_new_high'] else 'Below high ❌'}",
        f"   Scenario       : {result['rs_scenario']}",
        f"   Distance to 52W high: {result['rs_distance_pct']:+.1f}%",
        f"   RS Line 10D momentum: {result['rs_slope_10d']:+.1f}%",
        f"{'─'*50}",
        f"M3 Mansfield RS   : {result['mansfield_rs']:+.4f}  ({result['mansfield_strength']})",
        f"   Trend           : {'Rising ↑' if result['mansfield_rising'] else 'Falling ↓'}",
        f"   Zero-line cross : {'YES (fresh signal) ✅' if result['mansfield_zero_x'] else 'No'}",
        f"{'─'*50}",
        f"Measures passed   : {result['measures_passed']}/3",
        f"{'='*50}",
    ]
    return '\n'.join(lines)
```

---

## Trifecta Guardrails

```
✅ REQUIRE:
  - Market regime = BULL or NEUTRAL (don't buy RS leaders in bear markets;
    even the strongest stocks get sold in bear markets)
  - IBD RS >= 80 at minimum (Grade D stocks = laggards, no trifecta signal matters)
  - Mansfield RS: use weekly data aligned to benchmark (mismatch = garbage output)
  - Universe size: RS Rating is only meaningful vs a universe of 100+ stocks
    (ranking 10 stocks 1-99 is meaningless)

❌ REJECT if:
  - RS Line new high on tiny volume (single illiquid day can spike RS line)
    → Require avg_vol >= minimum before treating RS Line signal as valid
  - Mansfield RS positive but stock below SMA30W (Weinstein Stage 3/4) →
    RS is holding up only because the index fell faster; stock still deteriorating
  - IBD RS >= 85 but stock is 30%+ below 52W high → high RS from prior year's
    gain, not current strength. Check RS Line for confirmation.
  - All three confirmed but stock extended > 15% above last base → wait for
    pullback; trifecta on extended stocks = high-risk entry

⚠️ WATCH:
  - Grade A+ stocks in bear market = still decline. Regime filter is hard gate.
  - RS divergence (price new high, RS Line NOT new high) is a SELL signal,
    not a buy. A declining RS Line during a price breakout = distribution.
  - Mansfield RS zero-line crossover is the highest-value entry timing signal —
    set an alert specifically for this transition.
  - For India: compute RS Rating vs Nifty 500 (^CNX500) not Nifty 50 —
    many mid/small caps will show false RS against a large-cap only index.
```

---

## India / US / Canada Benchmark Reference

| Market | RS Rating Benchmark | RS Line Benchmark | Mansfield Benchmark |
|--------|--------------------|--------------------|---------------------|
| India (large cap) | ^CNX500 | ^CNX500 | ^CNX500 |
| India (mid cap) | ^CNXMID | ^CNXMID | ^CNXMID |
| India (small cap) | ^CNXSC | ^CNXSC | ^CNXSC |
| US | SPY or ^GSPC | SPY | SPY |
| Canada | ^GSPTSE | ^GSPTSE | ^GSPTSE |

**Key rule:** Use the SAME benchmark across all three measures for a given stock. 
Mixing benchmarks (e.g. RS Rating vs Nifty 500, Mansfield vs Nifty 50) introduces 
systematic error in the comparison.

---

*Cross-reference: scanner_logic_framework.md (S22 RS Line, IBD RS Rating Section 3.1)*
*weinstein_stage_analysis.md (Mansfield RS) | scanner_guardrails.md*
