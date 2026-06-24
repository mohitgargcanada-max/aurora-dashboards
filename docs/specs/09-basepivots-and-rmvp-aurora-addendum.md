# AURORA Addendum v2.18.3-DRAFT

## BPX — BasePivot, RMVP, Darvas, Auto-AVWAP & Renderer Integration

### VE2-Aware Consolidated Addendum

**Status:** Draft addendum — do not merge until approved
**Parent:** AURORA_MASTER_v2_18_2_WEEKLY_LIST_SINGLE_SOURCE_OF_TRUTH.md
**Scope:** EOD scanner only
**Markets:** US, India, Canada
**Purpose:** Add precise pivot identification, rendering, alerting, and support/retest interpretation on top of existing Aurora base, RMV, AVWAP, VE2, and setup math.

---

# 1. Core Design Intent

Aurora already has:

```text
base geometry
base type classification
base validity
base count
Weinstein stage
RMV / RANGE_RMV_PROXY
RMV pivot extraction
RMV pivot quality score
RMV support-flip / retest logic
AVWAP
HVC
VE2 Volume Signatures
final bucket taxonomy
AURORA-SIG scoring
```

This addendum does **not** rewrite any of that.

This addendum adds a focused layer:

```text
AURORA-BPX = BasePivot + RMVP + Darvas + Pivot Rendering Layer
```

BPX answers:

```text
1. Where is the structural base pivot?
2. Where is the early RMV pivot / low-cheat pivot?
3. Has a breakout truly progressed, or should the base remain active?
4. Should overlapping pivots merge into one clean zone?
5. Where is the active Darvas box and danger level?
6. Has a pivot flipped from resistance to support?
7. Which lines should chart renderer draw?
8. Which price alerts should Aurora create?
9. Which VE2 volume state confirms or rejects the pivot?
```

---

# 2. Non-Negotiable Integration Rules

```text
BPX does not replace existing base math.
BPX does not replace RMV math.
BPX does not replace VE2.
BPX does not create new final buckets.
BPX does not create buy/sell commands.
BPX does not add intraday logic to Aurora core.
BPX does not override AURORA-X, PX, liquidity, Stage 4, or market regime gates.
```

Allowed outputs:

```text
diagnostic labels
setup_state
quality_notes
chart annotations
pivot fields
alert fields
score modifiers
renderer payload fields
```

Final bucket must remain one of Aurora’s locked buckets:

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

---

# 3. BPX / VE2 Separation Lock

This is the most important design rule.

```text
BPX identifies structure.
VE2 validates fuel.
```

BPX owns:

```text
base pivot
RMV pivot / RMVP
pivot zone
pivot merge
false breakout filter
Darvas box
danger level
support flip
trigger line
stop anchor
chart rendering fields
pivot alerts
```

VE2 owns:

```text
volume signatures
pocket pivots
reverse pocket pivots
HVE / HV1 / HVLE
dry-up signatures
accumulation / distribution
effort-vs-result
closing range interpretation
up/down volume ratio
average dollar volume
delivery confirmation for India where available
```

BPX must **consume VE2 outputs**, not recalculate them.

---

# 4. BPX Inputs

Required from existing Aurora engines:

```text
ticker
market
date
open
high
low
close
volume

ema10
ema20_21
sma50
sma150
sma200
ma10w
ma30w
ma40w

atr14_pct
adr20_pct
adr20_abs

base_type
base_start_idx
base_end_idx
base_duration_days
base_high
base_low
base_depth_pct
base_count_label

stage_label
stage_lifecycle
weekly_context_label
market_permission
px_label
aurora_x_label
rs_trifecta_label
rsnh_status
theme_tracker_label

rmv_source
rmv_active_lookback
rmv_value
rmv_tight_label
rmv_pivot_quality

avwap_levels
hvc_levels
gap_levels
```

VE2 inputs consumed by BPX:

```text
ve2_signature_label
ve2_volume_score
ve2_breakout_volume_ok
ve2_accumulation_signature
ve2_distribution_warning
ve2_dryup_signature
ve2_pocket_pivot_status
ve2_reverse_pocket_pivot_status
ve2_hve_status
ve2_hv1_status
ve2_effort_result_label
ve2_close_quality_label
ve2_ud_ratio_label
ve2_avg_dollar_volume_label
ve2_delivery_label
```

Fallback:

```text
If VE2 is UNKNOWN:
  BPX may still identify pivot structure.
  BPX cannot mark breakout as volume-confirmed.
  Candidate remains watch / trigger-ready depending on price structure, not confirmed breakout.
```

---

# 5. Structural BasePivot

## 5.1 Definition

A **Structural BasePivot** is the clean resistance/supply level derived from an already-detected base.

It is not always the absolute highest wick.

It should represent the level where repeated supply appears on the right side of the base.

---

## 5.2 Eligibility

Calculate Structural BasePivot when:

```text
base_duration_days >= 15
AND base_type in:
  FLAT_BASE
  CUP_HANDLE
  DOUBLE_BOTTOM
  VCP_BASE
  IPO_BASE
  BOTTOMING_BASE
  CONTINUATION_BASE
  BASE_ON_BASE
  HTF
```

Default settings:

