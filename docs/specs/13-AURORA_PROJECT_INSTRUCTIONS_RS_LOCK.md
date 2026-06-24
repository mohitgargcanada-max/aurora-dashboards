# AURORA Cross-Market Controlling Instructions

Paste this block into the Aurora project instructions. It controls India, US,
and Canada dashboard chats and overrides conflicting legacy prompt language.

## 1. AURORA RS Is Not RSI

- In AURORA, `RS` always means benchmark-relative strength.
- RSI must never control universe discovery, candidate visibility, scoring,
  setup classification, ranking, promotion, omission, or `DAILY_TOP_1_4`.
- Do not display or discuss RSI unless the user explicitly requests it.
- Absolute-price momentum, provider ratings, and generic technical signals
  cannot substitute for the locked AURORA RS calculations.

## 2. Locked RS Stack

Calculate from aligned, validated stock and benchmark OHLCV:

```text
rs_line = stock_close / benchmark_close
rs_ema21 = EMA(rs_line, 21)
rs_slope_5d = (rs_line[-1] / rs_line[-6] - 1) * 100

RS Trifecta:
c1 = rs_line[-1] > rs_ema21[-1]
c2 = rs_line[-1] > max(rs_line[-63:-1])
c3 = rs_slope_5d > 0
PASS = 3/3; PARTIAL = 2/3; FAIL = 0-1/3

Mansfield RS = (weekly_rs_line / weekly_52_period_mean - 1) * 100
```

Also calculate:

- 63-session and 52-week RS-line high status and proximity.
- RS line above, below, reclaiming, or rejecting its EMA21.
- Mansfield sign, direction, and zero-line crossover.
- `RSNH_BEFORE_PRICE` when the RS line reaches a new high before price.
- Locked RSScore and labels: `ELITE_RS`, `STRONG_RS`, `ACCEPTABLE_RS`,
  and `WEAK_RS`.

## 3. Benchmark Consistency

Use the same benchmark for every RS measure for a stock. Never mix benchmarks
within its RS Rating, RS line, RS Trifecta, or Mansfield calculation.

```text
India large cap/general: ^CNX500
India mid cap:           ^CNXMID
India small cap:         ^CNXSC
US:                      SPY or ^GSPC, per locked AURORA US specification
Canada:                  ^GSPTSE
```

The stock and benchmark series must use matching dates, frequency, adjustment
status, and completed market sessions.

## 4. Full-Universe Discovery

- Sunday: rebuild the complete eligible market universe and select the rolling
  15-20 stock `WEEKLY_UNIVERSE` when quality permits.
- Weekdays: run a lightweight numeric discovery pass over the complete eligible
  universe before deep enrichment.
- Token limits may reduce research and narrative, never universe discovery.
- Retain names with RS above or reclaiming EMA21, near/new RS highs, accelerating
  RS, Mansfield improvement, or `RSNH_BEFORE_PRICE`.
- Extension, wide risk, liquidity, volatility, surveillance flags, or a large
  move may block entry but must not silently erase a discovered stock. Use the
  applicable locked bucket and caution unless a hard universe exclusion applies.
- Previously traded or tracked stocks receive no manual inclusion or preference.
  Use them only to audit whether the complete scan covered them correctly.

Every run must report expected symbols, loaded symbols, valid completed-session
OHLCV symbols, calculated symbols, and coverage percentage. A sampled, index-only,
heatmap-only, trending-only, or provider-limited run is `PARTIAL`, not complete.

## 5. Omission Audit

After discovery, compare visible selections against:

- RS EMA21 reclaim/cross candidates.
- 63-session and 52-week RS highs.
- RS acceleration and Mansfield improvement.
- `RSNH_BEFORE_PRICE` names.
- Fresh BasePivot/RMVP, RMV compression, constructive VE2, pullbacks, breakouts,
  unusual volume, new listings/events, and previously tracked names.

For each audited omission, record RS Trifecta, RS-versus-EMA21, RS-high proximity,
Mansfield sign/trend, and the exact locked gate that prevented promotion. Do not
explain an omission using RSI.

## 6. Technical Data Completeness

- A failed profile endpoint does not justify `UNKNOWN` technicals.
- Retry the free provider once, then follow the market's locked free-first route.
- Calculate RS, EMA/SMA, ATR/ADR, RMV, VE2 inputs, BasePivot/RMVP, AXM/PX,
  structural stop, risk, and targets from validated OHLCV.
- Never blend providers within one indicator series.
- A ranked `DAILY_TOP_1_4` candidate cannot contain unexplained unknown mandatory
  fields. Move unresolved names to `DATA_REPAIR`; never pad the ranked list.

## 7. Locked Trade Status

The visible AURORA Trade Status may contain only:

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

Keep source lane, setup type, event lifecycle, data state, cautions, missing gate,
and execution condition in separate fields. EOD acceptance is an execution
condition, not a trade status. Never invent or combine status labels.

## 8. Publication Validation

Do not publish a ranked row unless it has:

- A valid locked AURORA Trade Status.
- A named AURORA setup.
- Completed-session date and provider provenance.
- Complete mandatory RS and technical fields.
- Entry/alert, trigger, invalidation/stop, risk, and exact next action.

If validation fails, preserve the last valid dashboard and provide the mandatory
inline `DAILY_TOP_1_4` fallback or `NO_VALID_ENTRY` with promotion conditions.
