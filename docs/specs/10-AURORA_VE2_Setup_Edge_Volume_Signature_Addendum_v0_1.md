# AURORA-VE2 Setup & Edge Volume Signature Addendum v0.1

**Status:** SEPARATE ADDENDUM — REVIEW ONLY  
**Merge status:** NOT MERGED INTO MASTER  
**Intended master target:** AURORA v2.18.2 or later, only after explicit approval  
**Scope:** EOD scanner enhancement for setup/edge quality analysis  
**Markets:** US, India, Canada  
**Primary purpose:** Enhance how AURORA interprets setup quality, early entries, pullbacks, breakout validity, and failure risk using pattern-specific volume signatures.

---

## 0. Merge Guard

This addendum is not a replacement for the active AURORA master. It is a candidate enhancement layer.

```text
DO NOT merge until explicitly approved.
DO NOT create new final_bucket values.
DO NOT convert diagnostic labels into final buckets.
DO NOT make volume a standalone trade signal.
DO NOT add intraday/session-profile logic to the EOD scanner core.
DO NOT add any label without input fields, formula, fallback, and tests.
```

AURORA remains EOD. Intraday run-rate, session VWAP, real-time bid/ask volume classification, and live trigger automation remain future scope.

---

## 1. Why This Addendum Exists

AURORA already has a Volume Edge lane, RMV/compression logic, HVC/AVWAP, pullback logic, base geometry, AURORA-X risk, and final bucket routing. However, the current volume interpretation is mostly generic.

This addendum makes volume analysis more setup-aware.

```text
Pattern tells AURORA what structure exists.
Volume signature tells AURORA whether the structure shows demand, supply dry-up, distribution, exhaustion, or failure.
RS/market/sector/risk still decide whether the candidate is actionable.
```

This addendum improves:

```text
PatternScore
EntryScore
VolumeScore
PullbackScore
RiskScore
ExtensionSafetyScore
AURORA-X sell-risk warnings
watchlist_action / quality_notes / setup_state
```

It does not change:

```text
final_bucket taxonomy
market adapters
AURORA-SIG component weights
EOD-only operating lock
risk engine ownership
portfolio sizing ownership
```

---

## 2. Core Principle Lock

### 2.1 Volume is contextual

Volume only has meaning relative to:

```text
recent average volume
base/pattern average volume
prior impulse volume
pullback volume
event volume
stage/location on chart
close location inside the bar
price result after the volume event
market regime
sector/theme behavior
```

### 2.2 High volume is not automatically bullish

```text
High volume + strong close + constructive setup = demand confirmation.
High volume + weak close + downside break = distribution.
High volume + vertical extension + reversal wick = climax risk.
Low volume + tight price range near support = constructive dry-up.
Low volume + failed breakout + re-entry into base = weak demand / failed attempt.
```

### 2.3 Early-entry volume is different from official breakout volume

Official breakouts usually require obvious above-average volume.
Early entries may only require:

```text
volume lift versus the immediate dry-up / shelf / last contraction
close quality improvement
no high-volume rejection back into the pattern
nearby structural stop
RS/market context supportive
```

This distinction is important because AURORA’s purpose is to find the earliest clean entry before the obvious breakout.

---

## 3. VE2 Input Fields

### 3.1 Required EOD OHLCV inputs

```text
open
high
low
close
volume
benchmark close
sector/theme proxy close where available
market adapter
liquidity label
existing setup/base classification
RMV / RANGE_RMV_PROXY fields
MA fields: ema10, ema20_21, sma50, sma150, sma200, weekly 10W/30W/40W
HVC levels
AVWAP levels
stage label
RS labels
market_permission
AURORA-X current state
PX/extension state
```

### 3.2 Optional inputs

```text
delivery_pct                # India, if available
block_bulk_volume_flag       # India, if available
up_volume_down_volume_ratio  # if reliable intraday/tick feed exists; otherwise proxy only
volume_by_price_profile      # EOD proxy only unless intraday module exists
float / shares outstanding   # supply context, if available
recent event flags           # earnings, gap, news, IPO, HVE/HV1
```

### 3.3 Fallback rule

```text
If required OHLCV exists: VE2 = CALCULATED.
If OHLCV exists but pattern segmentation is uncertain: VE2 = PARTIAL.
If volume history is insufficient: VE2 = UNKNOWN.
If setup type does not require this lane: VE2 = NOT_APPLICABLE.
```

---

## 4. Core Volume Metrics

### 4.1 Average volume and relative volume

```python
avg_vol_10d = mean(volume[-10:])
avg_vol_20d = mean(volume[-20:])
avg_vol_50d = mean(volume[-50:])

rvol_10d = volume[-1] / avg_vol_10d
rvol_20d = volume[-1] / avg_vol_20d
rvol_50d = volume[-1] / avg_vol_50d
```

### 4.2 Volume multiple against a custom segment

```python
volume_multiple_vs_segment = current_volume / mean(segment_volume)
```

Use this for:

```text
breakout volume vs base average
trigger volume vs handle average
trigger volume vs final VCP contraction
bounce volume vs pullback average
gap volume vs pre-gap average
```

### 4.3 Close location / DCR

```python
close_pos = (close[-1] - low[-1]) / max(high[-1] - low[-1], small_number)
```

Interpretation:

