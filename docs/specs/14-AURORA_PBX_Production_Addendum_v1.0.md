# AURORA-PBX Production Addendum v1.0
## Power Pullback Execution Engine

**Status:** Production-grade reference record — merged into AURORA v2.18.3 consolidated master  
**Scope:** EOD scanner enhancement only  
**Markets:** US, India, Canada  
**Purpose:** Rank and qualify power pullbacks in institutional-quality leaders without changing the locked AURORA final-bucket taxonomy.

---

# 1. Core Design Intent

PBX is the **pullback quality engine**. It answers:

```text
Which pullback is worth buying?
Has the pullback taken enough time?
Is it deep enough to matter, but not damaged?
Which moving average character is being respected?
Is there an upside reversal / support reclaim?
Is the market forgiving enough for pullback buying?
Are recent pullback signals working or failing?
```

PBX is inspired by the power-pullback workflow captured in the uploaded video notes: buy momentary weakness in fundamentally strong, institutional-quality leaders during a strong/forgiving bull market; prefer upside reversals at 10d/21d/50d or prior-resistance support; use the reversal low or weekly 50-day failure as invalidation; avoid the method when repeated pullback attempts fail.

---

# 2. Non-Negotiable Production Locks

```text
PBX does not create buy/sell commands.
PBX does not create final buckets.
PBX does not override AURORA-X, Stage 4, liquidity, PX, AXM, or market permission.
PBX is EOD-compatible; real-time scaling into falling support remains future AURORA-INTRADAY scope.
PBX consumes VE2, BPX, AXM, MA Character, MTF, RS, Theme, and Fundamental/Quality fields.
PBX improves PullbackScore, EntryScore, RiskScore, ExtensionSafetyScore, setup_state, quality_notes, watchlist_action, and ranking.
```

---

# 3. Required Inputs

```text
ticker, market, date
open, high, low, close, volume
ema10, ema20_21, sma50, sma150, sma200
ma10w, ma30w, ma40w
atr14, atr14_pct, adr20_pct, adr20_abs
recent_swing_high, recent_swing_high_date
recent_swing_low, recent_swing_low_date
show_of_power_pct, show_of_power_label
weekly_context_label, stage_label, stage_lifecycle
market_permission, market_dimmer
rs_trifecta_label, rsnh_status, mansfield_rs_state
theme_tracker_label, rrg_state
ve2_status, ve2_dryup_label, ve2_pullback_volume_label, ve2_distribution_warning, ve2_turnup_label
bpx_support_levels, rmvp_support_flip, basepivot_support_flip, avwap_levels, hvc_levels
axm10_value, axm21_value, axm50_value, axm labels
fundamental_quality_label, institutional_ownership_proxy where available
```

Fallback:

```text
If OHLCV exists but sponsorship/fundamental fields are missing, PBX may calculate technical pullback quality but IDS becomes UNKNOWN.
If VE2 is UNKNOWN, PBX cannot mark volume-confirmed pullback; it remains watch/partial.
If market_permission is UNKNOWN, PBX cannot promote to Daily Top 1-4.
```

---

# 4. Pullback Context Eligibility

PBX only evaluates long pullbacks when:

```text
market_permission in {TRADE_ALLOWED, SELECTIVE_ONLY, TRANSITION_MODE}
AND weekly_context_label in {WEEKLY_CONTEXT_STRONG, WEEKLY_CONTEXT_OK}
AND stage_label not in {STAGE_4}
AND liquidity_label != LIQUIDITY_FAIL
AND AURORA-X not in {X3_HARD_BLOCK, X4_STRUCTURAL_DAMAGE}
```

Aggression control:

```text
TRADE_ALLOWED      => normal PBX ranking allowed.
SELECTIVE_ONLY     => require RS/theme leadership and clean risk.
TRANSITION_MODE    => pilot/watch only; no aggressive pullback ranking.
WATCHLIST_ONLY     => PBX can display but cannot promote to execution tiers.
DEFENSE_MODE       => PBX is disabled except for holding review / repair notes.
```