```text
basepivot_lookback_default = 15
basepivot_lookback_alt = 17
```

Short consolidation mode:

```text
If base_duration_days < 15 but >= 5:
  do not call it Structural BasePivot.
  allow SHORT_FLAG_PIVOT or RMVP_ONLY.
```

---

## 5.3 Right-Side Pivot Window

Use the actionable right side of the base.

```python
base_len = base_end_idx - base_start_idx + 1

right_side_len = min(max(15, int(base_len * 0.45)), 35)

right_side_start_idx = base_end_idx - right_side_len + 1
right_side_end_idx = base_end_idx

right_side_highs = high[right_side_start_idx:right_side_end_idx + 1]
right_side_lows = low[right_side_start_idx:right_side_end_idx + 1]
right_side_closes = close[right_side_start_idx:right_side_end_idx + 1]
```

Reason:

```text
The actionable pivot should reflect the current right-side supply shelf,
not an old left-side wick that no longer defines current execution.
```

---

## 5.4 Pivot Tolerance

```python
pivot_tolerance_pct = max(
    1.0,
    0.25 * atr14_pct,
    0.20 * adr20_pct
)
```

Fallback:

```python
if atr14_pct is None and adr20_pct is None:
    pivot_tolerance_pct = 1.5
elif atr14_pct is None:
    pivot_tolerance_pct = max(1.0, 0.20 * adr20_pct)
elif adr20_pct is None:
    pivot_tolerance_pct = max(1.0, 0.25 * atr14_pct)
```

---

## 5.5 Local High Extraction

```python
def local_highs(series_high, left=2, right=2):
    result = []
    for i in range(left, len(series_high) - right):
        if series_high[i] >= max(series_high[i-left:i]) and series_high[i] >= max(series_high[i+1:i+right+1]):
            result.append((i, series_high[i]))
    return result
```

Candidate highs:

```python
candidate_highs = local_highs(right_side_highs)

if len(candidate_highs) < 2:
    candidate_highs = [(i, h) for i, h in enumerate(right_side_highs)]
```

---

## 5.6 Structural Pivot Calculation

```python
top_highs = top_values([h for _, h in candidate_highs], k=min(5, len(candidate_highs)))

cluster_anchor = median(top_highs)

aligned_highs = [
    h for _, h in candidate_highs
    if abs(h - cluster_anchor) / cluster_anchor * 100 <= pivot_tolerance_pct
]

if len(aligned_highs) >= 2:
    structural_base_pivot = max(aligned_highs)
    structural_pivot_zone_low = min(aligned_highs)
    structural_pivot_zone_high = max(aligned_highs)
else:
    structural_base_pivot = max(top_highs)
    structural_pivot_zone_low = structural_base_pivot * (1 - pivot_tolerance_pct / 100)
    structural_pivot_zone_high = structural_base_pivot
```

Interpretation:

```text
The pivot is the highest price inside the clustered resistance shelf.
The zone is the lower-to-upper boundary of that shelf.
```

---

# 6. BasePivot Quality

```text
BASEPIVOT_QUALITY_A:
  3+ aligned highs within tolerance
  AND base_duration_days >= 15
  AND base depth valid for base_type
  AND right side is orderly
  AND no VE2 distribution warning

BASEPIVOT_QUALITY_B:
  2 aligned highs within tolerance
  AND base_duration_days >= 15
  AND no major structural damage

BASEPIVOT_QUALITY_C:
  visible pivot but loose
  OR only 1 clean test
  OR right side has excess volatility

BASEPIVOT_QUALITY_NONE:
  no usable pivot
```

Right-side orderliness:

```python
right_side_range_pct = (
    max(right_side_highs) - min(right_side_lows)
) / mean(right_side_closes) * 100

right_side_orderly = (
    right_side_range_pct <= max(15, 1.5 * adr20_pct)
    and not ve2_distribution_warning
)
```

---

# 7. Base Remains Active After Weak Breakout

A key BPX rule:

```text
A base should not be retired just because price briefly poked above the pivot.
It should remain active until price makes real progress.
```

Breakout threshold settings:

```text
basepivot_breakout_threshold_mode = ADR | PERCENT
basepivot_breakout_threshold_adr_default = 2.0
basepivot_breakout_threshold_adr_strict = 2.5
basepivot_breakout_threshold_pct = configurable
```

ADR-based progress:

```python
breakout_attempt = close[t] > structural_base_pivot

breakout_progress_adr = (
    max(high[t:t+5]) - structural_base_pivot
) / adr20_abs[t]

base_remains_active = (
    breakout_attempt
    and breakout_progress_adr < basepivot_breakout_threshold_adr
    and any(close[j] <= structural_base_pivot for j in range(t + 1, min(t + 6, len(close))))
)
```

Labels:

```text
BASEPIVOT_ACTIVE_AFTER_WEAK_BREAKOUT
BASEPIVOT_FALSE_BREAK_FILTERED
BASEPIVOT_BREAKOUT_PROGRESS_CONFIRMED
```

Rule:

```text
If breakout does not advance by 2.0–2.5 ADR and price falls back into the same range,
keep the base active and keep rendering the same pivot.
```

---

# 8. Failed Probe / False Breakout Filter

## 8.1 Failed Probe