```text
close_pos >= 0.75 = strong demand close
0.60-0.74 = constructive close
0.40-0.59 = neutral/mixed
< 0.40 = weak close / supply warning
```

### 4.4 Dry-up ratio

```python
vol_dryup_5_20 = mean(volume[-5:]) / mean(volume[-20:])
vol_dryup_10_50 = mean(volume[-10:]) / mean(volume[-50:])
```

Labels:

```text
VOLUME_DRYUP_STRONG = vol_dryup_5_20 <= 0.50
VOLUME_DRYUP_VALID = 0.50 < vol_dryup_5_20 <= 0.70
VOLUME_DRYUP_WEAK = 0.70 < vol_dryup_5_20 <= 0.90
NO_VOLUME_DRYUP = vol_dryup_5_20 > 0.90
```

### 4.5 Up-day / down-day volume proxy

If no intraday classification exists, use EOD proxy:

```python
up_day = close > close[-2]
down_day = close < close[-2]
up_day_volume_20d = sum(volume[i] for i in last_20 if close[i] > close[i-1])
down_day_volume_20d = sum(volume[i] for i in last_20 if close[i] < close[i-1])
ud_ratio_20d = up_day_volume_20d / max(down_day_volume_20d, small_number)
```

Labels:

```text
UD_ACCUMULATION = ud_ratio_20d >= 1.2
UD_NEUTRAL = 0.8 <= ud_ratio_20d < 1.2
UD_DISTRIBUTION = ud_ratio_20d < 0.8
```

### 4.6 Distribution cluster count

```python
distribution_day = (
    close[i] < close[i-1]
    and volume[i] > avg(volume[i-20:i]) * 1.2
    and close_pos[i] < 0.40
)

distribution_cluster_10d = count(distribution_day over last 10 bars)
distribution_cluster_6w = count(distribution_day over last 30 bars)
```

Labels:

```text
DISTRIBUTION_CLEAR = distribution_cluster_10d == 0 and distribution_cluster_6w <= 2
DISTRIBUTION_PRESENT = distribution_cluster_10d in [1,2] or distribution_cluster_6w in [3,4]
DISTRIBUTION_CLUSTER = distribution_cluster_10d >= 3 or distribution_cluster_6w >= 5
```

---

## 5. VE2 Output Fields

```text
ve2_status = CALCULATED / PARTIAL / UNKNOWN / NOT_APPLICABLE
ve2_pattern_volume_grade = A / B / C / FAIL / UNKNOWN
ve2_signature_label
ve2_volume_context
ve2_dryup_label
ve2_demand_label
ve2_supply_label
ve2_failure_label
ve2_pattern_notes
ve2_score_delta_pattern
ve2_score_delta_entry
ve2_score_delta_volume
ve2_score_delta_pullback
ve2_score_delta_risk
ve2_score_delta_extension
```

### 5.1 VE2 signature labels

```text
VE2_BASE_DRYUP_CONFIRMED
VE2_BASE_VOLUME_CONSTRUCTIVE
VE2_BREAKOUT_VOLUME_CONFIRMED
VE2_BREAKOUT_VOLUME_THIN
VE2_BREAKOUT_REENTRY_FAILURE
VE2_EARLY_ENTRY_VOLUME_LIFT
VE2_HANDLE_DRYUP_VALID
VE2_VCP_VOLUME_SEQUENCE_CONFIRMED
VE2_VCP_FINAL_DRYUP
VE2_FLAG_VOLUME_HEALTHY
VE2_HTF_VOLUME_HEALTHY
VE2_PULLBACK_VOLUME_CONTROLLED
VE2_PULLBACK_TURNUP_CONFIRMED
VE2_HVC_ACCEPTANCE_SUPPORT
VE2_GAP_ACCEPTANCE_VOLUME_CONFIRMED
VE2_VOLUME_PROFILE_SUPPORT_PROXY
VE2_DISTRIBUTION_CLUSTER_WARNING
VE2_CLIMAX_VOLUME_WARNING
VE2_LOW_QUALITY_VOLUME
VE2_VOLUME_UNKNOWN
```

Diagnostic only. None of these may become `final_bucket`.

---

## 6. Pattern-Specific Volume Signatures

## 6.1 Universal Pre-Setup Demand Filter

Before scoring any base, AURORA checks whether there was prior demand.

Inputs:

```text
prior_run_pct
recent_swing_high
prior_base_low
rvol_20d history
number of high-volume up days in prior 8-10 weeks
distribution cluster count
extension/climax state
```

Positive signs:

```text
clear prior uptrend or Stage 1-to-2 transition
multiple high-volume up days before base
RS improving during or before the setup
no major blow-off reversal immediately before the base
```

Warning signs:

```text
huge volume reversal near top of pole
cluster of high-volume down days before base
RS deterioration during base
vertical extension without orderly digestion
```

Labels:

```text
VE2_PRIOR_DEMAND_STRONG
VE2_PRIOR_DEMAND_VALID
VE2_PRIOR_DEMAND_THIN
VE2_PRIOR_DEMAND_EXHAUSTED
```

Score effect:

```text
STRONG: +1 PatternScore, +1 VolumeScore
VALID: no penalty
THIN: cap pattern volume grade at B
EXHAUSTED: add PX/AURORA-X warning review
```

---

## 6.2 Flat Base / Tight Shelf / Ledge

### Ideal signature

