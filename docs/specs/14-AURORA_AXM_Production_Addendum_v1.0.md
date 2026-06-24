# AURORA-AXM Production Addendum v1.0
## ATR Extension Matrix Engine

**Status:** Production-grade reference record — merged into AURORA v2.18.3 consolidated master  
**Scope:** EOD scanner enhancement only  
**Markets:** US, India, Canada  
**Purpose:** Normalize extension from key moving averages using ATR so Aurora can distinguish healthy momentum from dangerous chase risk.

---

# 1. Core Design Intent

AXM is the **extension engine**. It answers:

```text
Is the stock too extended to buy now?
Which moving average is likely to act as next support?
Is this a short-term heat issue or a structural overextension issue?
Should Aurora wait for a 10EMA, 21EMA, or 50SMA pullback?
Should ExtensionSafetyScore be reduced?
Should the candidate be capped at NO_CHASE / PROTECT_PROFIT_REVIEW?
```

Mental model:

```text
AXM10  = How hot is price right now?
AXM21  = Is this still buyable for a swing entry?
AXM50  = How far is price from institutional trend support?
AXM200 = How stretched is the long-term cycle?
```

---

# 2. Non-Negotiable Production Locks

```text
AXM does not create buy signals.
AXM does not create final buckets by itself.
AXM is not RSI and must never be confused with AURORA RS.
AXM uses validated EOD OHLCV and ATR only.
AXM feeds ExtensionSafetyScore, RiskScore, PullbackScore, quality_notes, watchlist_action, and renderer fields.
AXM may cap entries through existing PX/NO_CHASE logic when extension is extreme.
```

---

# 3. Required Inputs

```text
open, high, low, close
ema10
ema20_21
sma50
sma200
atr14
atr14_pct
ma slopes
stage_label
weekly_context_label
px_label
pullback/support fields from PBX/BPX
```

Data requirements:

```text
At least 50 valid daily bars for AXM50.
At least 200 valid daily bars for AXM200.
ATR requires sufficient high/low/close bars; if ATR unavailable, AXM = UNKNOWN.
Do not blend providers within AXM series.
```

---

# 4. Core Formula

```python
atr14 = ATR(14)

axm10  = (close[-1] - ema10[-1]) / atr14[-1]
axm21  = (close[-1] - ema20_21[-1]) / atr14[-1]
axm50  = (close[-1] - sma50[-1]) / atr14[-1]
axm200 = (close[-1] - sma200[-1]) / atr14[-1]
```

Store both signed and absolute values:

```text
axm10_value
axm21_value
axm50_value
axm200_value
axm10_abs
axm21_abs
axm50_abs
axm200_abs
```

Interpretation:

```text
Positive AXM = price above moving average.
Negative AXM = price below moving average.
Large positive AXM = extension/chase risk.
Large negative AXM = downside dislocation/repair risk, not automatic bargain.
```

---

# 5. AXM10 — Momentum Heat Model

Question:

```text
How hot is price right now?
```

Default thresholds:

```text
AXM10_NORMAL   = 0.0 <= axm10 < 1.0
AXM10_STRONG   = 1.0 <= axm10 < 2.0
AXM10_HOT      = 2.0 <= axm10 < 3.0
AXM10_VERY_HOT = axm10 >= 3.0
AXM10_BELOW    = axm10 < 0
```

Meaning:

```text
HOT is not bearish.
HOT means near-term digestion/pullback probability is elevated.
For new entries, prefer a 10EMA test, tight shelf, or RMVP retest.
```

---

# 6. AXM21 — Swing Extension Model

Question:

```text
Can I still initiate a swing position?
```

Default thresholds:

```text
AXM21_NORMAL   = 0.0 <= axm21 < 1.5
AXM21_EXTENDED = 1.5 <= axm21 < 3.0
AXM21_HOT      = 3.0 <= axm21 < 4.0
AXM21_EXTREME  = axm21 >= 4.0
AXM21_BELOW    = axm21 < 0
```

Meaning:

```text
AXM21_EXTREME usually means avoid fresh swing entries.
Wait for a 21EMA pullback, RMVP retest, BasePivot support flip, or new tight shelf.
```

---

# 7. AXM50 — Institutional Trend Extension Model

Question:

```text
How far is price from institutional trend support?
```

Default thresholds:

```text
AXM50_NORMAL        = 0.0 <= axm50 < 2.5
AXM50_EXTENDED      = 2.5 <= axm50 < 5.0
AXM50_VERY_EXTENDED = 5.0 <= axm50 < 7.5
AXM50_EXTREME       = axm50 >= 7.5
AXM50_BELOW         = axm50 < 0
```

Meaning:

```text
AXM50_EXTREME is rare and often requires consolidation, base building, or mean reversion before new entries become high quality.
It is a major no-chase/profit-protection input.
```

---

# 8. AXM200 — Long-Term Structural Extension

Question:

```text
How far is price from the long-term trend?
```

Default thresholds:

```text
AXM200_NORMAL        = 0.0 <= axm200 < 5.0
AXM200_EXTENDED      = 5.0 <= axm200 < 10.0
AXM200_VERY_EXTENDED = 10.0 <= axm200 < 15.0
AXM200_EXTREME       = axm200 >= 15.0
AXM200_BELOW         = axm200 < 0
```

Meaning:

```text
AXM200 is a cycle-maturity and bubble/mania context tool.
It should influence position caution and profit-protection notes more than short-term entry timing.
```