```python
failed_probe = (
    high[-1] > structural_base_pivot
    and close[-1] < structural_base_pivot
    and close_pos[-1] < 0.50
)
```

Label:

```text
BASEPIVOT_FAILED_PROBE
```

Action:

```text
Do not move pivot to the failed wick high.
Keep original clustered pivot.
If VE2 confirms distribution, cap candidate to REPAIR_WATCH or AVOID_FRESH_LONG depending on AURORA-X.
```

---

## 8.2 Failed Breakout

```python
failed_breakout = (
    close[t] > structural_base_pivot
    and breakout_progress_adr < basepivot_breakout_threshold_adr
    and any(close[j] < structural_base_pivot for j in range(t + 1, min(t + 6, len(close))))
)
```

Labels:

```text
BASEPIVOT_FALSE_BREAK_FILTERED
BASEPIVOT_FAKEOUT_REPAIR
```

Action:

```text
Keep structural pivot unchanged.
If support holds: REPAIR_WATCH or EARLY_ENTRY_WATCH.
If support fails with VE2 distribution: AVOID_FRESH_LONG.
```

---

# 9. BasePivot Merge Logic

Multiple nearby pivots should merge into one clean zone when they represent the same supply area.

```python
basepivot_merge_threshold_pct_default = 6.0
basepivot_merge_threshold_pct_tight = 2.0

def should_merge_basepivots(pivot_a, pivot_b, threshold_pct=6.0):
    return abs(pivot_a - pivot_b) / min(pivot_a, pivot_b) * 100 <= threshold_pct
```

Merged pivot:

```python
merged_structural_base_pivot = median([pivot_a, pivot_b])
merged_pivot_zone_low = min(zone_a_low, zone_b_low)
merged_pivot_zone_high = max(zone_a_high, zone_b_high)
```

Label:

```text
BASEPIVOT_MERGED_ZONE
```

Renderer rule:

```text
If merged zone exists, draw a band instead of multiple cluttered lines.
```

---

# 10. BasePivot Display Fields

Add to renderer payload:

```text
basepivot_price
basepivot_zone_low
basepivot_zone_high
basepivot_duration_days
basepivot_depth_pct
basepivot_depth_adr_units
basepivot_quality
basepivot_status
basepivot_merge_status
basepivot_false_breakout_status
```

Optional label controls:

```text
show_basepivot_price = true
show_basepivot_duration = chart_clean_mode != EXECUTION
show_basepivot_depth = chart_clean_mode == FULL_STUDY
```

Label suppression rule:

```text
Never suppress current actionable pivot price.
Suppress old historical duration/depth labels first.
Suppress old RMVP labels second.
```

---

# 11. ADR-Normalized Base Depth

Because different stocks have different volatility, Aurora should store both raw depth and ADR-normalized depth.

```python
base_depth_pct = (base_high - base_low) / base_high * 100
base_depth_adr_units = base_depth_pct / adr20_pct
```

Labels:

```text
BASE_DEPTH_NORMAL
BASE_DEPTH_HIGH_BUT_ADR_ACCEPTABLE
BASE_DEPTH_TOO_DEEP
```

Interpretation:

```text
A 25% base may be normal in a high-ADR momentum leader,
but too loose for a low-ADR megacap.
```

---

# 12. RMVP — Base-Aware RMV Pivot Layer

## 12.1 Definition

```text
RMVP = Relative Measured Volatility Pivot.
It identifies tighter, subtler pivot levels than Structural BasePivot.
```

Use cases:

```text
low-cheat entries
tight flags
early entries inside right side of base
post-breakout support-flip entries
event-coil entries
swing entries before official breakout
```

---

## 12.2 RMVP Uses Existing Aurora RMV Math

Do not replace Aurora’s RMV pivot math.

Aurora already has:

```text
pivot_window_min = 3
pivot_window_max = 7
pivot_tolerance_pct = max(1.0, 0.25 * atr14_pct)
recent_highs = last 3–7 bars
aligned highs within tolerance
rmv_range_high
rmv_range_low
rmv_pivot_price
rmv_stop_anchor
RMV_PIVOT_QUALITY_A/B/C/NONE
```

BPX only adds context:

```text
Is this RMVP inside a valid base?
Is it below the structural base pivot?
Is it near the official pivot?
Is it a post-breakout retest?
Should it be rendered?
Should it be merged with nearby RMVPs?
```

---

## 12.3 RMVP Context

```python
if valid_base_window_available and close[-1] <= structural_base_pivot * 1.03:
    rmvp_context = "INSIDE_BASE_RIGHT_SIDE"

elif prior_breakout and 1 <= bars_since_breakout <= 10:
    rmvp_context = "POST_BREAKOUT_RETEST"

elif event_gap_age_days is not None and event_gap_age_days <= 15:
    rmvp_context = "POST_EVENT_COIL"

else:
    rmvp_context = "STANDALONE_TIGHT_RANGE"
```

Labels:

```text
RMVP_BASE_AWARE
RMVP_STANDALONE_TIGHT_RANGE
RMVP_POST_BREAKOUT_RETEST
RMVP_POST_EVENT_COIL
```

---

## 12.4 RMVP Relationship to BasePivot