```text
base depth controlled, usually tight
volume contracts across base
no repeated heavy down-volume breaks inside base
price tightens near upper boundary
micro-shelf forms just under resistance
RS holds near/new high if leadership quality exists
```

### Formulas

```python
base_avg_vol = mean(volume[base_start:base_end])
prior_run_avg_vol = mean(volume[prior_run_start:prior_run_end])
base_volume_ratio = base_avg_vol / prior_run_avg_vol

breakout_vs_base = volume[-1] / base_avg_vol
shelf_dryup = mean(volume[-5:]) / mean(volume[-20:])
```

### Labels

```text
VE2_FLAT_BASE_DRYUP_A = base_volume_ratio <= 0.70 and shelf_dryup <= 0.60
VE2_FLAT_BASE_DRYUP_B = base_volume_ratio <= 0.85 and shelf_dryup <= 0.75
VE2_FLAT_BASE_NO_DRYUP = base_volume_ratio > 0.90
VE2_SHELF_VOLUME_LIFT = micro_pivot_break and volume[-1] > mean(volume[-10:]) and close_pos >= 0.60
VE2_FLAT_BASE_BREAKOUT_CONFIRMED = breakout_vs_base >= 1.5 and close_pos >= 0.60
VE2_FLAT_BASE_BREAKOUT_STRONG = breakout_vs_base >= 2.0 and close_pos >= 0.75
VE2_FLAT_BASE_FAILURE = close re-enters base after breakout and volume weak/falling or down-volume expands
```

### Aurora effect

```text
Dry-up improves PatternScore.
Micro-shelf volume lift improves EntryScore for EARLY_ENTRY_WATCH / TRIGGER_READY.
Confirmed breakout improves VolumeScore.
Failure triggers AURORA-X review and setup downgrade.
```

---

## 6.3 Cup with Handle

### Ideal signature

```text
left side: selling volume may be heavy early
bottom: volume dries up
right side: up days show improving volume versus down days
handle: volume lighter than right side/cup average
breakout: volume expands versus handle and base average
```

### Formulas

```python
cup_avg_vol = mean(volume[cup_start:cup_end])
right_side_up_vol = mean(volume[i] for i in right_side if close[i] > close[i-1])
right_side_down_vol = mean(volume[i] for i in right_side if close[i] < close[i-1])
handle_avg_vol = mean(volume[handle_start:handle_end])
handle_volume_ratio = handle_avg_vol / max(cup_avg_vol, small_number)
breakout_vs_handle = volume[-1] / max(handle_avg_vol, small_number)
```

### Labels

```text
VE2_CUP_BOTTOM_DRYUP = bottom_volume <= 0.70 * cup_avg_vol
VE2_CUP_RIGHT_SIDE_ACCUMULATION = right_side_up_vol > right_side_down_vol
VE2_HANDLE_DRYUP_A = handle_volume_ratio <= 0.60
VE2_HANDLE_DRYUP_B = 0.60 < handle_volume_ratio <= 0.75
VE2_HANDLE_DISTRIBUTION_WARNING = heavy down-volume breaks or close below handle low
VE2_HANDLE_EARLY_ENTRY_VOLUME_LIFT = handle downtrend/micro-range break and volume > recent handle average
VE2_CUP_HANDLE_BREAKOUT_CONFIRMED = breakout_vs_handle >= 1.5 and close_pos >= 0.60
VE2_CUP_HANDLE_BREAKOUT_STRONG = breakout_vs_handle >= 2.0 and close_pos >= 0.75
VE2_CUP_HANDLE_FAILURE = heavy-volume break below handle low or breakout re-entry with weak close
```

### Aurora effect

```text
Handle dry-up strengthens PatternScore and PullbackScore.
Early handle break strengthens EntryScore only if risk is tight.
Heavy-volume handle failure downgrades setup_state and may trigger AURORA-X.
```

---

## 6.4 VCP / RMV Contraction Setup

### Ideal signature

```text
2-6 visible contractions
price contractions become smaller
volume contracts with each contraction
final contraction has lowest volume or near-lowest volume
rallies between contractions show better volume than contraction down days
pivot area is tight and close to MAs / HVC / AVWAP where possible
```

### Formulas

```python
contraction_depths = [depth_C1, depth_C2, depth_C3, ...]
contraction_avg_volumes = [avg_vol_C1, avg_vol_C2, avg_vol_C3, ...]

depth_sequence_pass = all(contraction_depths[i] > contraction_depths[i+1] for i in range(len(contraction_depths)-1))
volume_sequence_pass = all(contraction_avg_volumes[i] > contraction_avg_volumes[i+1] for i in range(len(contraction_avg_volumes)-1))

final_contraction_dryup = contraction_avg_volumes[-1] / mean(volume[-50:])
trigger_vs_final_contraction = volume[-1] / max(contraction_avg_volumes[-1], small_number)
```

### Labels

