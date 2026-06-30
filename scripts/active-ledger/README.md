# AURORA Active Tracking Ledger

The active tracking ledger is committed AURORA state for symbols already published into a market list. It is one file per market:

- `markets/us/dashboard/state/active-tracking-ledger.json`
- `markets/india/dashboard/state/active-tracking-ledger.json`
- `markets/canada/dashboard/state/active-tracking-ledger.json`

These ledgers are not OHLCV cache files and must not contain raw provider data. Initial ledgers are intentionally empty.

## Schema

Each ledger uses `schema_version: "1.0"`, a locked `market` value (`us`, `india`, or `canada`), nullable `created_at` and `updated_at` dates, and an `entries` array.

Future entries support:

- identity: `symbol`, `market`, `first_published_date`, `first_published_list`, `theme`
- bucket state: `initial_bucket`, `current_bucket`
- price context: `entry_reference`, `entry_stop`, `thesis_stop`, `highest_close_since_publish`, `latest_close`
- latest context labels: `latest_axm21_label`, `latest_axm50_label`, `latest_px_label`, `latest_aurora_x_state`
- MFH/FOMO context: `latest_market_fomo_label`, `latest_market_fomo_score`
- review state: `extension_status`, `lifecycle_status`, `last_review_date`, `exit_date`, `exit_reason`, `notes`

Allowed final buckets are `TRADE_READY`, `TRIGGER_READY`, `EARLY_ENTRY_WATCH`, `PULLBACK_WATCH`, `RSNH_WATCH_ONLY`, `NO_CHASE`, `PROTECT_PROFIT_REVIEW`, `REPAIR_WATCH`, and `AVOID_FRESH_LONG`.

Allowed lifecycle statuses are `ACTIVE`, `WATCH_ONLY`, `EXTENDED_REVIEW`, `PROTECT_PROFIT_REVIEW`, `SELL_RISK_REVIEW`, `EXITED`, and `DATA_REPAIR`.

Allowed extension statuses are `NORMAL`, `EXTENDED_REVIEW`, `NO_CHASE_REVIEW`, `PROTECT_PROFIT_REVIEW`, `SELL_RISK_REVIEW`, `RESET_REQUIRED`, and `DATA_REPAIR`.

Allowed published lists are `WEEKLY_UNIVERSE`, `WEEKLY_FOCUS`, `DAILY_TOP_1_4`, `RSLE_TOP_20`, `RSLE_DEVELOPING_21_40`, and `MANUAL_REVIEW`.

Allowed market FOMO labels are `FOMO_0_COOL`, `FOMO_1_NORMAL`, `FOMO_2_WARM`, `FOMO_3_HOT`, `FOMO_4_EUPHORIC`, `FOMO_5_CLIMAX_RISK`, and `UNKNOWN`.

## Policy Locks

MFH/FOMO fields are context-only. They must not alter buckets, scores, ranking, candidate inclusion, sell signals, provider routing, or existing AURORA logic.

Extension alone is not a sell signal. It is review context for a future Sell / Extension Watchlist surface.

Future PRs will populate entries and render the Sell / Extension Watchlist. This PR only adds schema, validation, tests, and empty per-market ledgers.

## Population from dashboard lifecycle lists

`populate-active-tracking-ledger.mjs` can derive candidate ledger entries from existing dashboard lifecycle lists such as `WEEKLY_UNIVERSE`, `WEEKLY_FOCUS`, `DAILY_TOP_1_4`, `RSLE_TOP_20`, and `RSLE_DEVELOPING_21_40`.

The helper is dry-run by default. `--apply` is required to write a ledger file:

```bash
node scripts/active-ledger/populate-active-tracking-ledger.mjs --market us --ledger markets/us/dashboard/state/active-tracking-ledger.json --scan-file markets/us/dashboard/data/us-full-dashboard-scan.json --as-of YYYY-MM-DD
```

This source/test PR does not populate real ledgers. It reads existing dashboard scan JSON only, does not fetch market data, does not run scans, does not change scheduled workflows, and does not change AURORA formulas, ranking, scoring, bucket, provider, data-acquisition, or execution logic.

Diagnostic labels never become final buckets. MFH/FOMO remains context-only and does not alter candidate inclusion, ranking, buckets, sell signals, or AURORA logic.

## Workflow integration

US, India, and Canada dashboard workflows expose manual `workflow_dispatch` input `active_ledger_mode` with `off`, `dry-run`, and `apply`.

The default mode is `off`. Scheduled runs remain off because active-ledger population steps run only for manual `workflow_dispatch` runs. Dry-run reads the existing scan JSON and ledger, prints the population summary, and writes nothing. Apply requires explicit manual selection and writes only the per-market ledger path.

This integration does not fetch market data, run scans, change AURORA logic, or create buy/sell signals. Diagnostic labels never become final buckets. Real ledger population should be done only after dry-run review.

## Validation

Validate all committed ledgers:

```bash
node scripts/active-ledger/validate-active-tracking-ledger.mjs --all
```

Validate one ledger:

```bash
node scripts/active-ledger/validate-active-tracking-ledger.mjs --file markets/us/dashboard/state/active-tracking-ledger.json
```
