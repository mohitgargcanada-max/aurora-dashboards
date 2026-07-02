# One-time 7-calendar-year market history seed runbook

This runbook covers the controlled local seed for US, India, and Canada OHLCV history.

It is source-side only. Fetched OHLCV, raw provider responses, bhavcopy ZIPs, CSV.gz, parquet, dashboard JSON, dashboard HTML, public assets, and cache files must not be committed to `aurora-dashboards`.

## Fixed scope

- Date range: `2019-07-01` to `2026-07-01`
- Preferred depth: `>=1500` bars for long-listed symbols
- True 5Y minimum: `>=1260` bars
- 3Y: `>=756` bars
- 2Y: `>=504` bars
- External cache repo: `C:\Users\mohit\Downloads\aurora-market-cache`

External history roots:

```text
C:\Users\mohit\Downloads\aurora-history-seed\us\ohlcv
C:\Users\mohit\Downloads\aurora-history-seed\india\ohlcv
C:\Users\mohit\Downloads\aurora-history-seed\canada\ohlcv
```

## Source routing

US:

1. Yahoo Finance primary for standard US tickers.
2. EODHD fallback only for missing, stale, incomplete, unsupported, or failed Yahoo symbols.

India:

1. Official NSE/BSE bhavcopy/history where reliable.
2. Tapetide if the official/free route is incomplete or blocked.
3. Yahoo `.NS` / `.BO` fallback for remaining missing symbols.
4. EODHD fallback only after free/Tapetide/Yahoo gaps are identified and the listing is supported.

Canada:

1. Yahoo `.TO` / `.V` first where official bulk history is unavailable.
2. EODHD fallback only for missing, stale, incomplete, unsupported, or failed Yahoo symbols.

Do not use EODHD merely because it is available. Do not blend providers inside one symbol's indicator series.

## Required provenance

Each symbol record must retain:

- provider
- fallback reason
- endpoint/source
- `data_as_of`
- `retrieved_at`
- currency
- adjustment status
- warnings
- checksum in package manifest

## Preflight

From the repo root:

```powershell
node scripts/market-cache/plan-one-time-7y-market-history-seed.mjs
git status --short
```

The planner is dry-run only. It never writes data. Use the commands below for external fetch, validation, and package operations.

## Sample fetch gate

Before a full run, fetch only `10` symbols per market into the external roots. Then confirm:

- files are outside `aurora-dashboards`
- records include required provenance
- dates are unique and sorted
- OHLCV is internally valid
- one symbol uses only one provider series
- no source repo data files changed

Run:

```powershell
node scripts/market-cache/fetch-7y-history-external.mjs --market all --sample-size 10 --start 2019-07-01 --end 2026-07-01
git status --short -- markets/*/dashboard/cache/** markets/*/dashboard/data/*.json public/** cache/** AURORA_*Dashboard*.html *.parquet *.jsonl.gz *.csv.gz *.zip
```

The fetch command above is dry-run. To write a sample package outside the repo, add `--apply`. Full fetch requires both `--full --apply`.

Expected git output: empty.

## Validation

Validate each external history root before packaging:

```powershell
node scripts/market-cache/validate-history-package.mjs --market all --root C:\Users\mohit\Downloads\aurora-history-seed
node scripts/market-cache/validate-india-history-package.mjs --root C:\Users\mohit\Downloads\aurora-history-seed\india\ohlcv
```

Required all-market validation before package apply:

- dates unique
- dates sorted
- valid open/high/low/close/volume
- `high >= max(open, close, low)`
- `low <= min(open, close, high)`
- no negative volume
- provider consistency per symbol
- latest completed session present where expected
- first date, last date, row count
- checksum per file
- coverage buckets: `>=1500`, `>=1260`, `>=756`, `>=504`, `<504`
- top missing/short symbols
- fallback-provider counts

## Package

Package only validated history into:

```text
aurora-market-cache/
  us/latest/
  india/latest/
  canada/latest/
  manifests/us-cache-manifest.json
  manifests/india-cache-manifest.json
  manifests/canada-cache-manifest.json
  us/monthly/2026-07/
  india/monthly/2026-07/
  canada/monthly/2026-07/
```

All-market dry-run package command:

```powershell
node scripts/market-cache/package-history-snapshot.mjs --market all --root C:\Users\mohit\Downloads\aurora-history-seed --cache-repo C:\Users\mohit\Downloads\aurora-market-cache --snapshot latest --dry-run
```

Package apply requires `--apply`, valid external roots, and a valid external cache repo. Do not push `aurora-market-cache` until manifest validation passes.

## Restore gate

Dry-run restore first:

```powershell
node scripts/market-cache/restore-market-cache.mjs --market us --cache-repo C:\Users\mohit\Downloads\aurora-market-cache --snapshot latest --snapshot-id latest
node scripts/market-cache/restore-market-cache.mjs --market india --cache-repo C:\Users\mohit\Downloads\aurora-market-cache --snapshot latest --snapshot-id latest
node scripts/market-cache/restore-market-cache.mjs --market canada --cache-repo C:\Users\mohit\Downloads\aurora-market-cache --snapshot latest --snapshot-id latest
```

Inspect the restore plan before adding `--apply`.

After restore:

```powershell
node scripts/market-cache/audit-history-coverage.mjs --market all
npm --prefix markets/us/dashboard test
npm --prefix markets/india/dashboard test
npm --prefix markets/canada/dashboard test
```

Expected post-restore:

- India long-listed symbols have `>=1260` and preferably `>=1500` bars where listing history permits.
- Canada no longer reports `CACHE_NOT_FOUND`.
- US improves beyond 52W-only/near-5Y if full 7Y refetch is applied.
- No formula or final bucket drift.

## Source commit rule

This source branch may include runbooks, safe wrappers, validators, tests, and generated-artifact guards only.

It must not include fetched OHLCV data, raw NSE/BSE bhavcopy ZIPs, Yahoo/EODHD response files, cache JSON, dashboard generated JSON, dashboard HTML, `public/`, backup repo content, or secrets.