---

# 9. Multi-Anchor Extension Matrix

AXM should not look at one anchor in isolation.

Composite labels:

```text
AXM_SHORT_TERM_HEAT:
  AXM10_HOT or AXM10_VERY_HOT
  AND AXM21_NORMAL
  AND AXM50_NORMAL

AXM_SWING_CHASE_RISK:
  AXM21_HOT or AXM21_EXTREME
  AND AXM50 not EXTREME

AXM_STRUCTURAL_CHASE_RISK:
  AXM50_VERY_EXTENDED or AXM50_EXTREME

AXM_MULTI_ANCHOR_STRETCH:
  two or more of AXM10_HOT/VERY_HOT, AXM21_HOT/EXTREME, AXM50_VERY_EXTENDED/EXTREME are active

AXM_CLIMAX_DANGER:
  AXM10_VERY_HOT
  AND AXM21_EXTREME
  AND AXM50_EXTREME
  AND VE2_CLIMAX_VOLUME_WARNING or weak close
```

---

# 10. Likely Pullback Target Forecast

```python
likely_pullback_targets = []

if axm10 >= 2.0:
    likely_pullback_targets.append('10EMA')
if axm21 >= 3.0:
    likely_pullback_targets.append('21EMA')
if axm50 >= 5.0:
    likely_pullback_targets.append('50SMA')
```

Priority:

```text
Nearest valid rising support first.
If the nearer support is declining or already broken, use the next deeper support.
If MA Character says 21EMA is primary, prioritize 21EMA over 10EMA noise.
If AXM50_EXTREME, expect deeper digestion even if 10EMA/21EMA hold initially.
```

---

# 11. Integration With PX

AXM becomes a primary input to PX/ExtensionSafety.

```text
AXM10_VERY_HOT => PX_EXHAUSTION_WATCH candidate note
AXM21_EXTREME  => PX_NO_CHASE unless BPX/PBX setup has already reset extension
AXM50_EXTREME  => PX_HARD_WARNING / NO_CHASE / PROTECT_PROFIT_REVIEW depending context
AXM_CLIMAX_DANGER + VE2 weak close => AURORA-X review
```

AXM cannot override hard support/reclaim evidence by itself; it can cap chase entries.

---

# 12. Integration With PBX

```text
If AXM21_EXTREME and no pullback yet:
  PBX waits for 21EMA/RMVP/BasePivot retest.

If AXM21_NORMAL and AXM50_NORMAL after a pullback:
  PBX quality improves because extension reset has occurred.

If AXM50_EXTREME even after a shallow 10EMA pullback:
  PBX treats the setup as structurally extended.
```

---

# 13. Integration With BPX

```text
BPX pivot breakout while AXM21/AXM50 are extreme:
  confirm pivot but cap chase quality unless risk is tight and VE2 confirms.

BPX support flip after AXM reset:
  higher-quality pullback/retest candidate.

Darvas box after AXM50_EXTREME:
  base-building/profit-protection context until compression resets.
```

---

# 14. AURORA-SIG Effects

AXM does not add an 11th SIG component.

```text
ExtensionSafetyScore:
  AXM all normal/reset = 5/5
  AXM21 hot only = 3-4/5
  AXM21 extreme or AXM50 very extended = 1-2/5
  AXM50 extreme or AXM climax danger = 0/5

RiskScore:
  Reduce when AXM extension makes stop too wide or invalidation unclear.

PullbackScore:
  Improve when AXM shows extension has reset into support.
```

---

# 15. Renderer / Dashboard Fields

```text
axm10_value
axm10_label
axm21_value
axm21_label
axm50_value
axm50_label
axm200_value
axm200_label
axm_composite_label
likely_pullback_target
extension_safety_note
```

Example display:

```text
ATR Extension Matrix
10 EMA: 2.4 ATR — HOT
21 EMA: 3.2 ATR — HOT
50 SMA: 6.1 ATR — VERY EXTENDED
Summary: Momentum hot; swing entry low quality; structural trend healthy but extended; wait for 21EMA/RMVP pullback.
```

---

# 16. Future v1.1 Calibration

Static thresholds are the production default, but later Aurora may calibrate per market and per stock.

```python
axm21_mean = rolling_or_universe_mean(axm21_history)
axm21_std = rolling_or_universe_std(axm21_history)
axm21_sigma = (axm21_current - axm21_mean) / axm21_std
```

Future labels:

```text
AXM21_1SIGMA
AXM21_2SIGMA
AXM21_3SIGMA
AXM50_1SIGMA
AXM50_2SIGMA
AXM50_3SIGMA
```

Do not activate sigma labels without history sufficiency and tests.

---

# 17. Production Test Cases

```text
1. AXM cannot calculate if ATR14 is missing.
2. AXM200 requires enough history; otherwise AXM200_UNKNOWN, not zero.
3. AXM21_EXTREME caps fresh swing entries unless PBX/BPX show reset/retest.
4. AXM50_EXTREME maps to PX_HARD_WARNING/NO_CHASE but not AVOID_FRESH_LONG by itself.
5. AXM_MULTI_ANCHOR_STRETCH appears only when at least two anchors are stretched.
6. Negative AXM does not mean bargain; it means below MA / repair context.
7. AXM does not change final_bucket taxonomy.
8. AXM values are calculated from the same OHLCV provider series as all other indicators.
```