```text
VE2_VCP_SEQUENCE_A = depth_sequence_pass and volume_sequence_pass and final_contraction_dryup <= 0.60
VE2_VCP_SEQUENCE_B = at least 2 contractions and volume generally declining
VE2_VCP_FINAL_DRYUP = final_contraction_dryup <= 0.60
VE2_VCP_NO_DRYUP = final_contraction_dryup > 0.85
VE2_VCP_EARLY_ENTRY_VOLUME_LIFT = micro_pivot_break and trigger_vs_final_contraction >= 1.3 and close_pos >= 0.60
VE2_VCP_PIVOT_BREAKOUT_CONFIRMED = rvol_20d >= 1.5 and close_pos >= 0.60
VE2_VCP_PIVOT_BREAKOUT_STRONG = rvol_20d >= 2.0 and close_pos >= 0.75
VE2_VCP_FAILURE = heavy-volume close below last contraction low or failed pivot with weak close
```

### Aurora effect

```text
VE2_VCP_SEQUENCE_A can add to PatternScore and RMV pivot quality.
Early VCP lift can support EARLY_ENTRY_WATCH or TRIGGER_READY.
Official pivot breakout can support TRIGGER_READY / TRADE_READY if other lanes agree.
Failure maps to AURORA-X and risk downgrade.
```

---

## 6.5 High-Tight Flag / Power Flag

### Ideal signature

```text
power pole: strong price run with repeated high-volume up days
flag: tight, shallow digestion
flag volume contracts clearly versus pole volume
up days inside flag are not meaningfully weaker than down days
no climactic reversal at top of pole
breakout or early downtrend-line break shows volume lift
post-breakout pullback volume is lighter than breakout volume
```

### Formulas

```python
pole_pct_gain = recent_swing_high / prior_base_low - 1
pole_avg_vol = mean(volume[pole_start:pole_end])
flag_avg_vol = mean(volume[flag_start:flag_end])
flag_volume_ratio = flag_avg_vol / max(pole_avg_vol, small_number)
flag_depth_pct = (flag_high - flag_low) / flag_high * 100
breakout_vs_flag = volume[-1] / max(flag_avg_vol, small_number)
```

### Labels

```text
VE2_HTF_POLE_DEMAND_STRONG = pole_pct_gain >= 1.0 and multiple rvol_20d >= 1.5 up days
VE2_POWER_FLAG_POLE_DEMAND_VALID = pole_pct_gain >= 0.30 and multiple demand days
VE2_HTF_FLAG_DRYUP_A = flag_volume_ratio <= 0.50 and flag_depth_pct <= 25
VE2_HTF_FLAG_DRYUP_B = flag_volume_ratio <= 0.70 and flag_depth_pct <= 25
VE2_HTF_FLAG_DISTRIBUTION_WARNING = rising volume during flag with weak closes
VE2_HTF_EARLY_ENTRY_VOLUME_LIFT = flag_downtrend_break and volume > recent flag avg and close_pos >= 0.60
VE2_HTF_BREAKOUT_CONFIRMED = breakout_vs_flag >= 1.5 and close_pos >= 0.60
VE2_HTF_BREAKOUT_STRONG = breakout_vs_flag >= 2.0 and close_pos >= 0.75
VE2_HTF_FAILED_FLAG = close below flag low on heavy volume or breakout fails immediately
```

### Aurora effect

```text
HTF/Power Flag is high reward but high failure risk.
Require strict PX/extension and AURORA-X review.
A climactic pole top caps ExtensionSafetyScore.
Failed flag maps to AURORA-X hard review.
```

---

## 6.6 Standard Bull Flag / Continuation Flag

### Ideal signature

```text
flagpole on elevated volume
flag drifts sideways/down on lower volume
down days in flag are not heavy
breakout from flag shows renewed demand
pullback to top of flag or 10/20 EMA occurs on lighter volume
```

### Formulas

```python
flag_volume_ratio = mean(volume[flag_start:flag_end]) / mean(volume[pole_start:pole_end])
breakout_vs_flag = volume[-1] / mean(volume[flag_start:flag_end])
```

### Labels

```text
VE2_FLAG_VOLUME_HEALTHY = flag_volume_ratio <= 0.70 and distribution_cluster_10d == 0
VE2_FLAG_VOLUME_MIXED = 0.70 < flag_volume_ratio <= 0.90
VE2_FLAG_DISTRIBUTION_WARNING = flag volume rising with weak closes
VE2_FLAG_EARLY_ENTRY_LIFT = flag trendline break and volume > recent flag avg
VE2_FLAG_BREAKOUT_CONFIRMED = breakout_vs_flag >= 1.5 and close_pos >= 0.60
VE2_FLAG_FAILURE = heavy-volume close below flag low
```

---

## 6.7 Double Bottom / W-Base / Undercut-and-Rally

### Ideal signature

```text
first low may show panic or heavy selling
second low shows lower volume or stronger close quality
undercut/flush is quickly reclaimed
rally from second low shows improving up-volume
neckline/pivot breakout confirms with volume expansion
```

### Formulas

```python
low2_volume_ratio = volume_at_low2 / max(volume_at_low1, small_number)
neckline_breakout_vs_range = volume[-1] / mean(volume[range_start:range_end])
reclaim_close_quality = close_pos >= 0.60
```

### Labels

```text
VE2_DOUBLE_BOTTOM_SUPPLY_DRYING = low2_volume_ratio <= 0.70
VE2_DOUBLE_BOTTOM_BEAR_TRAP_RECLAIM = undercut_low1 and close_reclaims_low1 and close_pos >= 0.60
VE2_U_AND_R_VOLUME_VALID = reclaim on volume higher than prior 3-5 bars or strong close with no downside follow-through
VE2_W_BASE_NECKLINE_BREAK_CONFIRMED = neckline_breakout_vs_range >= 1.5 and close_pos >= 0.60
VE2_W_BASE_FAILURE = second low breaks deeply on heavy volume or neckline breakout fails immediately
```

