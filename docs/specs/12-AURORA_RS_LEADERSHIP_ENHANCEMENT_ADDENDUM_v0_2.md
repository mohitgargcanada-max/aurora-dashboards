# AURORA RS Leadership Enhancement Addendum v0.2

**Target master:** AURORA v2.18.3 candidate  
**Base:** AURORA v2.18.2  
**Status:** Controlling addendum pending master consolidation  
**Scope:** RS Trifecta, RS21 timing, IBD-style RS Rating, RS 1W/1M/3M, Mansfield RS, Stock RRG/RLT and leadership lifecycle

---

## 1. Controlling Decision

The RS Trifecta remains a required core AURORA calculation and confirmation
layer. This addendum does not remove, weaken, rename or replace it.

The enhancement adds earlier and more granular leadership evidence:

1. RS 1W, RS 1M and RS 3M relative-return horizons.
2. RS line versus EMA21 timing and reclaim states.
3. IBD-style 1-99 universe percentile and rating trend.
4. Stock RRG quadrant, transition and tail direction.
5. A combined leadership lifecycle.

The new layers improve discovery of stocks moving toward leadership before all
Trifecta conditions align. Trifecta remains visible on every candidate and
retains its confirmation and conviction role.

---

## 2. Separation of RS Measures

| Measure | Primary question | Horizon | Output |
|---|---|---:|---|
| RS 1W | Is short-term relative demand appearing? | 5 sessions | relative return + percentile |
| RS 1M | Is tactical leadership developing? | 21 sessions | relative return + percentile |
| RS 3M | Is intermediate leadership established? | 63 sessions | relative return + percentile |
| RS21 | Is the daily RS line reclaiming or holding trend? | 21-session EMA | state + reclaim age |
| IBD-style RS Rating | Where does the stock rank structurally? | weighted 12 months | 1-99 rating + trend |
| Stock RRG | Is leadership rotating toward or away from the stock? | 52W ratio/26W momentum | quadrant + transition |
| Mansfield RS | Is long-term benchmark outperformance positive and rising? | weekly 52W | value + direction |
| RS Trifecta | Are key RS conditions agreeing? | multi-condition | PASS/PARTIAL/FAIL |

None of these fields may be labelled RSI.

---

## 3. Data and Benchmark Contract

For one stock, every RS calculation must use the same locked benchmark mapping,
provider, adjustment basis and completed-session alignment.

```text
rs_line[t] = stock_close[t] / benchmark_close[t]
```

Required controls:

```text
dates unique and ascending
stock and benchmark aligned on completed sessions
no provider blending within a series
benchmark recorded per stock
provider, endpoint, data date, currency and adjustment status retained
```

Missing or invalid aligned history produces `RS_DATA_REPAIR`, never a zero score.

---

## 4. RS 1W, RS 1M and RS 3M

### 4.1 Relative Return Formula

For horizon `h` in `{5, 21, 63}` completed sessions:

```python
stock_return_h = stock_close[t] / stock_close[t-h] - 1
benchmark_return_h = benchmark_close[t] / benchmark_close[t-h] - 1

rs_relative_return_h = (
    (1 + stock_return_h) / (1 + benchmark_return_h) - 1
) * 100
```

Fields:

```text
rs_1w_relative_return_pct  # h=5
rs_1m_relative_return_pct  # h=21
rs_3m_relative_return_pct  # h=63
```

### 4.2 Horizon Percentiles

Raw percentages across different horizons must not be compared directly.
Calculate a same-date universe percentile independently for each horizon:

```python
rs_1w_percentile = percentile_rank(rs_1w_relative_return_pct, universe_1w)
rs_1m_percentile = percentile_rank(rs_1m_relative_return_pct, universe_1m)
rs_3m_percentile = percentile_rank(rs_3m_relative_return_pct, universe_3m)
```

Store percentiles as 1-99 using deterministic midrank handling for ties.
Display each denominator.

### 4.3 Horizon Alignment

```text
RS_HORIZON_3_OF_3:
  RS 1W > 0, RS 1M > 0 and RS 3M > 0

RS_HORIZON_2_OF_3:
  any two horizons > 0

RS_HORIZON_1_OF_3:
  only one horizon > 0

RS_HORIZON_0_OF_3:
  no horizon > 0
```

