# Stan Weinstein Stage Analysis Scanner
### Detecting Stage 1 → Stage 2 Transition — The Highest Probability Entry Point
*"Secrets for Profiting in Bull and Bear Markets" — Stan Weinstein (1988)*

---

## The Four Stages

Weinstein's framework divides every stock's lifecycle into four stages. The entire edge 
of this system is **buying at Stage 1→2 transition** and holding through Stage 2.

```
STAGE 1 — BASING AREA
  Price: Flat; oscillating around 30-week MA
  30W MA: Flat or beginning to turn up
  Volume: Lower than during prior downtrend; drying up
  Investor profile: Accumulation by early smart money; most investors ignoring stock
  Mansfield RS: Negative but improving toward zero

STAGE 2 — ADVANCING PHASE  ← BUY ZONE
  Price: Above 30-week MA; making higher highs and higher lows
  30W MA: Rising consistently
  Volume: Expands on up moves; contracts on pullbacks
  Investor profile: Institutional accumulation; public gradually enters
  Mansfield RS: Positive and rising
  Entry: Breakout from Stage 1 base above 30W MA on expanding volume

STAGE 3 — TOPPING AREA    ← SELL ZONE
  Price: Oscillating around 30W MA again; lower highs forming
  30W MA: Flattening; beginning to turn down
  Volume: Often high but erratic (distribution)
  Mansfield RS: Declining below zero
  Action: Exit all longs; don't buy "dips"

STAGE 4 — DECLINING PHASE  ← AVOID
  Price: Below 30W MA; making lower lows
  30W MA: Declining
  Volume: High on down moves
  Mansfield RS: Deeply negative
  Action: Short or completely avoid
```

---

## Core Metrics

### 30-Week Moving Average (Weinstein's Primary Indicator)

```
On WEEKLY data:
  SMA30W(w) = (1/30) × Σ Close(w-i) for i=0..29

On DAILY data (equivalent approximation):
  SMA150D  = (1/150) × Σ Close(t-i) for i=0..149
  Note: 30 weeks × 5 trading days = 150 days
  Prefer weekly resampling for fidelity to Weinstein's original work.

30W MA Slope:
  Slope(w) = SMA30W(w) - SMA30W(w-1)         [Weekly slope]
  Slope_4W(w) = (SMA30W(w) - SMA30W(w-4)) / SMA30W(w-4)  [4-week rate of change]

MA Flat (Stage 1/3): |Slope_4W| < 0.02   [< 2% change over 4 weeks]
MA Rising (Stage 2): Slope_4W > 0.01     [Rising at least 1% over 4 weeks]
MA Declining (Stage 4): Slope_4W < -0.01
```

### Mansfield Relative Strength (Weinstein's RS Indicator)

```
Mansfield_RS(w) = [Close(w) / SMA52W_stock(w)] / [Index(w) / SMA52W_index(w)] - 1

Where SMA52W = 52-week (1-year) simple moving average

Mansfield_RS > 0  → stock outperforming index on a trend-adjusted basis
Mansfield_RS < 0  → underperforming

Stage 1→2 transition signal:
  Mansfield_RS crosses from negative to positive (zero-line crossover)
  OR Mansfield_RS > 0 and rising
```

---

## Stage Classification Engine

