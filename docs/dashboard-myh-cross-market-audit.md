# MYH Cross-Market Dashboard Wiring Audit

## Classification

F. CROSS_MARKET_DRIFT, fixed for the US JSON export. India's current empty MYH sections are a cache-availability finding: B. CACHE_NOT_RESTORED_OR_NOT_USED.

## Files Inspected

- `markets/shared/market-confirmation-and-ma-respect.mjs`
- `markets/shared/classification-radar.mjs`
- `markets/shared/tests/market-confirmation-and-ma-respect.test.mjs`
- `markets/shared/tests/classification-radar.test.mjs`
- `markets/us/dashboard/scripts/scan-universe.mjs`
- `markets/us/dashboard/scripts/render-canonical.mjs`
- `markets/us/dashboard/scripts/write-dashboard-json-export.mjs`
- `markets/us/dashboard/scripts/validate-dashboard-json-export.mjs`
- `markets/us/dashboard/scripts/validate-json-export-contract.mjs`
- `markets/us/dashboard/tests/dashboard-json-export.test.mjs`
- `markets/us/dashboard/tests/json-export-contract.test.mjs`
- `markets/us/dashboard/tests/ui-copy.test.mjs`
- `markets/us/dashboard/data/us-dashboard-state.json`
- `markets/us/dashboard/data/us-full-dashboard-scan.json`
- `markets/india/dashboard/scripts/run-full-dashboard-scan.mjs`
- `markets/india/dashboard/data/india-full-dashboard-scan.json`
- `markets/canada/dashboard/engine/scan-engine.mjs`
- `markets/canada/dashboard/scripts/run-full-dashboard-scan.mjs`
- `markets/canada/dashboard/tests/canada-dashboard.test.mjs`

## Current MYH Architecture

`buildMyhApproachingRows` builds MYH Near / Approaching rows from `myh_gap_pct` or 52-week proximity and requires strong RS evidence while excluding hard-fail rows. `buildMyhBreakoutRetestRows` normalizes MYH retest evidence into `MYH_BREAKOUT_RETEST` when prior breakout, support retest, distance, and RS evidence are present. These shared helpers are used by US, India, and Canada.

## India Findings

India calculates true multi-year high fields in `multiYearHighLayer` using `MYH_5Y`, `MYH_3Y`, and `MYH_2Y` windows, attaches those fields to rows, emits `myh_approaching`, `myh_breakout_retest`, and `multi_year_highs`, and renders all three MYH sections.

The latest local `markets/india/dashboard/data/india-full-dashboard-scan.json` has `myh_approaching: 0`, `myh_breakout_retest: 0`, and `multi_year_highs: 0`. The inspected rows with MYH fields are labeled `MYH_HISTORY_INSUFFICIENT` / `NOT_AVAILABLE`, so the empty MYH Near / Retest sections are legitimate for the current retained-history state rather than a renderer bug.

No India formula change was made.

## India Historical Coverage / MYH Data Audit

The India scan is wired to the expected local OHLCV cache root: `markets/india/dashboard/cache/india/ohlcv`. `run-full-dashboard-scan.mjs` reads that cache root directly, normalizes symbols through `exchange__symbol` cache file names such as `NSE__20MICRONS.json`, converts adjusted OHLCV bars into feature rows, and passes each row's retained `bars` array into `multiYearHighLayer`.

The current run used `markets/india/dashboard/data/india-full-dashboard-scan.json` with `run_mode: WEEKDAY_EOD_UPDATE`, `data_as_of: 2026-07-01`, `total_cache_records: 8021`, `feature_matrix_count: 2993`, and `scanned_candidates: 2064`. The daily refresh report also points at the same current cache state: `status: UPDATED`, `latest_data_as_of: 2026-07-01`, `total_records: 8021`, `current_records: 3430`, and `valid_current_records: 3430`.

Retained-history coverage for MYH:

| Scope | Total inspected | >= 5Y / 1260 bars | >= 3Y / 756 bars | >= 2Y / 504 bars | Less than 2Y | No history | Earliest available | Latest completed session |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Feature matrix MYH inspection | 2993 | 0 | 0 | 0 | 2993 | 0 | Inferred from cache: no cache record has >= 504 bars | 2026-07-01 |
| All India OHLCV cache records | 8021 | 0 | 0 | 0 | 8021 | 0 | 2024-10-01 | 2026-07-01 |
| Current equity OHLCV records | 3157 | 0 | 0 | 0 | 3157 | 0 | 2024-10-01 | 2026-07-01 |
| Deduped scan-visible rows with MYH fields | 938 | 0 | 0 | 0 | 938 | 0 | 2024-10-01 | 2026-07-01 |
| Weekly Universe rows | 20 | 0 | 0 | 0 | 20 | 0 | 2024-10-09 | 2026-07-01 |
| RSLE Top 20 rows | 20 | 0 | 0 | 0 | 20 | 0 | 2024-10-01 | 2026-07-01 |

The NIFTY500 benchmark index cache is also short for MYH-style long lookbacks: `markets/india/dashboard/cache/india/indices/NIFTY500.json` has 423 bars, from `2024-10-10` through `2026-07-01`.