---

# 5. Pullback Depth Model

Formula:

```python
pullback_depth_pct = (recent_swing_high - close[-1]) / recent_swing_high * 100
```

Labels:

```text
PULLBACK_DEPTH_TOO_SHALLOW = pullback_depth_pct < 8
PULLBACK_DEPTH_VALID       = 8 <= pullback_depth_pct < 15
PULLBACK_DEPTH_IDEAL       = 15 <= pullback_depth_pct <= 20
PULLBACK_DEPTH_DEEP        = 20 < pullback_depth_pct <= 30
PULLBACK_DEPTH_EXCESSIVE   = pullback_depth_pct > 30
```

Score effect:

```text
PULLBACK_DEPTH_IDEAL       => +2 PullbackScore
PULLBACK_DEPTH_VALID       => +1 PullbackScore
PULLBACK_DEPTH_TOO_SHALLOW => 0; may be 10EMA momentum pullback only
PULLBACK_DEPTH_DEEP        => -1 unless IDS strong and support confluence holds
PULLBACK_DEPTH_EXCESSIVE   => cap at REPAIR_WATCH unless strong reclaim/VE2 support appears
```

---

# 6. Pullback Duration Model

Formula:

```python
pullback_duration_days = trading_days_between(recent_swing_high_date, current_date)
```

Labels:

```text
PULLBACK_TOO_FAST = 1 <= pullback_duration_days <= 2
PULLBACK_NORMAL   = 3 <= pullback_duration_days <= 8
PULLBACK_MATURE   = 9 <= pullback_duration_days <= 15
PULLBACK_STALE    = pullback_duration_days > 15
```

Interpretation:

```text
Too-fast pullbacks are often simple dips, not true shakeouts.
Normal/mature pullbacks provide better evidence of supply digestion.
Stale pullbacks require fresh tightening, RMVP, or reclaim evidence.
```

---

# 7. Moving Average Touch Profile

PBX must not hard-code the pullback model around only the 50SMA. Many elite growth leaders respect the 10EMA or 20/21EMA for months before touching the 50SMA.

Touch detection:

```python
def touched_ma(low, close, ma, tolerance_pct):
    return low[-1] <= ma[-1] * (1 + tolerance_pct/100) and close[-1] >= ma[-1] * (1 - tolerance_pct/100)

touch_10ema = touched_ma(low, close, ema10, max(1.0, 0.25 * atr14_pct))
touch_21ema = touched_ma(low, close, ema20_21, max(1.0, 0.25 * atr14_pct))
touch_50sma = touched_ma(low, close, sma50, max(1.0, 0.25 * atr14_pct))
```

Touch-count fields:

```text
touch_count_10ema_since_power
touch_count_21ema_since_power
touch_count_50sma_since_power
touch_count_10ema_since_breakout
touch_count_21ema_since_breakout
touch_count_50sma_since_breakout
```

Labels:

```text
PBX_FIRST_10EMA_TOUCH
PBX_FIRST_21EMA_TOUCH
PBX_FIRST_50SMA_TOUCH
PBX_REPEATED_10EMA_RESPECT
PBX_REPEATED_21EMA_RESPECT
PBX_REPEATED_50SMA_RESPECT
PBX_10EMA_LOSS_TO_21EMA_WATCH
PBX_21EMA_LOSS_TO_50SMA_WATCH
PBX_50SMA_STRUCTURAL_TEST
PBX_FAILED_MA_TOUCH
```

Interpretation:

```text
10EMA touch  = very strong momentum leader; shallow pullback.
21EMA touch  = normal growth-stock swing pullback; often most important for Aurora.
50SMA touch  = deeper institutional trend pullback; strongest only if weekly context remains intact.
```

---

# 8. MA Character Alignment

PBX must use AURORA-MA Character before scoring a touch.

```text
If ma_character_primary == 10EMA:
    10EMA touch/reclaim receives highest support weight.
If ma_character_primary == 21EMA:
    21EMA pullback is preferred.
If ma_character_primary == 50SMA:
    50SMA first touch is important.
If MA_CHARACTER_CHANGE is active:
    reduce PBX score until support behavior stabilizes.
```