```python
import yfinance as yf
import pandas as pd
import numpy as np

def resample_weekly(df: pd.DataFrame) -> pd.DataFrame:
    """Convert daily OHLCV to weekly (Weinstein uses weekly charts)."""
    return df.resample('W-FRI').agg({
        'Open'  : 'first',
        'High'  : 'max',
        'Low'   : 'min',
        'Close' : 'last',
        'Volume': 'sum',
    }).dropna()


def mansfield_rs(stock_weekly: pd.Series,
                 index_weekly: pd.Series,
                 period: int = 52) -> pd.Series:
    """
    Mansfield Relative Strength. Weekly data.
    Positive = outperforming; Negative = underperforming.
    """
    sma_s = stock_weekly.rolling(period).mean()
    sma_i = index_weekly.rolling(period).mean()
    return (stock_weekly / sma_s) / (index_weekly / sma_i) - 1


def classify_weinstein_stage(weekly_df: pd.DataFrame,
                              index_weekly: pd.Series) -> dict:
    """
    Full stage classification for a single stock.
    weekly_df: OHLCV weekly DataFrame
    index_weekly: benchmark weekly close (Nifty 500 / SPY / TSX)
    """
    if len(weekly_df) < 52:
        return {"stage": "UNKNOWN", "reason": "Insufficient history (< 52 weeks)"}

    close  = weekly_df['Close']
    volume = weekly_df['Volume']

    # ── 30-Week MA ──────────────────────────────────────────────────────────
    sma30      = close.rolling(30).mean()
    sma30_cur  = sma30.iloc[-1]
    sma30_4w   = sma30.iloc[-5]              # 4 weeks ago

    slope_4w   = (sma30_cur - sma30_4w) / sma30_4w if sma30_4w > 0 else 0
    ma_flat    = abs(slope_4w) < 0.02
    ma_rising  = slope_4w > 0.01
    ma_falling = slope_4w < -0.01

    # ── Price vs SMA30W ─────────────────────────────────────────────────────
    price_cur      = close.iloc[-1]
    above_ma       = price_cur > sma30_cur
    price_vs_ma    = (price_cur - sma30_cur) / sma30_cur    # % above/below MA

    # How many of last 12 weeks above/below SMA30?
    last12_above   = (close.iloc[-12:] > sma30.iloc[-12:]).sum()
    last12_below   = 12 - last12_above

    # ── Volume analysis ─────────────────────────────────────────────────────
    avg_vol_10w    = volume.iloc[-10:].mean()
    avg_vol_30w    = volume.iloc[-30:].mean()
    vol_expanding  = avg_vol_10w > avg_vol_30w * 1.10
    vol_contracting= avg_vol_10w < avg_vol_30w * 0.90

    # ── Mansfield RS ────────────────────────────────────────────────────────
    idx_aligned   = index_weekly.reindex(close.index, method='ffill')
    mrs           = mansfield_rs(close, idx_aligned)
    mrs_cur       = mrs.iloc[-1]
    mrs_prev      = mrs.iloc[-4]              # 4 weeks ago
    mrs_rising    = mrs_cur > mrs_prev
    mrs_positive  = mrs_cur > 0

    # ── Higher Highs / Higher Lows (Stage 2 character) ──────────────────────
    recent_highs  = weekly_df['High'].iloc[-8:]
    recent_lows   = weekly_df['Low'].iloc[-8:]
    hh_hl         = (recent_highs.iloc[-1] > recent_highs.mean() and
                     recent_lows.iloc[-1]  > recent_lows.mean())

    # ── Stage Determination ─────────────────────────────────────────────────
    # Weinstein's criteria (simplified scoring):
    s2_score = sum([
        above_ma,          # Price above 30W MA
        ma_rising,         # MA rising
        vol_expanding,     # Volume expanding
        mrs_positive,      # Mansfield RS positive
        mrs_rising,        # RS improving
        hh_hl,             # Making HH/HL
    ])

    s4_score = sum([
        not above_ma,
        ma_falling,
        not mrs_positive,
    ])

    if s2_score >= 4 and ma_rising:
        stage = "STAGE_2"
    elif s4_score >= 3 and ma_falling:
        stage = "STAGE_4"
    elif ma_flat and last12_above >= 4 and last12_below >= 4:
        # Oscillating around flat MA
        if close.iloc[-1] >= close.rolling(52).mean().iloc[-1]:
            stage = "STAGE_1"    # Basing at higher level (post-downtrend)
        else:
            stage = "STAGE_3"    # Topping at lower level (post-uptrend)
    elif above_ma and ma_rising and s2_score >= 3:
        stage = "STAGE_2_EARLY"
    elif not above_ma and ma_flat:
        stage = "STAGE_1_LATE"   # About to transition
    else:
        stage = "TRANSITION"

    return {
        "stage"          : stage,
        "sma30w"         : round(sma30_cur, 2),
        "price_vs_ma_pct": round(price_vs_ma * 100, 2),
        "slope_4w_pct"   : round(slope_4w * 100, 2),
        "ma_flat"        : ma_flat,
        "ma_rising"      : ma_rising,
        "above_ma"       : above_ma,
        "vol_expanding"  : vol_expanding,
        "mansfield_rs"   : round(mrs_cur, 4),
        "mrs_positive"   : mrs_positive,
        "mrs_rising"     : mrs_rising,
        "hh_hl"          : hh_hl,
        "s2_score"       : s2_score,        # 0–6, higher = stronger Stage 2
    }
```

