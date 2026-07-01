# AURORA Market-Data Backup Strategy

## Objective

AURORA needs durable historical market data across US, India, and Canada so long-running dashboard scans can keep calculating RS, RS21, RSNH, RMV, compression, 52-week highs, multi-year highs, BasePivot, RMVP, weekly-universe continuity, and outage recovery without forcing a full provider re-download on every run.

Normal source-code pull requests must stay clean. They should contain source, tests, specs, and small fixtures only, not generated OHLCV, dashboard JSON, cache files, or rendered HTML.

## Separation of Concerns

The system should use separate lanes:

- Source code lane: `main` branch, source/test/spec/config only.
- Market-data backup lane: long-term OHLCV, index, and optional fundamental reference backup.
- Dashboard output lane: GitHub Pages and workflow artifact output only.
- Active ledger lane: active position tracking handled separately by active-ledger tooling.
- External audit lane: TraderLion or other report comparison, not embedded into the core scanner.

## Recommended Backup Destination

Option A, separate private GitHub repo, `aurora-market-data-backup`: recommended. It keeps feature PRs clean, allows narrow permissions, supports independent backup history, and avoids source-tree churn.

Option B, dedicated branch in this repo, `data/aurora-market-history`: acceptable fallback when a separate repo is unavailable. The branch must never be merged into `main`; it should behave like a data-only store.

Option C, GitHub Releases weekly compressed snapshots: useful for immutable weekly packages, but weaker for incremental append and restore workflows.

Option D, GitHub Actions artifacts: short-term retention only. Use for run diagnostics, not durable history.

Option E, Git LFS: use only if file sizes require it and access/billing/retention rules are understood.

Recommended default: separate private repo. Fallback: dedicated data branch. Both avoid polluting `main`, keep source PRs clean, support weekly append history, make restore-before-scan practical, protect against provider outages, and avoid thousands of generated files in feature branches.

## Proposed Backup Structure

This structure belongs only in the backup repo or data branch, never in `main`:

```text
data/
  us/
    ohlcv/
    indices/
    fundamentals_optional/
    manifests/
  india/
    ohlcv/
    indices/
    bhavcopy_optional/
    manifests/
  canada/
    ohlcv/
    indices/
    fundamentals_optional/
    manifests/
  snapshots/
    weekly/
  audit/
  validation-reports/
```

## Recommended File Format

Prefer compact files:

- `jsonl.gz`
- `csv.gz`
- `parquet` only if dependency-safe and operationally justified

Avoid:

- thousands of tiny JSON files
- uncompressed full-universe snapshots
- dashboard HTML
- dashboard data JSON as canonical backup

Recommended packaging:

- one compressed OHLCV file per market per asset class or per month
- one manifest per market/session
- checksum per backup package

## Required Provenance Fields

Every backed-up series must preserve:

- `symbol`
- `market`
- `exchange`
- `provider`
- `endpoint_or_source`
- `retrieved_at`
- `data_as_of`
- `currency`
- `adjustment_status`
- `delayed_or_live`
- `fallback_reason`
- `warnings`
- `series_start`
- `series_end`
- `row_count`
- `checksum`
- `source_priority_label`

Allowed source priority labels:

- `FREE_PRIMARY`
- `YAHOO_FALLBACK`
- `EODHD_FALLBACK`
- `OFFICIAL_VERIFIED`
- `CROSS_VERIFIED`
- `STALE`
- `PARTIAL`
- `CONFLICT`
- `NOT_AVAILABLE`

## Provider and Data Integrity Rules

Locked rules:

- never blend providers inside one indicator series
- always record provider per symbol/series
- use official/free source first
- use Yahoo fallback second
- use EODHD only when free sources fail, are stale, incomplete, or lack a required field
- validate symbol/exchange mapping
- validate currency
- validate latest completed session
- validate OHLCV internally
- validate unique ordered dates
- detect unexplained gaps
- track adjusted versus unadjusted prices
- never fabricate missing data
- provider failure must not force candidate inclusion or exclusion unless a locked mandatory gate is missing

## Restore-Before-Scan Flow

Future flow:

1. Check out source `main`.
2. Restore the latest backup package into local runtime cache.
3. Validate the restored cache.
4. Run the dashboard scan.
5. Append only new completed bars.
6. Validate the appended dataset.
7. Package the compressed backup.
8. Push backup data only to the backup repo or data branch.
9. Never commit restored or generated data to source `main`.

## Weekly Append Flow

Future weekly process:

1. Sunday or weekly rebuild restores the latest validated backup.
2. The scan appends the latest completed week of bars after successful validation.
3. Validation confirms provenance, dates, checksums, sessions, and row counts.
4. The backup package is compressed and committed only to the backup lane.
5. Commit message format:

```text
[data-backup] Append US India Canada history through YYYY-MM-DD
```

## Recovery Flow

Recovery rules:

- restore from the latest good snapshot first
- roll back a bad backup package by reverting the backup repo or data branch commit
- mark suspect packages as `STALE`, `PARTIAL`, or `CONFLICT` in validation reports
- rebuild a single corrupt symbol from provider history only after mapping, provider, currency, and session validation pass
- keep the bad package available for audit unless it contains sensitive data

## Safety Rules

Normal source PR generated-artifact guards must continue blocking:

- `markets/*/dashboard/cache/**`
- `markets/*/dashboard/data/*.json`
- `AURORA_**Dashboard*.html`
- `AURORA**_Unified_Dashboard*.html`
- `cache/**`
- `*.parquet`
- `*.jsonl.gz`
- `*.csv.gz`

These paths are allowed only when explicitly operating inside the backup repo or the dedicated data branch, never in ordinary source-code PRs.