### Aurora effect

```text
U&R/Oops can remain pilot/early entry in transition markets if risk is tight.
Neckline confirmation increases EntryScore.
Heavy-volume low failure downgrades to REPAIR_WATCH / AVOID_FRESH_LONG depending on stage and damage.
```

---

## 6.8 Moving Average Pullback / Support Pullback

### Ideal signature

```text
stock is in established uptrend
pullback is controlled and orderly
volume declines into support
support aligns with 10 EMA, 20/21 EMA, 50 SMA, 10W, HVC, AVWAP, prior pivot, or RMV support flip
turn-up bar shows volume lift versus pullback days
close is strong and price reclaims short-term resistance where possible
```

### Formulas

```python
impulse_avg_vol = mean(volume[impulse_start:impulse_end])
pullback_avg_vol = mean(volume[pullback_start:pullback_end])
pullback_volume_ratio = pullback_avg_vol / max(impulse_avg_vol, small_number)
turnup_vs_pullback = volume[-1] / max(pullback_avg_vol, small_number)
```

### Labels

```text
VE2_PULLBACK_VOLUME_CONTROLLED_A = pullback_volume_ratio <= 0.60
VE2_PULLBACK_VOLUME_CONTROLLED_B = 0.60 < pullback_volume_ratio <= 0.75
VE2_PULLBACK_VOLUME_NOT_CONTROLLED = pullback_volume_ratio > 0.90
VE2_PULLBACK_TURNUP_CONFIRMED = turnup_vs_pullback >= 1.3 and close_pos >= 0.60
VE2_PULLBACK_TURNUP_STRONG = turnup_vs_pullback >= 1.5 and close_pos >= 0.75
VE2_PULLBACK_HEAVY_SELLING_WARNING = down-volume expands into support or close below support with weak close
```

### Aurora effect

```text
Controlled pullback supports PULLBACK_WATCH or TRIGGER_READY.
Turn-up confirmation improves EntryScore.
Heavy selling into support reduces PullbackScore and may trigger AURORA-X.
```

---

## 6.9 Base-on-Base / Continuation Base

### Ideal signature

```text
first base breakout showed strong demand
second base forms above or near prior breakout level
volume in second base is lower than breakout/run volume
HVC / prior pivot / AVWAP / MA support holds
breakout from second base shows renewed volume expansion
```

### Formulas

```python
prior_breakout_volume = volume[prior_breakout_day]
second_base_avg_vol = mean(volume[second_base_start:second_base_end])
second_base_volume_ratio = second_base_avg_vol / max(prior_breakout_volume, small_number)
```

### Labels

```text
VE2_BASE_ON_BASE_HEALTHY = second_base_volume_ratio <= 0.60 and support holds
VE2_BASE_ON_BASE_MIXED = second_base_volume_ratio <= 0.80 and no distribution cluster
VE2_BASE_ON_BASE_DISTRIBUTION_WARNING = repeated heavy down-volume in second base
VE2_CONTINUATION_BREAKOUT_CONFIRMED = rvol_20d >= 1.5 and close_pos >= 0.60
```

---

## 6.10 EP / PEAD / Gap Acceptance

### Ideal signature

```text
event gap occurs on high volume
gap day closes in upper half/upper quartile
gap low or midpoint holds after event
gap HVC becomes support
AVWAP from event remains supportive
post-gap drift occurs without repeated high-volume failures
```

### Formulas

```python
gap_rvol = gap_day_volume / mean(volume[gap_day-20:gap_day])
gap_close_pos = (gap_close - gap_low) / max(gap_high - gap_low, small_number)
post_gap_failure_count = count(high_volume_weak_close below gap_mid_or_low within 10-15 bars)
```

### Labels

```text
VE2_GAP_VOLUME_CONFIRMED = gap_rvol >= 2.0
VE2_GAP_ACCEPTANCE_STRONG = gap_close_pos >= 0.75 and gap_low_holds
VE2_GAP_ACCEPTANCE_VALID = gap_close_pos >= 0.50 and gap_midpoint_holds
VE2_GAP_HVC_SUPPORT = current price holds gap HVC
VE2_POST_GAP_DRYUP = post-gap pullback volume <= 0.70 * gap_day_volume
VE2_GAP_FAILURE_WARNING = gap low fails on high volume or repeated high-volume weak closes
VE2_EXHAUSTION_GAP_WARNING = late-stage gap with rvol >= 3.0 and weak close/reversal
```

### Aurora effect

```text
Gap acceptance supports EP/PEAD lanes.
Gap support failure triggers AURORA-X and invalidates fresh entries.
Late-stage exhaustion gap reduces ExtensionSafetyScore.
```

---

## 6.11 IPO Base

### Ideal signature

```text
initial volatility digests
volume contracts after early trading excitement
range tightens near pivot
RS improves before price breakout if benchmark history exists
breakout volume expands against short available history
IPO AVWAP / HVC support respected
```

### Fallback logic

```text
If less than 50 daily bars: use available-history averages and mark PARTIAL.
If less than 20 daily bars: VE2 may be UNKNOWN or IPO_PARTIAL.
Do not require 252-day volume percentiles for young IPOs.
```