```python
rmvp_below_basepivot = rmv_pivot_price < structural_base_pivot

rmvp_to_basepivot_distance_pct = (
    (structural_base_pivot - rmv_pivot_price)
    / structural_base_pivot
    * 100
)
```

Labels:

```text
RMVP_LOW_CHEAT:
  rmvp_below_basepivot
  AND 1 <= rmvp_to_basepivot_distance_pct <= 8
  AND rmv_tight_label in {RMV_ZERO, RMV_VERY_TIGHT, RMV_TIGHT}
  AND no VE2 distribution warning

RMVP_NEAR_BASEPIVOT:
  abs(rmv_pivot_price - structural_base_pivot) / structural_base_pivot * 100 <= 2

RMVP_TOO_FAR_BELOW_BASEPIVOT:
  rmvp_to_basepivot_distance_pct > 8

RMVP_ABOVE_BASEPIVOT_RETEST:
  rmv_pivot_price > structural_base_pivot
  AND prior breakout exists
```

Interpretation:

```text
RMVP_LOW_CHEAT = early entry before official base breakout.
RMVP_NEAR_BASEPIVOT = pivot is close to official structural breakout.
RMVP_TOO_FAR_BELOW_BASEPIVOT = probably too early unless RS/theme/VE2 are exceptional.
RMVP_ABOVE_BASEPIVOT_RETEST = possible support-flip add point.
```

---

# 13. RMVP Display Count and Merge

## 13.1 Max Visible RMVPs

```text
rmvp_max_visible_default = 5
rmvp_max_visible_execution = 2
rmvp_max_visible_full_study = ALL
```

Renderer rule:

```text
DEFAULT mode: show last 5 RMVPs.
EXECUTION mode: show last 2 RMVPs.
FULL_STUDY mode: show all RMVPs.
```

---

## 13.2 RMVP Merge

```python
rmvp_merge_threshold_pct = max(1.0, 0.25 * atr14_pct)

rmvp_cluster = [
    p for p in rmvp_candidates
    if abs(p.price - anchor_price) / anchor_price * 100 <= rmvp_merge_threshold_pct
]

if len(rmvp_cluster) >= 2:
    merged_rmvp_price = median([p.price for p in rmvp_cluster])
    merged_rmvp_zone_low = min([p.zone_low for p in rmvp_cluster])
    merged_rmvp_zone_high = max([p.zone_high for p in rmvp_cluster])
```

Labels:

```text
RMVP_MERGED_KEY_LEVEL
RMVP_CLUSTER_LEVEL
RMVP_CLUSTER_DENSE
```

Interpretation:

```text
Multiple RMVPs around the same price indicate an important short-term supply/demand shelf.
Merge them in chart-clean mode.
```

---

# 14. RMVP + VE2 Integration

RMVP is early structure. It does not require full breakout volume immediately, but it must not trigger against distribution.

```python
rmvp_trigger_valid = (
    close[-1] > rmv_pivot_price
    and close_pos[-1] >= 0.60
    and not ve2_distribution_warning
    and (
        ve2_dryup_signature
        or ve2_pocket_pivot_status
        or ve2_accumulation_signature
        or ve2_breakout_volume_ok
    )
)
```

Labels:

```text
RMVP_LOW_CHEAT_CONFIRMED_BY_VE2
RMVP_DRYUP_BEFORE_TRIGGER
RMVP_POCKET_PIVOT_SUPPORT
RMVP_WEAK_VOLUME_WATCH
RMVP_DISTRIBUTION_REJECT
```

Final bucket mapping:

```text
RMVP_LOW_CHEAT + VE2 constructive + risk clean = EARLY_ENTRY_WATCH
RMVP trigger cleared + VE2 breakout ok = TRIGGER_READY
RMVP retest hold + MA/HVC/AVWAP confluence = PULLBACK_WATCH
RMVP break below range low + VE2 distribution = AVOID_FRESH_LONG or REPAIR_WATCH
```

---

# 15. BasePivot + VE2 Integration

BasePivot breakout confirmation requires VE2 fuel.

```python
basepivot_breakout_confirmed = (
    close[-1] > structural_base_pivot
    and close_pos[-1] >= 0.60
    and ve2_breakout_volume_ok
    and not ve2_distribution_warning
    and market_permission not in ["DEFENSE_MODE"]
    and px_label != "PX_HARD_WARNING"
    and aurora_x_label not in ["X3_HARD_BLOCK", "X4_STRUCTURAL_DAMAGE"]
)
```

Labels:

```text
BASEPIVOT_TRIGGER_READY
BASEPIVOT_BREAKOUT_CONFIRMED
BASEPIVOT_BREAKOUT_WEAK_VOLUME_WARNING
BASEPIVOT_BREAKOUT_DISTRIBUTION_WARNING
```

Rule:

```text
BASEPIVOT_TRIGGER_READY can exist without VE2 confirmation.
BASEPIVOT_BREAKOUT_CONFIRMED requires VE2 support.
```

---

# 16. Darvas Box Layer

## 16.1 Definition

Darvas Box is the active support/resistance room.

```text
BasePivot = broader structural supply line
Darvas Box = active range / current room
RMVP = tight early-entry shelf
```

---

## 16.2 Darvas Box Calculation