Top 20 scan-visible symbols failing MYH due to insufficient history:

| Symbol | Rows | Earliest | Latest | Listing date | Cause |
| --- | ---: | --- | --- | --- | --- |
| APSISAERO | 66 | 2026-03-18 | 2026-07-01 | 2026-03-18 | New listing or short history |
| AEPL | 70 | 2026-03-12 | 2026-07-01 | 2026-03-12 | New listing or short history |
| SEDEMAC | 71 | 2026-03-11 | 2026-07-01 | 2026-03-11 | New listing or short history |
| OMNI | 75 | 2026-03-05 | 2026-07-01 | 2026-03-05 | New listing or short history |
| PNGSREVA | 76 | 2026-03-04 | 2026-07-01 | 2026-03-04 | New listing or short history |
| CLEANMAX | 78 | 2026-03-02 | 2026-07-01 | 2026-03-02 | New listing or short history |
| AARNAV | 80 | 2026-02-25 | 2026-07-01 | 2026-02-25 | New listing or short history |
| GJL | 83 | 2026-02-11 | 2026-07-01 | 2026-02-11 | New listing or short history |
| DEFENCE | 84 | 2026-02-19 | 2026-07-01 | n/a | Short retained cache |
| INFRA | 85 | 2026-02-18 | 2026-07-01 | n/a | Short retained cache |
| AYE | 87 | 2026-02-16 | 2026-07-01 | 2026-02-16 | New listing or short history |
| KWIL | 88 | 2026-02-16 | 2026-07-01 | 2026-02-16 | New listing or short history |
| SIGMAADV | 92 | 2026-02-09 | 2026-07-01 | 2007-07-19 | Short retained cache |
| CCAVENUE | 96 | 2026-02-03 | 2026-07-01 | 2016-04-04 | Short retained cache |
| EPWINDIA | 99 | 2025-12-30 | 2026-07-01 | 2025-12-30 | New listing or short history |
| SHADOWFAX | 100 | 2026-01-28 | 2026-07-01 | 2026-01-28 | New listing or short history |
| AMAGI | 104 | 2026-01-21 | 2026-07-01 | 2026-01-21 | New listing or short history |
| SETL | 106 | 2026-01-19 | 2026-07-01 | 2025-01-13 | New listing or short history |
| GROWWCHEM | 107 | 2026-01-16 | 2026-07-01 | n/a | Short retained cache |
| NEXT50ETF | 108 | 2026-01-14 | 2026-07-01 | n/a | Short retained cache |

Conclusion: `MYH_HISTORY_INSUFFICIENT` is legitimate for the current retained cache, but the broader root cause is not the MYH formula, not symbol normalization, and not the dashboard renderer. The source checkout does not contain a restored 5-year India cache for this run; the maximum retained OHLCV depth found in `cache/india/ohlcv` is 423 bars, below the 2Y/3Y/5Y MYH windows. Classification: `B. CACHE_NOT_RESTORED_OR_NOT_USED`. No wiring fix was applied because no alternate restored 5-year India cache path was present in the repo to wire in, and changing MYH thresholds is out of scope.

## US Findings

US calculates MYH Approaching through 52-week proximity (`price52_prox`) and the shared MYH helper. The local `markets/us/dashboard/data/us-dashboard-state.json` has `sections.myh_approaching` with 50 rows and `sections.myh_breakout_retest` with 0 rows. The renderer surfaces both `AURORA-MYH Approaching / Multi-Year High` and `AURORA-MYH Breakout Retest`.

The drift was in machine-readable JSON export: `us-full-dashboard-scan.json` emitted `myh_breakout_retest` but not `myh_approaching`, and the US export validators did not require `myh_approaching`.

## Canada Findings

Canada calculates `MYH_52W` proximity in `buildCanadaFeatureMatrix`, then uses the shared MYH helpers in `buildDashboardModel`. It writes `myh_approaching` and `myh_breakout_retest` into the Canada scan JSON and renders both `AURORA-MYH Approaching / Multi-Year High` and `AURORA-MYH Breakout Retest`.

No committed local `markets/canada/dashboard/data/canada-full-dashboard-scan.json` was present to inspect. The source wiring and test model path are present.

## Fix Applied

US JSON export now emits `myh_approaching`, serializes MYH approaching fields, includes those rows in export-wide final-bucket validation, and requires `myh_approaching` in both US JSON validators.

## Tests Added Or Updated

- `markets/us/dashboard/tests/dashboard-json-export.test.mjs` now verifies a synthetic MYH Approaching row appears in exported JSON with MYH fields.
- `markets/us/dashboard/tests/json-export-contract.test.mjs` now includes `myh_approaching` in the minimal valid scan fixture.
- `markets/us/dashboard/tests/ui-copy.test.mjs` now guards renderer usage of `sections.myh_approaching`.

## Remaining Risk / Follow-Up

India needs sufficient retained history before MYH Near / Retest can produce candidates. If future India outputs still show empty MYH sections after enough 2Y/3Y/5Y history is retained, re-audit the calculation layer before changing thresholds.

No AURORA formulas, thresholds, scoring weights, final buckets, provider routing, workflows, or generated dashboard artifacts were changed.