### Labels

```text
VE2_IPO_VOLUME_DIGESTION = volume contracts after first 10-20 days
VE2_IPO_BASE_DRYUP = recent 5-day volume <= 0.60 * available avg volume
VE2_IPO_BREAKOUT_VOLUME_CONFIRMED = current volume >= 1.5 * available avg volume and close_pos >= 0.60
VE2_IPO_FAILURE_WARNING = high-volume downside break below base low / IPO AVWAP / HVC
```

---

## 6.12 Late-Stage / Climax / Exhaustion

### Warning signature

```text
stock has had a long advance
price is far above 20/21 EMA or 10-week MA
volume expands violently after vertical move
bar closes weak or off highs
next bar/down bar confirms supply
multiple high-volume days occur without further price progress
```

### Formulas

```python
volume_percentile_1y = percentile_rank(volume[-1], volume[-252:])
range_percentile_1y = percentile_rank(high[-1] - low[-1], range[-252:])
extension_21ema = (close[-1] - ema20_21[-1]) / ema20_21[-1] * 100
```

### Labels

```text
VE2_CLIMAX_VOLUME_WARNING = volume_percentile_1y >= 0.90 and range_percentile_1y >= 0.90 and extension_21ema >= 15
VE2_BLOWOFF_RISK = rvol_20d >= 3.0 and weak close after vertical move
VE2_STALLING_ON_VOLUME = high volume but close_pos < 0.50 and little/no price progress
VE2_EXHAUSTION_CONFIRMED = climax warning plus next-bar high-volume downside action
```

### Aurora effect

```text
Reduce ExtensionSafetyScore.
Add PX/AURORA-X warning.
Cap fresh-entry bucket at NO_CHASE unless a proper reset forms later.
Existing holdings move to PROTECT_PROFIT_REVIEW if sell-risk lane agrees.
```

---

## 7. EOD Volume-at-Price Proxy Layer

### 7.1 Scope

This is not intraday market profile. It is an EOD approximation for structural shelves and low-volume corridors.

```text
Allowed: EOD volume-by-price proxy from daily bars over anchored windows.
Not allowed in core: session profile, real-time VAH/VAL, bid/ask imbalance, live market-profile day trading.
```

### 7.2 Anchored profile windows

Use only where enough bars exist.

```text
profile_base = from base_start to current
profile_event = from gap/earnings/HVE date to current
profile_52w = last 252 daily bars
profile_stage = from Stage 1/2 transition if available
```

### 7.3 Approximation method

```python
# Build price bins over chosen window.
# Allocate each day's volume to typical price bin, or distribute across high-low range if implementation supports it.
typical_price = (high + low + close) / 3
bin_volume[price_bin(typical_price)] += volume

poc_bin = bin with highest volume
hvn_bins = bins with volume above selected percentile threshold
lvn_bins = bins with volume below selected percentile threshold between HVNs
```

### 7.4 Labels

```text
VE2_PROFILE_STATUS = CALCULATED / PARTIAL / UNKNOWN / NOT_APPLICABLE
VE2_HVN_SUPPORT_NEARBY = current price within 0-3% of HVN shelf and above/holding it
VE2_HVN_RESISTANCE_NEARBY = current price below HVN shelf and struggling there
VE2_LVN_FAST_LANE_ABOVE = low-volume corridor above pivot before next HVN
VE2_LVN_FAST_LANE_BELOW = low-volume corridor below support, downside air pocket
VE2_POC_SHIFT_UP = profile POC migrating upward over rolling windows
VE2_POC_SHIFT_DOWN = profile POC migrating downward over rolling windows
VE2_ACCEPTANCE_ABOVE_OLD_VALUE = new HVN forming above prior base/shelf
VE2_REJECTION_FROM_VALUE = price breaks out but fails to build volume above value and re-enters
```

### 7.5 Interpretation

```text
HVN shelf = acceptance/support or resistance depending on price location.
LVN corridor = fast zone; price can move quickly through it.
POC shifting up = improving acceptance at higher prices.
POC shifting down = supply/acceptance lower; caution.
Breakout that builds a new HVN above old range = healthier acceptance.
Breakout that stays thin and falls back into old range = rejection/failure.
```

### 7.6 Aurora effect

```text
HVN near pullback support can add PullbackScore.
LVN fast lane above pivot can add quality_notes for upside air pocket, but cannot create TRADE_READY alone.
LVN fast lane below support can improve RiskScore caution / AURORA-X sensitivity.
POC shift up can add a small PatternScore/VolumeScore modifier.
POC shift down can add distribution warning.
```

---

## 8. Early Entry Decision Layer

### 8.1 Early-entry eligibility

```text
market_permission not DEFENSE_MODE
liquidity pass or explicitly allowed partial
weekly context strong/ok or constructive Stage 1-to-2
RS strong/improving or RSNH before price
valid base/pullback/RMV structure
price within acceptable risk distance from stop
no PX/AURORA-X hard warning
volume signature supports dry-up + lift, not distribution
```

### 8.2 Early-entry volume types

```text
Shelf micro-break: volume higher than recent shelf days; not necessarily 2x average.
VCP micro-pivot: volume higher than final contraction days; no immediate rejection.
Handle downtrend break: volume higher than handle average; close strong.
Pullback turn-up: volume higher than pullback average; support holds.
HTF flag trendline break: volume lift versus flag days; no blowoff warning.
U&R/Oops: reclaim with strong close or volume improvement; risk must be tight.
```