---

## Stage 1 → Stage 2 Transition Scanner (The Entry Signal)

This is the primary money-making scanner in Weinstein's system.

### Mathematical Conditions for Stage 1 → Stage 2

```
Stage 1→2 Transition = ALL of the following on WEEKLY timeframe:

Required (must have all):
  (1) Stock was in Stage 1 for ≥ 12 weeks
      → SMA30W flat: |Slope_4W| < 0.02 for 12+ weeks
      → Price oscillating within ±15% of SMA30W

  (2) THIS WEEK: Close crosses above SMA30W
      → Close(w) > SMA30W(w)  AND  Close(w-1) ≤ SMA30W(w-1)
      → OR: Close(w) > SMA30W(w) by > 1% after multiple weeks of oscillation

  (3) SMA30W slope turning positive
      → SMA30W(w) > SMA30W(w-1)   [MA itself beginning to rise]

  (4) Volume on breakout week ≥ 1.3× 10-week average volume
      → Weinstein emphasizes volume expansion is non-negotiable

Preferred (significantly improve odds):
  (5) Mansfield RS crossing from negative to positive
      → MRS(w) > 0  AND  MRS(w-4) < 0
  (6) Prior Stage 1 base: stock was BELOW 30W MA for ≥ 8 of prior 12 weeks
      → Confirms genuine basing, not just noise
  (7) Stage 1 duration ≥ 16 weeks → "Longer the base, greater the move"
  (8) Volume during Stage 1 base was declining (quiet accumulation)
```