Use RMVP window if RMVP is active; otherwise use right-side base window.

```python
if rmvp_context in ["INSIDE_BASE_RIGHT_SIDE", "STANDALONE_TIGHT_RANGE"]:
    darvas_box_high = rmv_range_high
    darvas_box_low = rmv_range_low

elif structural_base_pivot is not None:
    darvas_box_high = structural_base_pivot
    darvas_box_low = min(right_side_lows)

else:
    darvas_box_high = None
    darvas_box_low = None
```

---

## 16.3 Darvas State

```text
DARVAS_CURRENT_BOX:
  price inside box

DARVAS_POSITIVE_BREAKOUT:
  close > darvas_box_high
  AND VE2 breakout confirmation

DARVAS_BREAKDOWN:
  close < darvas_box_low

DARVAS_DANGER_LEVEL_ACTIVE:
  danger level plotted below active box

EXPECTATION_BREAKER_ACTIVE:
  close < danger level
```

---

## 16.4 Darvas Breakout Requires VE2

```python
darvas_positive_breakout = (
    close[-1] > darvas_box_high
    and ve2_breakout_volume_ok
    and not ve2_distribution_warning
)
```

If price breaks box high but VE2 is weak:

```text
DARVAS_BREAKOUT_UNCONFIRMED
```

If price breaks below danger level with VE2 distribution:

```text
DARVAS_EXPECTATION_BREAKER_CONFIRMED_BY_VE2
```

---

# 17. Danger Level / Expectation Breaker

Danger level:

```python
danger_level = min(
    x for x in [
        rmv_range_low,
        darvas_box_low,
        recent_swing_low,
        ema20_21 if support_confluence else None,
        hvc_level if hvc_confluence else None,
        avwap_level if avwap_confluence else None
    ]
    if x is not None
)
```

Expectation breaker:

```python
expectation_breaker_active = (
    close[-1] < danger_level
    and close_pos[-1] < 0.50
)
```

Labels:

```text
DARVAS_DANGER_LEVEL_ACTIVE
EXPECTATION_BREAKER_ACTIVE
EXPECTATION_BREAKER_CONFIRMED_BY_VE2
```

Final bucket mapping:

```text
Low-volume undercut + reclaim = may remain EARLY_ENTRY_WATCH
Close below danger level + VE2 distribution = REPAIR_WATCH or AVOID_FRESH_LONG
Close below danger level + AURORA-X X3/X4 = AVOID_FRESH_LONG
```

---

# 18. Auto-AVWAP Anchor Enhancements

Aurora already has AVWAP. BPX adds anchor taxonomy and pivot interaction.

## 18.1 Source

Aurora canonical formula remains:

```text
AVWAP_TYPICAL_PRICE = (high + low + close) / 3
```

Optional compatibility mode:

```text
AVWAP_OHLC4_PROXY = (open + high + low + close) / 4
```

Use canonical unless explicitly marked proxy.

---

## 18.2 Auto Anchor Types

Add anchor labels:

```text
AVWAP_ANCHOR_MANUAL
AVWAP_ANCHOR_TOP_OF_BASE
AVWAP_ANCHOR_BOTTOM_OF_BASE
AVWAP_ANCHOR_SWING_HIGH
AVWAP_ANCHOR_SWING_LOW
AVWAP_ANCHOR_52W_HIGH
AVWAP_ANCHOR_52W_LOW
AVWAP_ANCHOR_YEAR_START
AVWAP_ANCHOR_HIGHEST_VOLUME_BAR
AVWAP_ANCHOR_LOWEST_RANGE_BAR
AVWAP_ANCHOR_RANGE_HIGH
AVWAP_ANCHOR_RANGE_LOW
AVWAP_ANCHOR_RVOL_SPIKE
AVWAP_ANCHOR_EARNINGS_GAP_PROXY
```

---

## 18.3 Swing Lookback

```text
avwap_swing_lookback_default = 3
avwap_swing_lookback_configurable = True
```

```python
swing_high_anchor = high[t] == max(high[t-lookback:t+lookback+1])
swing_low_anchor = low[t] == min(low[t-lookback:t+lookback+1])
```

---

## 18.4 RVOL Spike Anchor

RVOL spike can act as a proxy for a meaningful event/gap anchor.

```python
rvol_spike_anchor = (
    volume[t] / mean(volume[t-20:t]) >= 2.0
    and abs(close[t] - close[t-1]) / close[t-1] * 100 >= adr20_pct[t]
)
```

Labels:

```text
AVWAP_RVOL_SPIKE_ANCHOR
AVWAP_GAP_PROXY_ANCHOR
AVWAP_RECLAIM_AFTER_RVOL_SPIKE
AVWAP_RETEST_AFTER_RECLAIM
```

Interpretation:

```text
If price consolidates below RVOL-spike AVWAP, then reclaims it,
that can support a repair entry or early entry.
If price retests and holds that AVWAP, it becomes support-flip evidence.
```

---

# 19. Pivot Support Flip

A pivot becomes more valuable after breakout if it flips from resistance to support.