### 8.3 Early-entry labels

```text
VE2_EARLY_ENTRY_DRYUP_PLUS_LIFT
VE2_EARLY_ENTRY_VOLUME_LIFT_ONLY
VE2_EARLY_ENTRY_NO_VOLUME_CONFIRM
VE2_EARLY_ENTRY_REJECTION_WARNING
VE2_EARLY_ENTRY_FAILED
```

### 8.4 Bucket interaction

```text
VE2 can support EARLY_ENTRY_WATCH or TRIGGER_READY.
VE2 cannot create TRADE_READY unless existing AURORA lanes also pass.
If early-entry volume is missing but setup is otherwise strong, keep WATCH/WAIT and do not force entry.
```

---

## 9. Official Breakout Volume Layer

### 9.1 Official breakout requirements

```text
close above valid pivot/resistance
close_pos >= 0.60 preferred
rvol_20d >= 1.5 preferred
volume above base/handle/flag/contraction average
no immediate re-entry into base
RS not diverging badly
market permission supportive
risk still acceptable
```

### 9.2 Breakout volume grades

```text
A = rvol_20d >= 2.0 and close_pos >= 0.75 and volume exceeds base/handle average by >= 2x
B = rvol_20d >= 1.5 and close_pos >= 0.60
C = price breakout but volume only modest, close okay, RS strong; watch for follow-through
FAIL = breakout on weak volume, weak close, or immediate re-entry
UNKNOWN = insufficient volume history
```

### 9.3 Follow-through check

```python
post_breakout_avg_vol_1_3 = mean(volume[breakout_day+1:breakout_day+4])
post_breakout_price_holds = close_current >= pivot_price or close_current >= pivot_zone_low
```

Labels:

```text
VE2_BREAKOUT_FOLLOWTHROUGH_HEALTHY
VE2_BREAKOUT_FOLLOWTHROUGH_THIN
VE2_BREAKOUT_REENTRY_FAILURE
VE2_BREAKOUT_HIGH_VOLUME_REVERSAL
```

---

## 10. Failure / Invalidation Layer

### 10.1 Heavy-volume failure levels

Monitor heavy-volume breaks below:

```text
base low
handle low
VCP final contraction low
flag low
RMV range low
prior pivot / breakout support
HVC support
gap low / gap midpoint
AVWAP anchor support
20/21 EMA if that is the stock's character MA
50 SMA if intermediate trend is key
10-week MA for weekly context
```

### 10.2 Failure labels

```text
VE2_HEAVY_VOLUME_SUPPORT_BREAK
VE2_PIVOT_REENTRY_FAILURE
VE2_HANDLE_LOW_FAILURE
VE2_VCP_LAST_CONTRACTION_FAILURE
VE2_FLAG_LOW_FAILURE
VE2_GAP_LOW_FAILURE
VE2_HVC_FAILURE
VE2_AVWAP_FAILURE
VE2_DISTRIBUTION_CLUSTER_AFTER_BREAKOUT
VE2_LOW_QUALITY_BREAKOUT_VOLUME
```

### 10.3 AURORA-X mapping

```text
VE2_HEAVY_VOLUME_SUPPORT_BREAK -> AURORA-X review, possible X2/X3 depending structural level
VE2_PIVOT_REENTRY_FAILURE -> failed breakout warning
VE2_HANDLE_LOW_FAILURE -> setup invalidation
VE2_VCP_LAST_CONTRACTION_FAILURE -> setup invalidation
VE2_FLAG_LOW_FAILURE -> HTF/flag failure warning
VE2_GAP_LOW_FAILURE -> EP/PEAD failure warning
VE2_DISTRIBUTION_CLUSTER_AFTER_BREAKOUT -> sell-risk review / protect profit review
VE2_CLIMAX_VOLUME_WARNING -> PX/AURORA-X caution, not automatic sell by itself
```

---

## 11. Score Wiring

VE2 should not add a new AURORA-SIG component. It feeds existing components.

### 11.1 Score deltas

```text
PatternScore: -2 to +2
EntryScore: -2 to +2
VolumeScore: -3 to +3
PullbackScore: -2 to +2
RiskScore: -2 to +1
ExtensionSafetyScore: -3 to +1
```

### 11.2 Positive score examples

```text
VCP sequence confirmed + final dry-up: +2 PatternScore, +1 VolumeScore
Flat shelf dry-up + micro-break lift: +1 PatternScore, +2 EntryScore
Handle dry-up + breakout volume: +1 PatternScore, +2 VolumeScore
Pullback controlled + turn-up confirmed: +2 PullbackScore, +1 EntryScore
Gap accepted + HVC support: +1 VolumeScore, +1 PullbackScore
HVN shelf support + AVWAP/MA confluence: +1 PullbackScore
```

### 11.3 Negative score examples

```text
Distribution cluster inside base: -2 PatternScore, -2 VolumeScore
Breakout weak volume + re-entry: -2 EntryScore, -2 RiskScore
Heavy-volume support break: -2 RiskScore, AURORA-X review
Climax volume warning: -3 ExtensionSafetyScore
Rising volume during flag with weak closes: -2 PatternScore, -2 VolumeScore
```