```python
def scan_stage1_to_stage2(daily_df: pd.DataFrame,
                           index_close: pd.Series,
                           min_stage1_weeks: int = 12,
                           vol_multiplier: float = 1.30) -> dict:
    """
    Detects Stage 1 → Stage 2 transition.
    daily_df: Daily OHLCV
    index_close: Benchmark daily close (aligned)
    """
    # Resample to weekly
    weekly     = resample_weekly(daily_df)
    idx_weekly = index_close.resample('W-FRI').last().reindex(weekly.index, method='ffill')

    if len(weekly) < 52:
        return {"signal": False, "reason": "< 52 weeks history"}

    close  = weekly['Close']
    volume = weekly['Volume']
    sma30  = close.rolling(30).mean()

    # ── Check THIS WEEK's cross above SMA30W ────────────────────────────────
    cross_above = (close.iloc[-1]  > sma30.iloc[-1] and
                   close.iloc[-2] <= sma30.iloc[-2])

    if not cross_above:
        # Allow: already above but just barely / recent cross within 2 weeks
        recent_cross = any(
            close.iloc[-i] > sma30.iloc[-i] and close.iloc[-i-1] <= sma30.iloc[-i-1]
            for i in range(1, 3)
        )
        if not recent_cross:
            return {"signal": False, "reason": "No SMA30W crossover in past 2 weeks"}

    # ── SMA30W slope turning positive ────────────────────────────────────────
    ma_slope_positive = sma30.iloc[-1] > sma30.iloc[-2]

    # ── Volume confirmation ──────────────────────────────────────────────────
    vol_breakout_week = volume.iloc[-1]
    avg_vol_10w       = volume.iloc[-11:-1].mean()
    vol_ok            = vol_breakout_week >= vol_multiplier * avg_vol_10w

    # ── Stage 1 duration check: was stock basing for ≥ min_stage1_weeks? ────
    # Look back min_stage1_weeks + buffer; count weeks price oscillated around SMA30
    lookback = min_stage1_weeks + 8

    if len(close) < lookback + 5:
        return {"signal": False, "reason": f"Insufficient history for {min_stage1_weeks}W Stage 1 check"}

    # Stage 1 window: period BEFORE the breakout week
    s1_window_close = close.iloc[-lookback-1:-1]
    s1_window_sma   = sma30.iloc[-lookback-1:-1]
    s1_window_vol   = volume.iloc[-lookback-1:-1]

    # Count weeks above/below SMA30 in Stage 1 window
    weeks_above = (s1_window_close > s1_window_sma).sum()
    weeks_below = (s1_window_close <= s1_window_sma).sum()

    # Genuine Stage 1: oscillating (both above and below), not trending
    genuinely_basing = (weeks_above >= 3 and weeks_below >= min_stage1_weeks * 0.5)

    # SMA30 was flat during Stage 1 window
    s1_sma_start = s1_window_sma.iloc[0]
    s1_sma_end   = s1_window_sma.iloc[-1]
    s1_ma_flat   = abs(s1_sma_end - s1_sma_start) / s1_sma_start < 0.05  # < 5% change

    # Volume declining during Stage 1 (quiet accumulation)
    s1_vol_first_half = s1_window_vol.iloc[:len(s1_window_vol)//2].mean()
    s1_vol_second_half= s1_window_vol.iloc[len(s1_window_vol)//2:].mean()
    s1_vol_quiet      = s1_vol_second_half < s1_vol_first_half   # Volume dried up

    stage1_valid = genuinely_basing and s1_ma_flat

    # ── Mansfield RS ─────────────────────────────────────────────────────────
    mrs = mansfield_rs(close, idx_weekly)
    mrs_cur      = mrs.iloc[-1]
    mrs_4w_ago   = mrs.iloc[-5]
    mrs_crossing = mrs_cur > 0 and mrs_4w_ago <= 0    # RS zero-line crossover

    # ── Stage 1 base width (price range) ────────────────────────────────────
    base_high    = s1_window_close.max()
    base_low_s1  = weekly['Low'].iloc[-lookback-1:-1].min()
    base_width   = (base_high - base_low_s1) / base_high

    # ── Overall signal ───────────────────────────────────────────────────────
    core_signal  = cross_above and ma_slope_positive and vol_ok and stage1_valid

    # Grade
    confirmations = sum([mrs_crossing, s1_vol_quiet, base_width >= 0.15,
                         weeks_below >= min_stage1_weeks * 0.60,
                         vol_breakout_week >= 1.5 * avg_vol_10w])
    grade = "A+" if (core_signal and confirmations >= 4)  else \
            "A"  if (core_signal and confirmations >= 3)  else \
            "B+" if (core_signal and confirmations >= 2)  else \
            "B"  if core_signal                           else "SETUP"

    return {
        "signal"             : core_signal,
        "grade"              : grade,
        "cross_above_sma30w" : cross_above,
        "ma_slope_positive"  : ma_slope_positive,
        "vol_ok"             : vol_ok,
        "vol_ratio"          : round(vol_breakout_week / avg_vol_10w, 2),
        "stage1_weeks_basing": lookback,
        "stage1_valid"       : stage1_valid,
        "stage1_ma_flat"     : s1_ma_flat,
        "stage1_vol_quiet"   : s1_vol_quiet,
        "mansfield_rs"       : round(mrs_cur, 4),
        "mrs_crossing_zero"  : mrs_crossing,
        "base_width_pct"     : round(base_width * 100, 1),
        "sma30w"             : round(sma30.iloc[-1], 2),
        "confirmations"      : confirmations,
        "stop_loss"          : round(sma30.iloc[-1] * 0.97, 2),  # Just below SMA30W
        "note"               : "Stop: weekly close below SMA30W = Stage 2 failed",
    }
```