### 4.4 Acceleration and Fading

Use percentile ranks for cross-horizon comparison:

```text
RS_HORIZON_ACCELERATING:
  rs_1w_percentile > rs_1m_percentile > rs_3m_percentile

RS_HORIZON_BROADENING:
  rs_3m_percentile >= 70
  and rs_1m_percentile >= 70
  and rs_1w_percentile >= 70

RS_HORIZON_EARLY_TURN:
  rs_1w_percentile >= 70
  and rs_1m_percentile > rs_3m_percentile
  and rs_3m_percentile < 70

RS_HORIZON_FADING:
  rs_3m_percentile >= 70
  and rs_1m_percentile < rs_3m_percentile
  and rs_1w_percentile < rs_1m_percentile

RS_HORIZON_MIXED:
  none of the above
```

These states diagnose leadership progression. They do not independently create
an entry.

---

## 5. IBD-Style RS Rating

### 5.1 Weighted Raw Score

For at least 252 completed sessions:

```python
q4 = close[t]     / close[t-63]  - 1
q3 = close[t-63]  / close[t-126] - 1
q2 = close[t-126] / close[t-189] - 1
q1 = close[t-189] / close[t-252] - 1

raw_rs = (2*q4 + q3 + q2 + q1) / 5
```

This is an AURORA approximation of the IBD concept, not a claimed reproduction
of a proprietary IBD rating.

### 5.2 Universe Rating

Calculate across the complete valid eligible universe on the same date:

```python
percentile = midrank(raw_rs, valid_universe_raw_rs)
ibd_rs_rating_1_99 = clamp(round(1 + 98*percentile), 1, 99)
```

Never calculate this rating from only the Weekly Universe, Near Watchlist,
sector subset or user watchlist.

### 5.3 Rating Trend

Persist daily rating history:

```text
ibd_rs_rating_1_99
ibd_rs_delta_5d
ibd_rs_delta_20d
ibd_rs_percentile_denominator
```

States:

```text
RS_RATING_ACCELERATING = delta_20d >= +10
RS_RATING_RISING       = +5 <= delta_20d < +10
RS_RATING_IMPROVING    = 0 < delta_20d < +5
RS_RATING_FLAT         = delta_20d == 0
RS_RATING_FADING       = delta_20d < 0
```

---

## 6. RS Line and EMA21 Timing

```python
rs_ema21 = EMA(rs_line, 21)
rs_slope_5d = (rs_line[t] / rs_line[t-5] - 1) * 100
rs_ema21_distance_pct = (rs_line[t] / rs_ema21[t] - 1) * 100
```

A valid reclaim:

```python
rs_line[t] > rs_ema21[t]
and rs_line[t-1] <= rs_ema21[t-1]
```

States:

```text
RS21_BELOW
RS21_APPROACHING        # below EMA21 but within 1.5%
RS21_RECLAIM_0_2D
RS21_RECLAIM_3_5D
RS21_HOLD_ABOVE         # above for at least 3 sessions
RS21_ACCELERATING       # hold above + positive slope5 + rising EMA21
RS21_BREAK_WARNING
```

Persist reclaim date and completed-session age.

---

## 7. RS Trifecta Preservation

The v2.18.2 Trifecta remains unchanged and must be calculated for every valid
candidate:

```text
c1 = rs_line > rs_ema21
c2 = rs_line at/new 63-session RS high
c3 = rs_slope_5d > 0

PASS    = 3/3
PARTIAL = 2/3
FAIL    = 0-1/3
```

Interpretation remains:

```text
ELITE_RS      = Trifecta PASS + Mansfield > 0 + RS 52W high
STRONG_RS     = Trifecta PASS
ACCEPTABLE_RS = Trifecta PARTIAL
WEAK_RS       = Trifecta FAIL
```

Enhancement rule:

```text
RS21, horizon acceleration, IBD-style rating and RRG may identify an emerging
leader before Trifecta PASS. They do not convert FAIL/PARTIAL into PASS.
```

---

## 8. Stock RRG and RLT