---

# 9. Upside Reversal Quality

EOD formula:

```python
close_pos = (close[-1] - low[-1]) / max(high[-1] - low[-1], small_number)

pbx_upside_reversal = (
    low[-1] < low[-2]
    and close[-1] > close[-2]
    and close_pos >= 0.60
)

pbx_strong_upside_reversal = (
    pbx_upside_reversal
    and close_pos >= 0.75
    and (rvol_20d >= 1.2 or ve2_turnup_label in {VE2_PULLBACK_TURNUP_CONFIRMED, VE2_PULLBACK_TURNUP_STRONG})
)
```

Labels:

```text
PBX_UPSIDE_REVERSAL_VALID
PBX_UPSIDE_REVERSAL_STRONG
PBX_UPSIDE_REVERSAL_WEAK
PBX_DOUBLE_UPSIDE_REVERSAL
PBX_NO_REVERSAL_YET
```

Invalidation:

```text
pbx_reversal_low = low_of_reversal_day
pbx_invalidation = close below pbx_reversal_low
```

Intraday-low stop triggering remains future scope; EOD scanner stores the line and validates EOD breach/reclaim.

---

# 10. Weekly 50SMA Shakeout Recovery

Purpose: avoid downgrading a leader too early when it undercuts 50SMA mid-week but recovers by Friday.

Formula:

```python
weekly_close_position = (weekly_close - weekly_low) / max(weekly_high - weekly_low, small_number)

pbx_50sma_weekly_recovery = (
    weekly_low < sma50_weekly_equiv
    and weekly_close >= sma50_weekly_equiv
    and weekly_close_position >= 0.40
)

pbx_50sma_weekly_failure = (
    weekly_close < sma50_weekly_equiv
    and weekly_close_position < 0.40
)
```

Labels:

```text
PBX_50SMA_MIDWEEK_SHAKEOUT
PBX_50SMA_WEEKLY_RECOVERY
PBX_50SMA_WEEKLY_FAILURE
```

Mapping:

```text
PBX_50SMA_WEEKLY_RECOVERY + VE2 not distribution => PULLBACK_WATCH / REPAIR_WATCH improving.
PBX_50SMA_WEEKLY_FAILURE + VE2 distribution => REPAIR_WATCH or AVOID_FRESH_LONG.
```

---

# 11. Prior Resistance / BasePivot Retest Pullback

PBX consumes BPX support fields:

```text
basepivot_support_flip
rmvp_support_flip
avwap_retest_after_reclaim
hvc_support_hold
prior_resistance_now_support
```

Labels:

```text
PBX_PRIOR_RESISTANCE_RETEST
PBX_BPX_SUPPORT_FLIP_PULLBACK
PBX_AVWAP_HVC_CONFLUENCE_PULLBACK
PBX_RETEST_FAILED
```

---

# 12. Pullback Failure Cluster

This is a market-feedback layer.

Formula:

```python
pullback_failure_rate_20 = failed_pbx_signals_last20 / max(total_pbx_signals_last20, 1)
pullback_success_rate_20 = successful_pbx_signals_last20 / max(total_pbx_signals_last20, 1)
```

Labels:

```text
PBX_ENVIRONMENT_HEALTHY = pullback_failure_rate_20 < 0.30
PBX_ENVIRONMENT_MIXED   = 0.30 <= pullback_failure_rate_20 <= 0.50
PBX_ENVIRONMENT_HOSTILE = pullback_failure_rate_20 > 0.50
```

Effect:

```text
HOSTILE: cap fresh pullback candidates at PULLBACK_WATCH or RSNH_WATCH_ONLY.
MIXED: require SELECTIVE_ONLY treatment; only strongest RS/theme names promoted.
HEALTHY: normal PBX scoring.
```

---

# 13. Institutional Defense Score

Purpose: estimate whether institutions are likely to defend the pullback.

```text
INSTITUTIONAL_DEFENSE_SCORE = 0-10
```