---

## Stage 2 Continuation Scanner

Stocks already in Stage 2 — identify best buy points within the advancing phase.

```python
def scan_stage2_continuation(daily_df: pd.DataFrame,
                               index_close: pd.Series) -> dict:
    """
    Finds best entry within an established Stage 2 uptrend.
    Ideal: Stage 2 stock that pulls back to 10-week MA (SMA10W) on low volume.
    """
    weekly = resample_weekly(daily_df)
    close  = weekly['Close']
    volume = weekly['Volume']

    stage = classify_weinstein_stage(weekly, index_close.resample('W-FRI').last())

    if stage["stage"] not in ["STAGE_2", "STAGE_2_EARLY"]:
        return {"signal": False, "reason": f"Not in Stage 2: {stage['stage']}"}

    sma10w = close.rolling(10).mean()
    sma30w = close.rolling(30).mean()

    # Pullback to 10-week MA on low volume (ideal Stage 2 entry)
    price_near_10w   = abs(close.iloc[-1] - sma10w.iloc[-1]) / sma10w.iloc[-1] < 0.03
    vol_this_week    = volume.iloc[-1]
    avg_vol_10w      = volume.iloc[-11:-1].mean()
    low_vol_pullback = vol_this_week < avg_vol_10w * 0.80    # Volume < 80% of avg

    # Still above SMA30W (Stage 2 not broken)
    above_sma30      = close.iloc[-1] > sma30w.iloc[-1]

    # Not too extended from SMA30W
    extension        = (close.iloc[-1] - sma30w.iloc[-1]) / sma30w.iloc[-1]
    not_extended     = extension < 0.25    # Less than 25% above SMA30W

    return {
        "signal"          : price_near_10w and low_vol_pullback and above_sma30 and not_extended,
        "stage"           : stage["stage"],
        "sma10w"          : round(sma10w.iloc[-1], 2),
        "sma30w"          : round(sma30w.iloc[-1], 2),
        "price_near_10w"  : price_near_10w,
        "low_vol_pullback": low_vol_pullback,
        "extension_pct"   : round(extension * 100, 1),
        "stop_loss"        : round(sma30w.iloc[-1], 2),   # Stop = SMA30W
        "entry_type"       : "Pullback to 10W MA" if price_near_10w else "N/A",
    }
```

---

## Full Weinstein Universe Scanner

```python
def run_weinstein_scanner(universe_tickers: list,
                           market: str = "india",
                           find_transition: bool = True,
                           find_stage2: bool = True) -> dict:
    """
    Scans entire universe for Stage 1→2 transitions and Stage 2 stocks.
    """
    benchmark_map = {
        "india" : ("^CNX500", ".NS"),
        "us"    : ("SPY",     ""),
        "canada": ("^GSPTSE", ".TO"),
    }
    bm_sym, suffix = benchmark_map.get(market, ("^CNX500", ".NS"))
    bm_daily = yf.download(bm_sym, period="3y", auto_adjust=True,
                            progress=False)['Close']

    transitions = []
    stage2_buys = []
    stage_map   = {}

    for ticker in universe_tickers:
        sym = ticker + suffix
        df  = yf.download(sym, period="3y", auto_adjust=True,
                           progress=False, multi_level_column=False)
        df  = df[['Open','High','Low','Close','Volume']].dropna()

        if len(df) < 300:
            continue

        weekly = resample_weekly(df)
        idx_w  = bm_daily.resample('W-FRI').last().reindex(weekly.index, method='ffill')

        # Classify stage
        stage_info = classify_weinstein_stage(weekly, idx_w)
        stage_map[ticker] = stage_info["stage"]

        # Transition scanner
        if find_transition:
            t_result = scan_stage1_to_stage2(df, bm_daily)
            if t_result.get("signal"):
                transitions.append({"ticker": ticker, **t_result})

        # Stage 2 continuation
        if find_stage2:
            s2_result = scan_stage2_continuation(df, bm_daily)
            if s2_result.get("signal"):
                stage2_buys.append({"ticker": ticker, **s2_result})

    # Stage distribution summary
    from collections import Counter
    stage_dist = Counter(stage_map.values())

    return {
        "transitions"  : pd.DataFrame(transitions).sort_values("grade") if transitions else pd.DataFrame(),
        "stage2_buys"  : pd.DataFrame(stage2_buys) if stage2_buys else pd.DataFrame(),
        "stage_summary": dict(stage_dist),
        "total_scanned": len(stage_map),
        "note"         : f"Stage distribution: {dict(stage_dist)}",
    }
```