### 11.4 Caps

```text
If VE2_DISTRIBUTION_CLUSTER_WARNING is active, cap pattern volume grade at C.
If VE2_BREAKOUT_REENTRY_FAILURE is active, cap final_bucket at REPAIR_WATCH or AVOID_FRESH_LONG depending damage.
If VE2_CLIMAX_VOLUME_WARNING plus PX_HARD_WARNING, cap fresh-entry bucket at NO_CHASE.
If VE2_HEAVY_VOLUME_SUPPORT_BREAK, fresh long is blocked unless repaired later.
```

---

## 12. Market-Specific Adjustments

## 12.1 US

```text
Use rvol_20d, rvol_50d, HVE/HV1/HVLE, RS vs SPY/QQQ, sector ETF context.
Volume thresholds can stay strict for liquid stocks.
Gaps/EP/PEAD volume confirmation is important.
```

## 12.2 India

```text
Use NSE/BSE adjusted EOD OHLCV.
Delivery percentage can strengthen volume confirmation when available.
Avoid over-reliance on raw volume around corporate actions or circuit days.
For T2T/ASM/GSM/circuit-day contexts, mark volume interpretation PARTIAL if liquidity/actionability is distorted.
High delivery on up day can improve VE2 demand quality.
High delivery on downside support break can worsen VE2 risk quality.
```

India optional labels:

```text
VE2_DELIVERY_ACCUMULATION_CONFIRM = delivery_pct >= 50 and up day and close_pos >= 0.60
VE2_DELIVERY_DISTRIBUTION_WARNING = delivery_pct >= 50 and down day and close_pos < 0.40
VE2_CIRCUIT_VOLUME_DISTORTED = circuit day or abnormal constraint; volume read PARTIAL
```

## 12.3 Canada

```text
Use stricter liquidity awareness because many TSX names can be thin.
Volume signals in thin names should be PARTIAL unless liquidity pass is clear.
Use sector/commodity proxy context where relevant.
Avoid upgrading a candidate purely due to one low-float volume spike.
```

---

## 13. Output Discipline

Every candidate output can include a short VE2 block only if useful for the scan type.

### 13.1 Single-stock output fields

```text
ve2_pattern_volume_grade
ve2_signature_label
ve2_dryup_label
ve2_breakout_volume_grade
ve2_pullback_volume_grade
ve2_failure_label
ve2_volume_profile_proxy_label
ve2_notes
```

### 13.2 Scan output fields

Use compact fields:

```text
VolSig: A/B/C/FAIL/UNKNOWN
DryUp: STRONG/VALID/WEAK/NONE
Demand: STRONG/VALID/MIXED/WEAK
Failure: NONE/WATCH/ACTIVE
VE2 Note: one short phrase
```

Example:

```text
VolSig=A | DryUp=STRONG | Demand=VALID | Failure=NONE | Note=VCP final dry-up + early pivot volume lift
```

---

## 14. Backtest / Calibration Plan

VE2 thresholds are initial defaults. They must be calibrated separately by market and setup.

### 14.1 Test groups

```text
Flat base breakout
Flat base early shelf entry
Cup-handle breakout
Handle early entry
VCP official pivot
VCP early pivot
HTF official breakout
HTF early flag break
Pullback to 10/20 EMA
Pullback to prior pivot/HVC/AVWAP
Gap accepted / PEAD
Gap failed
Double bottom / U&R
Late-stage climax warning
```

### 14.2 Metrics

```text
5D forward return
10D forward return
20D forward return
max favorable excursion
max adverse excursion
failure rate
re-entry failure rate
stop-hit rate
breakout follow-through rate
average R multiple
median R multiple
win rate after market regime filter
win rate by RS tier
win rate by sector/theme RRG state
```

### 14.3 Calibration targets

```text
Find best rvol thresholds by setup, not one global number.
Separate early-entry volume lift thresholds from official breakout volume thresholds.
Measure whether final dry-up improves outcomes in VCP/shelf/handle setups.
Measure failure rate after distribution clusters.
Measure whether volume-profile proxy adds useful support/resistance context or noise.
```

---

## 15. Required Tests Before Merge

```text
VE2_status_enum_test
VE2_no_new_final_bucket_test
VE2_no_intraday_core_dependency_test
VE2_label_formula_fallback_test
VE2_volume_history_insufficient_test
VE2_pattern_specific_threshold_test
VE2_score_delta_bounds_test
VE2_no_trade_ready_from_volume_alone_test
VE2_early_entry_vs_official_breakout_test
VE2_failure_to_aurora_x_mapping_test
VE2_india_delivery_optional_test
VE2_canada_liquidity_partial_test
VE2_output_compactness_test
VE2_backtest_threshold_config_test
```

---

## 16. Integration Summary

```text
AURORA-VE2 is a pattern-specific volume signature layer.
It does not replace Volume Edge.
It refines Volume Edge by setup type.
It strengthens early-entry, pullback, breakout, and failure interpretation.
It feeds existing AURORA-SIG components only.
It does not create new final buckets.
It remains EOD-compatible.
It should be merged only after review, backtest planning, and explicit approval.
```

---

## 17. One-Line Rule

```text
The best AURORA setup is not the one with the biggest volume; it is the one where price structure, RS, market regime, risk, and pattern-specific volume signature all tell the same story.
```