Use the locked weekly Stock RRG formula and the same benchmark used by the RS
line:

```python
rs_ratio = (stock_return_52w / benchmark_return_52w) * 100
rs_momentum = change(rs_ratio, 26w) * 100
```

Persist quadrant, ratio, momentum, deltas, tail direction, prior quadrant,
transition date and transition age.

```text
EARLY_ROTATION       = LAGGING -> IMPROVING
ROTATION_SWEET_SPOT  = IMPROVING -> LEADING
LEADERSHIP_FATIGUE   = LEADING -> WEAKENING
ROTATION_BREAKDOWN   = WEAKENING -> LAGGING
```

RRG is directional. It does not generate the IBD-style RS Rating.

---

## 9. Combined Leadership Lifecycle

### 9.1 Emerging

```text
LEADERSHIP_EMERGING if:
  RS21 state is reclaim/hold/accelerating
  and one or more:
    RS_HORIZON_EARLY_TURN
    IBD-style rating >= 60 and rising
    Stock RRG == IMPROVING
    EARLY_ROTATION
```

### 9.2 Approaching

```text
LEADERSHIP_APPROACHING if:
  IBD-style rating >= 70
  and RS21 is hold/accelerating
  and RS horizon state is 2_OF_3, 3_OF_3 or BROADENING
  and Stock RRG in {IMPROVING, LEADING}
```

### 9.3 Confirmed

```text
LEADERSHIP_CONFIRMED if:
  Trifecta in {PARTIAL, PASS}
  and IBD-style rating >= 80
  and RS21 is hold/accelerating
  and one or more:
    Stock RRG == LEADING
    ROTATION_SWEET_SPOT
    RSNH_BEFORE_PRICE
```

### 9.4 Elite

```text
LEADERSHIP_ELITE if:
  Trifecta PASS
  and IBD-style rating >= 90
  and Mansfield positive and rising
  and RS 52W high
  and Stock RRG == LEADING
```

### 9.5 Fading

```text
LEADERSHIP_FADING if any:
  RS21_BREAK_WARNING
  RS_HORIZON_FADING
  ibd_rs_delta_20d <= -10
  LEADERSHIP_FATIGUE
```

---

## 10. Discovery and Promotion Use

### 10.1 Discovery and Scanner Candidate

Trifecta is always calculated but PASS is not required for broad discovery.
Retain a stock when any early leadership state appears:

```text
RS21_APPROACHING or RECLAIM
RS_HORIZON_EARLY_TURN or ACCELERATING
IBD-style rating rising by at least 5 points over 20 sessions
EARLY_ROTATION or ROTATION_SWEET_SPOT
RSNH_BEFORE_PRICE
```

### 10.2 Near Watchlist

Required:

```text
liquidity pass
RS21 reclaim/hold/accelerating
and at least one:
  Trifecta PARTIAL/PASS
  IBD-style rating >= 70
  RS horizon percentile acceleration
  Stock RRG IMPROVING/LEADING
  RSNH_BEFORE_PRICE
```

### 10.3 Early Entry and Pullback Watch

Trifecta remains required as a displayed diagnostic. Full PASS is not required
to watch an early setup.

```text
Minimum RS permission:
  Trifecta PARTIAL
  or fresh RS21 reclaim plus RS horizon acceleration

Still mandatory:
  valid setup geometry
  constructive VE2
  manageable AXM/PX
  structural stop and acceptable risk
  market permission
```

### 10.4 Trigger Ready and Daily Top

Trifecta confirmation remains part of promotion.

```text
TRIGGER_READY:
  minimum Trifecta PARTIAL
  plus RS21 above EMA21
  plus at least one of:
    IBD-style rating >= 70 and not fading
    Stock RRG IMPROVING/LEADING
    RS_HORIZON_3_OF_3
    RSNH_BEFORE_PRICE

DAILY_TOP_1_4:
  minimum Trifecta PARTIAL
  PASS preferred and receives higher conviction
  plus all normal setup, VE2, market, AXM and risk gates

FULL_CONVICTION / ELITE_RS:
  Trifecta PASS remains mandatory
```

