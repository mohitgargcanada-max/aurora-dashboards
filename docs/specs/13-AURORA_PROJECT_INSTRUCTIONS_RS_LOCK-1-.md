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

### India acquisition order

For India, use NSE/BSE official bhavcopy, index, security-master, surveillance,
filing, issuer, and government sources first. Then use other reliable free
public structured sources, followed by Yahoo Finance. TapeTide or another
connected India provider is a fallback only after those routes fail validation.
EODHD is strictly last. Record every attempted route and fallback reason.

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

## 9. Technical Elite and Market Status

- `TECHNICALLY_ELITE` is a diagnostic label only when the complete locked
  `TechnicalStrengthScore >= 70/85`. It is not a final trade bucket and is not
  interchangeable with `ELITE_RS`.
- TechnicalStrengthScore is the sum of Market, RS, RRG, Pattern, Entry, Volume,
  Pullback, and Risk components, maximum 85. Missing mandatory components mean
  `NOT_SCORED/PARTIAL`; never approximate an elite label.
- Every dashboard refresh must show the Market Summary Strength Stack first:
  benchmark MA stack, MC2 cycle, leadership breadth as count/denominator/percent,
  distribution/churn, trade feedback, failed breakouts, risk proxy, reference
  basket, sector/theme evidence, cycle age, Market Dimmer, Final Market
  Permission, Action Bias, and reason.
- Never infer market permission from incomplete inputs. Use
  `MARKET_STATE_UNKNOWN`, an unassigned permission, and
  `market_dimmer=NOT_CALCULATED`. Required trade plans remain conditional and
  cannot receive DAILY_TOP execution tiers until market permission is valid.

## 10. Fetch Once, Compute All

- Fetch each official bulk universe, OHLCV, benchmark, sector, reference-basket,
  surveillance, corporate-action, fundamental, and event dataset once per
  completed session or valid cache lifetime.
- Cache by market, provider, endpoint/file, symbol/universe, interval,
  data-as-of date, adjustment status, and schema version.
- Derive every AURORA indicator locally from the cached normalized data. Never
  refetch the same bars for RS, RMV, VE2, BasePivot, PBX, AXM, Stage, volume,
  stops, risk, or another indicator.
- Every ranked candidate must have all ten AURORA-SIG components, SIG/100,
  TechnicalStrengthScore/85 with its locked label, and the locked WWL Score with
  its component audit.
- An incomplete score is not a ranked verdict. Route the candidate to
  `DATA_REPAIR/PARTIAL`, preserve the last fully scored dashboard, and show
  conditional fallback trade plans separately.
- Token efficiency may reduce prose and deep research. It must never remove a
  score component, technical calculation, market-state input, or universe-wide
  discovery field.

## 11. One Matrix, Multiple Scan Views

- Build one normalized per-symbol AURORA feature matrix after the single data
  fetch. VCP, PBX/pullback, price near/new 52-week high, RS21/RSNH, RMV,
  BasePivot/RMVP, VE2, Show of Power, Stage, AVWAP/HVC, priming, squat/retest,
  AXM/no-chase, repair, and Technically Elite are views over that matrix.
- A scan view must not trigger another OHLCV call.
- Price-high proximity and benchmark-relative RS-high proximity are separate.
- VCP requires tightening price and volume contraction sequences; low RMV alone
  is insufficient. PBX requires a qualifying power move, valid pullback
  depth/duration, MA interaction, dry-up, and failure checks.
- Use at least 252 valid daily bars or 52 complete weekly bars for 52-week
  calculations, with explicit adjustment status and history sufficiency.
- Show universe denominator, valid-history count, match count, formula label,
  data date, and cache/provider provenance for every scan view.

## 12. Exact Scanner Inventory

The controlling inventory is all 36 scanners listed in
`value_compounder_and_advanced_scanners.md`: S01-S22; VCP via HV Percentile;
Weinstein Stage 1-to-2 and Stage 2 Continuation; Government Shareholding,
Theme/PLI and Composite; Value Compounder; CANSLIM; Earnings Revision;
Promoter/Insider Buying; 12-1 Momentum; Wyckoff SOS; Short Squeeze where
applicable; and Buyback/Capital Return.

Also preserve Menu R01-R15 from the AURORA master: RMV5 Event Coil, RMV Pivot,
RMV Retest, Show of Power, Execution Funnel, Squat-Intact, Theme Tracker,
Broad Routine, Priming Pattern, Theme Representatives, Daily Top 1-4,
Watchlist Abandonment, Market Cycle Age/Dimmer, Reference Basket Tell, and
AURORA Weekly Watchlist.

Expose them as grouped filters over the shared feature matrix. A missing
event/fundamental dataset is `NOT_RUN_DATA_REQUIRED`, not a false no-match.
Market-inapplicable scanners are `NOT_APPLICABLE`. Scanner membership feeds
the scores and verdict but is never itself a final trade bucket.

## 13. Sector and Stock RRG/RLT

- Maintain separate Sector RRG and Stock RRG views in the same dashboard.
- Cache major official sector-index histories once per completed session, align
  them with the market benchmark, and calculate all quadrants, tails,
  transitions, breadth, and lead times locally.
- Use the locked weekly RS Ratio, RS Momentum, tail deltas, and
  LEADING/WEAKENING/IMPROVING/LAGGING definitions. Include confidence and
  freshness labels; never infer a quadrant from a heatmap or short return.
- Track sector transition dates and each stock's RS/EMA21 cross, RSNH, early
  entry, and breakout dates. Feed RRGScore into Technical Strength, SIG, WWL,
  and Early Entry ranking.
- RRG improves context and timing but cannot create a trade verdict without a
  valid setup, volume, trigger, stop/risk, and market permission.

### Market adapters

- India: official NSE/NSE Indices sectors aligned with the locked Nifty
  benchmark.
- US: official or validated liquid US sector series/proxies aligned with
  SPY or the locked US benchmark.
- Canada: official TSX sector indices or validated Canadian sector proxies
  aligned with the S&P/TSX Composite.
- Never copy sector mappings, symbols, currencies, calendars, event sources, or
  surveillance rules from one market into another.

All market dashboards must preserve the same canonical workspaces: Market
Status, Daily Top conditional/qualified plans, Weekly Contract, complete Scan
Menu, Technically Elite, Sector RRG, Stock RRG/RLT, Near/New RS High,
single-stock drill-down, IPO/PEAD/EP, and provenance. Every ranked row requires
complete SIG, Technical Strength, and WWL scores calculated from the fetch-once
cache.