```python
pivot_zone_low = pivot_price * (1 - pivot_tolerance_pct / 100)
pivot_zone_high = pivot_price * (1 + pivot_tolerance_pct / 100)

retested_pivot = (
    low[-1] <= pivot_zone_high
    and close[-1] >= pivot_zone_low
)

held_pivot = close[-1] >= pivot_price

support_flip_valid = (
    prior_breakout
    and 1 <= bars_since_breakout <= 10
    and retested_pivot
    and held_pivot
    and not ve2_distribution_warning
)
```

Labels:

```text
BASEPIVOT_SUPPORT_FLIP
RMVP_SUPPORT_FLIP
AVWAP_SUPPORT_FLIP
SUPPORT_FLIP_CONFIRMED_BY_VE2
SUPPORT_FLIP_FAILED
```

Final bucket mapping:

```text
Support flip + MA/HVC/AVWAP confluence + VE2 constructive = PULLBACK_WATCH
Support flip failure + VE2 distribution = REPAIR_WATCH or AVOID_FRESH_LONG
```

---

# 20. High Tight Flag / Power Play Enhancement

Aurora already has HTF logic. BPX adds renderer and ADR-normalized interpretation.

## 20.1 HTF Fields

```text
htf_pole_gain_pct
htf_pole_days
htf_pole_angle
htf_flag_days
htf_flag_depth_pct
htf_flag_depth_adr_units
htf_flag_high
htf_flag_low
htf_flag_pivot
htf_flag_danger_level
```

## 20.2 HTF Classification

```text
HTF_PURE:
  pole gain >= 100%

HTF_IN_SPIRIT:
  pole gain >= 70–75%
  AND price/volume quality strong

HTF_FLAG_ADR_ACCEPTABLE:
  flag depth may be high in percent terms
  but acceptable relative to ADR

HTF_FLAG_TOO_LOOSE:
  flag depth excessive relative to ADR
```

ADR-normalized flag depth:

```python
htf_flag_depth_pct = (flag_high - flag_low) / flag_high * 100
htf_flag_depth_adr_units = htf_flag_depth_pct / adr20_pct
```

HTF breakout confirmation uses VE2:

```python
htf_breakout_confirmed = (
    close[-1] > htf_flag_high
    and close_pos[-1] >= 0.60
    and ve2_breakout_volume_ok
    and not ve2_distribution_warning
)
```

Labels:

```text
HTF_BREAKOUT_CONFIRMED_BY_VE2
HTF_BREAKOUT_WEAK_VOLUME_WARNING
HTF_BREAKOUT_DISTRIBUTION_REJECT
```

---

# 21. Alerts

Add generic pivot alert payloads.

```text
alert_level_type:
  BASEPIVOT
  RMVP
  DARVAS_HIGH
  DARVAS_DANGER
  AVWAP_RECLAIM
  SUPPORT_FLIP

alert_condition:
  CROSS_ABOVE
  CROSS_BELOW
  CLOSE_ABOVE
  CLOSE_BELOW
  RETEST_HOLD
  RETEST_FAIL

alert_timeframe:
  EOD
  FUTURE_INTRADAY

alert_priority:
  HIGH
  MEDIUM
  LOW
```

Alert examples:

```text
Alert when price closes above Structural BasePivot with VE2 confirmation.
Alert when price closes above RMVP low-cheat pivot.
Alert when price reclaims RVOL-spike AVWAP.
Alert when price breaks Darvas danger level.
Alert when prior pivot retest holds as support.
```

---

# 22. Chart Renderer Contract

Add these BPX fields to chart payload:

```text
structural_base_pivot
structural_pivot_zone_low
structural_pivot_zone_high
structural_pivot_quality
structural_pivot_status
basepivot_merge_status
basepivot_duration_days
basepivot_depth_pct
basepivot_depth_adr_units

rmvp_context
early_rmv_pivot
rmv_range_high
rmv_range_low
rmv_pivot_quality
rmvp_to_basepivot_distance_pct
rmvp_merge_status

darvas_box_high
darvas_box_low
danger_level
expectation_breaker_status

avwap_anchor_type
avwap_anchor_date
avwap_anchor_price
avwap_reclaim_status
avwap_retest_status

support_flip_status
false_probe_status
false_breakout_status
breakout_progress_adr
breakout_quality

trigger_price
alert_price
initial_stop
risk_pct
risk_bucket

chart_clean_mode
chart_annotation_priority

chart_volume_signature_source = VE2
chart_volume_signature_label
chart_volume_score
chart_breakout_volume_ok
chart_close_quality_label
chart_ud_ratio_label
chart_hve_status
```

---

# 23. Rendering Rules

```text
Structural BasePivot:
  Draw as thicker horizontal line.
  If merged zone exists, draw a band.

RMVP:
  Draw as shorter right-side horizontal line.
  If below Structural BasePivot, label as early pivot / low cheat.

Darvas Box:
  Blue/neutral = current box.
  Green = accepted breakout.
  Red = breakdown / danger-level violation.

Danger Level:
  Draw as dotted support / expectation-breaker line.

AVWAP:
  Draw only the active anchors relevant to current setup.
  Avoid cluttering all historical anchors.

Support Flip:
  After breakout and valid retest, change pivot role from resistance to support.
```

---

# 24. Chart Clean Modes