Trifecta alone cannot override setup damage, wide risk, poor volume, excessive
extension or market restrictions.

---

## 11. RSScore / 12 Integration

RSScore must represent independent RS evidence without double counting.

```text
RS21 timing                 0-3
IBD-style RS Rating         0-3
IBD-style rating trend      0-1
RS horizon alignment        0-2
RS high / RSNH context      0-1
Mansfield confirmation      0-1
Trifecta confirmation       0-1
Total                       0-12
```

### 11.1 Suggested Deterministic Mapping

```text
RS21:
  accelerating=3; hold=2.5; reclaim 0-2D=2; reclaim 3-5D=1.5;
  approaching=0.5; below/break=0

IBD-style rating:
  >=90=3; >=80=2.5; >=70=2; >=60=1; otherwise=0

Rating trend:
  delta20>=10=1; delta20>=5=0.75; delta20>0=0.5; otherwise=0

Horizon alignment:
  broadening=2; 3_OF_3=1.5; accelerating/early-turn=1;
  2_OF_3=0.5; otherwise=0

RS high:
  RSNH_BEFORE_PRICE=1; RS52 high=0.75; RS63 high=0.5; otherwise=0

Mansfield:
  positive+rising=1; positive or rising=0.5; otherwise=0

Trifecta:
  PASS=1; PARTIAL=0.5; FAIL=0
```

RRG evidence remains exclusively in `RRGScore / 10` and must not be added again
to RSScore.

---

## 12. Dashboard Table Alignment

The RS leadership table must show:

| Stock | RS 1W | RS1W %ile | RS 1M | RS1M %ile | RS 3M | RS3M %ile | Horizon State | RS Rating | 5D/20D Delta | RS21 State | Trifecta | Mansfield | Stock RRG | Leadership State |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---|---|---|---|---|

Interpretation order:

1. RS 1W/1M/3M show short-to-intermediate relative-return development.
2. Percentiles show whether each horizon is strong versus the universe.
3. RS Rating shows structural rank.
4. RS21 shows timing.
5. RRG shows direction.
6. Trifecta and Mansfield show confirmation.

Price-high and RS-high fields remain separate.

Required views:

```text
RS21 Reclaims
RS Horizon Accelerators
IBD-Style Rating Accelerators
Emerging Leadership
Approaching Leadership
Confirmed Leadership
RSNH Before Price
Improving-to-Leading RRG
Fading Leadership
```

### 12.1 RS Leadership Note

Every Weekly Universe, Near Watchlist, Daily Top and stock-drill-down row must
include a compact deterministic `rs_leadership_note`. The note explains how the
short, tactical and intermediate RS horizons relate to the slower structural
rating, RS21 timing, RRG direction and Trifecta confirmation.

The note is generated from calculated fields. It must not require narrative web
research or an additional language-model call.

Required note inputs:

```text
RS 1W/1M/3M percentiles
RS horizon state
IBD-style RS Rating and 5D/20D deltas
RS21 state and reclaim age
Stock RRG quadrant/transition
Trifecta state
leadership lifecycle
```

Deterministic note templates:

```text
EMERGING:
  "RS leadership is emerging: 1W {p1w} > 1M {p1m} > 3M {p3m};
   RS Rating {rating} ({delta20:+d}/20D); RS21 {rs21_state};
   RRG {rrg_state}; Trifecta {trifecta}."

BROADENING:
  "RS leadership is broadening across 1W/1M/3M ({p1w}/{p1m}/{p3m});
   RS Rating {rating} ({delta20:+d}/20D); RS21 holding;
   RRG {rrg_state}; Trifecta {trifecta}."

CONFIRMED:
  "RS leadership is confirmed: RS Rating {rating}, RS21 {rs21_state},
   RRG {rrg_state}, horizon state {horizon_state};
   Trifecta {trifecta}."

FADING:
  "RS leadership is fading: 1W/1M/3M percentiles {p1w}/{p1m}/{p3m};
   RS Rating {rating} ({delta20:+d}/20D); {warning_state};
   Trifecta {trifecta}."

MIXED:
  "RS evidence is mixed: 1W/1M/3M percentiles {p1w}/{p1m}/{p3m};
   RS Rating {rating} ({delta20:+d}/20D); RS21 {rs21_state};
   RRG {rrg_state}; Trifecta {trifecta}."
```

