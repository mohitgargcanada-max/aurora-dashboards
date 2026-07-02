# MYH Cross-Market Dashboard Wiring Audit

## Classification

F. CROSS_MARKET_DRIFT, fixed for the US JSON export. India's current empty MYH sections are a data-availability finding: B. DATA_MISSING.

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