Inputs:

```text
RS strength / RSNH
Theme/RRG leadership
Fundamental quality
Liquidity/institutional dollar volume
Prior demand from VE2
Ownership/sponsorship/delivery where reliable
Earnings growth / PEAD / EP quality where applicable
```

Scoring:

```text
IDS_STRONG = 8-10
IDS_VALID  = 5-7
IDS_THIN   = 3-4
IDS_WEAK   = 0-2
IDS_UNKNOWN = insufficient external data
```

Effect:

```text
IDS_STRONG allows deeper pullbacks to remain watchable if support holds.
IDS_WEAK blocks aggressive pullback ranking even if technical bounce appears.
IDS_UNKNOWN does not block by itself but caps conviction notes.
```

---

# 14. PBX Composite Score

```text
PBX_Score = 0-20
```

| Factor | Points |
|---|---:|
| Market permission / PBX environment | 0-3 |
| Weekly context / Stage 2 integrity | 0-3 |
| Pullback depth | 0-3 |
| Pullback duration | 0-2 |
| MA character touch/reclaim | 0-3 |
| VE2 volume control / turn-up | 0-2 |
| BPX/HVC/AVWAP support confluence | 0-2 |
| IDS / RS / theme support | 0-2 |

Interpretation:

```text
PBX 16-20 = PBX_IDEAL_PULLBACK
PBX 12-15 = PBX_VALID_PULLBACK
PBX 8-11  = PBX_WATCH_PULLBACK
PBX < 8   = PBX_LOW_QUALITY_PULLBACK
```

---

# 15. Bucket Mapping

```text
PBX_IDEAL_PULLBACK + trigger/reversal confirmed + risk clean = TRIGGER_READY eligible
PBX_IDEAL_PULLBACK but waiting reversal/trigger = PULLBACK_WATCH
PBX_FIRST_21EMA_TOUCH + VE2 controlled + RS strong = PULLBACK_WATCH / TRIGGER_READY
PBX_FIRST_50SMA_TOUCH + weekly recovery + VE2 not distribution = PULLBACK_WATCH
PBX_ENVIRONMENT_HOSTILE = cap at RSNH_WATCH_ONLY / PULLBACK_WATCH
PBX_WEEKLY_50SMA_FAILURE = REPAIR_WATCH
PBX_HEAVY_SELLING_WARNING = REPAIR_WATCH or AVOID_FRESH_LONG
```

---

# 16. Renderer / Dashboard Fields

```text
pbx_score
pbx_label
pullback_depth_pct
pullback_depth_label
pullback_duration_days
pullback_duration_label
ma_touch_profile
ma_character_alignment
pbx_reversal_label
pbx_reversal_low
pbx_weekly_shakeout_label
pbx_environment_label
institutional_defense_score
pbx_support_confluence_notes
```

---

# 17. Backtesting Requirements

```text
Test PBX separately for 10EMA, 21EMA, and 50SMA pullback families.
Use completed EOD bars only.
Do not count intraday stop behavior unless intraday module exists.
Record MFE/MAE after PBX signal at 5, 10, 15, 20 sessions.
Test PBX_ENVIRONMENT_HOSTILE as a market-level throttle.
Compare PBX results with and without IDS to avoid data-source bias.
```

---

# 18. Production Test Cases

```text
1. First 21EMA touch after Show of Power scores higher than third 21EMA touch.
2. First 50SMA touch does not outrank 21EMA touch if stock's MA character is 21EMA.
3. PULLBACK_DEPTH_EXCESSIVE cannot become TRIGGER_READY without reclaim and VE2 support.
4. PULLBACK_TOO_FAST cannot be Daily Top 1-4 unless RMVP/VE2/RS are exceptional.
5. PBX_WEEKLY_50SMA_RECOVERY blocks premature removal.
6. PBX_ENVIRONMENT_HOSTILE caps pullback aggressiveness.
7. IDS_UNKNOWN does not fabricate sponsorship; it marks conviction partial.
8. PBX never appears in final_bucket.
```