Example:

```text
RS leadership is emerging: 1W 88 > 1M 72 > 3M 55; RS Rating 74
(+12/20D); RS21 holding above after a 2-session reclaim; RRG Improving;
Trifecta PARTIAL.
```

Display rules:

1. Keep the visible note to one or two compact lines.
2. Never state `confirmed` when Trifecta is FAIL.
3. Never state `accelerating` from raw 1W/1M/3M percentages; use the
   cross-sectional percentiles.
4. A high RS Rating with `RS_HORIZON_FADING`, `RS21_BREAK_WARNING` or RRG
   Weakening must explicitly show the warning.
5. Missing inputs produce `RS leadership note PARTIAL: {missing_fields}`.
6. The note is explanatory only and cannot override setup, VE2, AXM, risk or
   market gates.

---

## 13. Fetch-Once and Token Efficiency

No additional OHLCV fetch is permitted for these calculations.

```text
same cached close series -> RS 1W/1M/3M and weighted 12M raw RS
same complete feature matrix -> universe percentiles
same stock+benchmark cache -> RS line, EMA21, highs and Mansfield
same aligned weekly cache -> Stock RRG/RLT
```

Persist compact feature snapshots. Do not send raw bar history through the
language model. External enrichment remains limited to the tracking basket and
event exceptions.

---

## 14. Acceptance Tests

1. Trifecta is calculated and displayed for every valid candidate.
2. Trifecta PASS/PARTIAL/FAIL definitions are unchanged.
3. RS 1W/1M/3M use relative returns, not absolute stock returns.
4. Horizon percentiles use the complete valid universe and same date.
5. Raw percentages across different horizons are not directly ranked against
   one another.
6. IBD-style rating uses the complete valid universe, deterministic ties and a
   displayed denominator.
7. RS21 reclaim requires prior at/below and current above EMA21.
8. RRG uses the same locked benchmark as the stock RS line.
9. RRGScore does not duplicate RSScore evidence.
10. Trifecta FAIL plus RS21 reclaim may be discovered, but cannot be labelled
    Trifecta PARTIAL/PASS.
11. Trigger Ready and Daily Top require at least Trifecta PARTIAL.
12. Full-conviction leadership requires Trifecta PASS.
13. No RS condition overrides VE2, setup, AXM, risk or market hard gates.
14. Missing rating history is `PARTIAL`, never zero.

---

## 15. Master Merge Map

For AURORA v2.18.3 consolidation:

1. Add Sections 4-9 to **B.6 Relative Strength**.
2. Replace the current RSScore runtime mapping with Section 11.
3. Add Section 10 to discovery, Near Watchlist and entry permissions.
4. Add Section 12 to Weekly, Near Watchlist, Stock RRG and All Candidates.
5. Add Section 13 to the fetch-once runtime contract.
6. Add Section 14 to publication validation.
7. Preserve the original Trifecta formulas and labels; remove only conflicting
   code that incorrectly uses PASS as the sole discovery path.

---

## 16. Final Rule

```text
RS 1W/1M/3M show how relative performance is developing.
IBD-style RS Rating shows structural universe rank.
RS21 shows leadership timing.
Stock RRG shows leadership direction and rotation.
Mansfield shows long-term benchmark confirmation.
RS Trifecta shows multi-condition agreement and remains required for
confirmation and full-conviction promotion.

The enhancement finds leadership earlier without weakening Trifecta.
```
## 17. Integration With AURORA-RSLE

The RS measurements and deterministic notes in this addendum supply the RS
feature stack for `AURORA-RSLE: Relative Strength Leadership Entry Scan`.

RSLE list construction, tactical setup classification, dual stops, entry-risk
tiers and the separate Top 10 Tactical / Leadership Queue 11-20 governance are
controlled by `AURORA_RSLE_DUAL_STOP_ADDENDUM_v0_2.md`.

This integration does not replace or relax the locked RS Trifecta. The Trifecta
remains a distinct confirmation state inside the RSLE score and output table.