---

## Weinstein Stage Guardrails

```
STAGE 1 → STAGE 2 TRANSITION:
  ✅ REQUIRE:
    - Stage 1 base minimum 12 weeks (Weinstein prefers 16–26 weeks)
    - Volume on breakout week: minimum 1.3x avg (Weinstein says this is non-negotiable)
    - SMA30W must begin rising — price above a declining MA is NOT Stage 2
    - Mansfield RS should be positive or crossing zero
    - Stock should have a reason for Stage 1 (prior downtrend, sector rotation out)

  ❌ REJECT if:
    - SMA30W still declining on breakout — this is a dead-cat bounce in Stage 4
    - Volume is average or below on breakout (no institutional conviction)
    - Price crossed above SMA30W but only briefly (< 1 week hold) — wait for confirmation
    - Mansfield RS is deeply negative (< -0.20) — sector laggard, avoid
    - Stock broke below its Stage 1 base low at any point — base is compromised

  ⚠️ WATCH:
    - "Failed Stage 2" breakouts happen when market turns bear mid-transition
    - Always apply market regime filter: only buy Stage 1→2 in BULL or NEUTRAL regime
    - "Wide and loose" Stage 1 base (volatile) = higher failure rate vs tight/quiet base
    - India small-caps: many stocks show false Stage 2 due to circuit-driven price action

STAGE 2 CONTINUATION (PULLBACK TO 10W MA):
  ✅ REQUIRE:
    - Stock has been in confirmed Stage 2 for at least 8 weeks
    - Pullback is orderly (low volume) not panicky (high volume)
    - Price holds above SMA30W during pullback

  ❌ REJECT if:
    - Price closes below SMA30W on weekly basis → Stage 2 may be ending
    - Pullback accompanied by high volume → distribution, not healthy correction
    - Mansfield RS turning negative during pullback → relative strength deteriorating

STOP LOSS RULE (Non-negotiable per Weinstein):
  - Exit if stock closes BELOW SMA30W on weekly basis
  - No exceptions, no "it'll bounce" — the stage is broken
```

---

## India Context

```
Benchmark for India Weinstein scan: ^CNX500 (Nifty 500 — broadest)
Weekly data: yfinance provides weekly candles (period="3y", interval="1wk")

India-specific notes:
  - Many PSU stocks spend long periods in Stage 1 → explosive Stage 2 when triggered
    (policy catalyst / govt order / earnings inflection)
  - F&O stocks preferred: their Stage 2 patterns are cleaner (no circuit distortions)
  - Small-cap non-F&O: Stage 1→2 breakouts must be verified with delivery volume
    (genuine Stage 2 = delivery % > 50% on breakout week)
  - Nifty Midcap 150 stocks historically show the clearest Weinstein stages
    (large caps are always in some form of Stage 2; small caps too volatile)

Fetching weekly data directly:
  df_weekly = yf.download("RELIANCE.NS", period="3y",
                           interval="1wk", auto_adjust=True, progress=False)
```

---

*Cross-reference: scanner_logic_framework.md | vcp_volatility_scanner.md | scanner_guardrails.md*