```text
DEFAULT:
  show active Structural BasePivot
  show last 5 RMVPs
  show active Darvas box
  show active danger level
  show relevant AVWAP only

EXECUTION:
  show active Structural BasePivot
  show last 2 RMVPs
  show current danger level
  show trigger, stop, and VE2 badge only
  suppress old labels

FULL_STUDY:
  show all pivots
  show duration/depth labels
  show historical Darvas boxes
  show AVWAP anchors
  show replay/study annotations
```

Suppression priority:

```text
1. Suppress old RMVP labels first.
2. Suppress old BasePivot duration/depth second.
3. Suppress old AVWAP anchors third.
4. Never suppress active trigger, stop, or danger level.
```

---

# 25. Score Integration

No new AURORA-SIG component.

BPX feeds existing components only.

## PatternScore

Positive inputs:

```text
BASEPIVOT_QUALITY_A
BASEPIVOT_MERGED_ZONE cleanly defined
RMVP_BASE_AWARE
DARVAS_CURRENT_BOX with tight range
HTF_FLAG_ADR_ACCEPTABLE
```

Negative inputs:

```text
BASEPIVOT_QUALITY_C
BASEPIVOT_FALSE_BREAK_FILTERED
RMVP_TOO_FAR_BELOW_BASEPIVOT
DARVAS_BREAKDOWN
```

## EntryScore

Positive inputs:

```text
RMVP_LOW_CHEAT_CONFIRMED_BY_VE2
BASEPIVOT_TRIGGER_READY
BASEPIVOT_BREAKOUT_CONFIRMED
SUPPORT_FLIP_CONFIRMED_BY_VE2
AVWAP_RECLAIM_AFTER_RVOL_SPIKE
```

## PullbackScore

Positive inputs:

```text
BASEPIVOT_SUPPORT_FLIP
RMVP_SUPPORT_FLIP
AVWAP_RETEST_AFTER_RECLAIM
pivot + 10 EMA / 20/21 EMA confluence
pivot + HVC / AVWAP confluence
```

## RiskScore

Positive inputs:

```text
danger_level clear
initial_stop clear
risk_pct 2–4 ideal
risk_pct <=7 acceptable
stop anchored below RMV range low / pivot zone / AVWAP / HVC
```

## VolumeScore

Do not calculate in BPX.

```text
Use VE2 volume_score only.
```

---

# 26. Final Bucket Mapping

BPX diagnostic labels map into existing buckets only.

```text
BASEPIVOT_TRIGGER_READY
+ price near pivot
+ market permission supportive
+ no hard PX/AURORA-X block
= TRIGGER_READY eligible

BASEPIVOT_BREAKOUT_CONFIRMED
+ VE2 breakout volume ok
+ close quality strong
= TRADE_READY or TRIGGER_READY depending scan type

RMVP_LOW_CHEAT_CONFIRMED_BY_VE2
+ risk clean
+ below official pivot
= EARLY_ENTRY_WATCH

RMVP_SUPPORT_FLIP
+ retest hold
+ MA/HVC/AVWAP confluence
= PULLBACK_WATCH

DARVAS_CURRENT_BOX
+ price inside box
+ near high
= EARLY_ENTRY_WATCH or RSNH_WATCH_ONLY

DARVAS_EXPECTATION_BREAKER_CONFIRMED_BY_VE2
= REPAIR_WATCH or AVOID_FRESH_LONG

BASEPIVOT_FALSE_BREAK_FILTERED
+ support still intact
= REPAIR_WATCH

BASEPIVOT_FALSE_BREAK_FILTERED
+ VE2 distribution
+ AURORA-X warning
= AVOID_FRESH_LONG
```

---

# 27. Examples

## 27.1 SNDK — Structural BasePivot

Observed pattern:

```text
Large structural pivot around 725.
Base annotation around 45 days and 29% depth.
```

Aurora BPX mapping:

```text
basepivot_price = 725
basepivot_duration_days = 45
basepivot_depth_pct = 29
basepivot_status = BASEPIVOT_TRIGGER_READY or BASEPIVOT_ACTIVE
basepivot_depth_adr_units = base_depth_pct / adr20_pct
```

Use this example to test:

```text
duration label
depth label
base remains active after weak breakout
pivot rendering
base top/bottom AVWAP anchor
```

---

## 27.2 BE — Multiple BasePivots + RVOL-Spike AVWAP

Observed pattern:

```text
Multiple base pivot levels:
119.90 — 22 days, -37%
147.86 — 57 days, -49%
180.90 — 33 days, -36%

RVOL-spike AVWAP:
price consolidated below it,
reclaimed it,
retested it,
then gapped up again.
```

Aurora BPX mapping:

```text
multi_basepivot_sequence = True
basepivot_merge_review = True
avwap_anchor_type = AVWAP_ANCHOR_RVOL_SPIKE
avwap_status = AVWAP_RECLAIM_AFTER_RVOL_SPIKE
support_flip_status = AVWAP_RETEST_AFTER_RECLAIM
```

Use this example to test:

```text
multiple pivot handling
merge / non-merge logic
RVOL-spike AVWAP anchor
AVWAP reclaim
AVWAP retest support flip
```

---

## 27.3 FCEL — HTF / Power Play

Observed pattern:

```text
Pole: about 23 days, +131.6%, steep angle.
Flag: about 6 days, 18% consolidation.
Volume: HVE / very high relative volume.
```

Aurora BPX mapping:

```text
htf_pole_gain_pct = 131.6
htf_pole_days = 23
htf_flag_days = 6
htf_flag_depth_pct = 18
htf_flag_depth_adr_units = htf_flag_depth_pct / adr20_pct
htf_volume_status = VE2_HVE or VE2_BREAKOUT_VOLUME_OK
```

Use this example to test:

```text
HTF_PURE
HTF_FLAG_ADR_ACCEPTABLE
VE2 breakout confirmation
pole/flag rendering
HTF danger level
```

---

## 27.4 GOOG-Type Repair Setup

Observed structure:

```text
Lower reclaim pivot.
Higher structural pivot.
Price below official pivot but attempting to reclaim lower shelf.
```

Aurora BPX mapping:

```text
base_type = BOTTOMING_BASE or REPAIR_BASE
structural_base_pivot = higher supply shelf
early_rmv_pivot = lower reclaim shelf
rmvp_context = INSIDE_BASE_RIGHT_SIDE or STANDALONE_TIGHT_RANGE
setup_state = REPAIR_WATCH moving to EARLY_ENTRY_WATCH after reclaim
```

Renderer:

```text
Draw lower RMVP as early reclaim line.
Draw higher BasePivot as official structural line.
Danger level = recent repair range low.
```

---

## 27.5 DDOG / CRWD-Type Stage 2 Continuation

Observed structure:

```text
Prior power move.
Controlled pullback.
Right-side shelf near 10/20/21 EMA.
RMV compression.
```

Aurora BPX mapping:

```text
base_type = CONTINUATION_BASE or SHORT_STAGE2_SHELF
structural_base_pivot = prior shelf high if 15+ bars
rmvp_context = INSIDE_BASE_RIGHT_SIDE
rmvp_label = RMVP_LOW_CHEAT or RMVP_NEAR_BASEPIVOT
final_bucket = EARLY_ENTRY_WATCH or TRIGGER_READY depending price/VE2
```

---

# 28. Tests Required

## Preservation Tests

```text
Existing base detection unchanged.
Existing RMV pivot math unchanged.
Existing VE2 volume logic unchanged.
Final bucket taxonomy unchanged.
No BPX diagnostic label appears as final_bucket.
```

## BasePivot Tests

```text
15+ day base creates Structural BasePivot.
5–14 day consolidation creates SHORT_FLAG_PIVOT or RMVP_ONLY, not Structural BasePivot.
3 aligned highs -> BASEPIVOT_QUALITY_A.
2 aligned highs -> BASEPIVOT_QUALITY_B.
single loose high -> BASEPIVOT_QUALITY_C or NONE.
failed wick above pivot does not move pivot higher.
```

## Breakout Progress Tests

```text
Breakout <2 ADR and falls back -> BASEPIVOT_ACTIVE_AFTER_WEAK_BREAKOUT.
Breakout >=2 ADR and holds -> BASEPIVOT_BREAKOUT_PROGRESS_CONFIRMED.
2.5 ADR strict mode reduces false confirmations.
```

## Merge Tests

```text
Structural pivots within 6% merge.
Structural pivots beyond 6% do not merge.
RMVP merge uses tighter ATR/ADR tolerance.
```

## VE2 Integration Tests

```text
BPX does not calculate volume signatures.
BASEPIVOT_BREAKOUT_CONFIRMED requires ve2_breakout_volume_ok.
RMVP trigger rejects ve2_distribution_warning.
Darvas breakout without VE2 confirmation remains DARVAS_BREAKOUT_UNCONFIRMED.
```

## Renderer Tests

```text
Structural BasePivot draws thick line or zone.
RMVP draws shorter right-side line.
Danger level draws dotted support line.
Support flip changes pivot role from resistance to support.
Chart-clean mode suppresses old labels but preserves active trigger/stop/danger.
```

## Replay Tests

```text
Replay known winners and failed setups.
Validate pivot stayed active after weak breakout.
Validate RMVP low-cheat before official pivot.
Validate Darvas danger-level failure.
Validate RVOL-spike AVWAP reclaim/retest.
```

---

# 29. Implementation Order

```text
1. Add BPX candidate fields.
2. Add Structural BasePivot extraction using existing base windows.
3. Add breakout-progress / base-remains-active logic.
4. Add pivot merge logic.
5. Add base-aware RMVP classification without changing RMV core.
6. Add Darvas box + danger level fields.
7. Add Auto-AVWAP anchor taxonomy.
8. Wire BPX to VE2 output fields.
9. Add renderer payload fields.
10. Add alert payloads.
11. Add tests.
12. Run regression across US, India, Canada.
```

---

# 30. Final Rule

```text
BPX improves structure.
VE2 validates fuel.
AURORA decides final bucket.

Best BPX candidate =
  valid Aurora setup
  + clean BasePivot or RMVP
  + tight RMV or constructive right-side shelf
  + RS strong or improving
  + market permission supportive
  + VE2 not distribution
  + clear trigger
  + clear danger level / stop
  + acceptable risk
  + no hard PX/AURORA-X block
```
