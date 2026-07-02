# India 5Y History Cache Seed And Restore Plan

## Current Coverage Finding

PR #43 confirmed that the current India scan path does not contain enough retained history for MYH:

- Scan cache path: `markets/india/dashboard/cache/india/ohlcv`
- Symbols inspected: `8021`
- Earliest OHLCV date: `2024-10-01`
- Latest OHLCV date: `2026-07-01`
- Maximum retained bars per symbol: `423`
- Symbols with `>=504` / `>=756` / `>=1260` bars: `0`
- Weekly Universe and RSLE symbols are present in the cache, but `0/20` Weekly Universe and `0/20` RSLE rows have `>=504` bars.
- `markets/india/dashboard/cache/india/indices/NIFTY500.json` is present, but also has only `423` bars.
- No local `aurora-market-cache`, `manifests/india-cache-manifest.json`, `india/latest`, weekly, or monthly restored snapshot path was found.

This means `MYH_HISTORY_INSUFFICIENT` is legitimate for the current retained cache, but the root cause is cache restoration/seed coverage, not MYH formula logic.

## Why 423 Bars Is Insufficient

India MYH requires retained daily bars for these lookbacks:

- `MYH_2Y`: `>=504` trading bars
- `MYH_3Y`: `>=756` trading bars
- `MYH_5Y`: `>=1260` trading bars
- Preferred production buffer: `>=1500` trading bars

The current maximum of `423` bars cannot support even `MYH_2Y`, so every long-lookback MYH lane remains unavailable until the cache is seeded or restored.

## Required Date Range And Bar Targets

For the `2026-07-01` context, seed approximately 7 calendar years:

- Start: `2019-07-01`
- End: `2026-07-01`
- Preferred long-listed-symbol target: `>=1500` daily bars

Seven calendar years gives enough room for weekends, holidays, suspensions, and exchange-specific gaps while still supporting 5 trading years.

## Free-First Source Routing

Use AURORA India free-first routing:

1. Official NSE/BSE historical bhavcopy archives where reliable.
2. Existing free India provider / Tapetide if available.
3. Yahoo Finance `.NS` / `.BO` fallback for symbols missing from official archives.
4. EODHD only when free routes fail, the listing is supported, and the fallback reason is recorded.

Do not blend providers inside one symbol's indicator series. Each symbol history file must carry one provider family unless a future repair explicitly splits provenance and prevents indicator-series blending.

## NSE/BSE Bhavcopy Approach

Official exchange daily bhavcopy archives are preferred because one daily file covers thousands of symbols. A 7-year seed attempts roughly 1800 weekdays and should safely skip holidays, exchange closures, and archive `404` responses.

Expected normalized OHLCV record shape for each symbol:

```json
{
  "market": "india",
  "exchange": "NSE",
  "symbol": "RELIANCE",
  "series": "EQ",
  "provider": "NSE_OFFICIAL_BHAVCOPY",
  "data_as_of": "2026-07-01",
  "bars": [
    { "date": "2019-07-01", "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1 }
  ]
}
```

Use normalized file names such as `NSE__RELIANCE.json` and `BSE__500325.json` or `BSE__SYMBOL.json`. Avoid `.NS` / `.BO` in the stored `symbol` key after provider-specific fetch resolution.

## Fallback Plan

For each missing or short symbol:

- First retry official archive coverage.
- If still short, resolve provider symbol for Yahoo `.NS` or `.BO`.
- If Yahoo fails and Tapetide is available, fetch through the existing free provider route.
- Use EODHD only after free routes fail and record `fallback_reason`.
- Do not merge bars from multiple provider families into one indicator series.

## Manifest And Provenance

The dry-run package plan builds an India history manifest with:

- `schema_version`
- `market`
- `snapshot_type`
- `snapshot_id`
- `created_at`
- `source_repo`
- `source_commit`
- `source_cache_path`
- `data_as_of`
- coverage counts for `>=1500`, `>=1260`, `>=756`, and `>=504`
- `file_count`
- `total_bytes`
- per-file relative path, bytes, and SHA256
- warnings

Validation checks:

- ordered unique dates
- valid OHLCV fields
- provider consistency per symbol
- first date, last date, and row count
- `>=1500` / `>=1260` / `>=756` / `>=504` eligibility counts
- generated artifact exclusions from package plans

## PowerShell Commands

Audit the current source-repo India cache:

```powershell
node scripts/market-cache/audit-india-history-coverage.mjs --root markets/india/dashboard/cache/india/ohlcv
```

Validate an external 5Y+ history root after fetch/normalization:

```powershell
$historyRoot = "C:\Users\mohit\Downloads\aurora-india-5y-history\ohlcv"
node scripts/market-cache/validate-india-history-package.mjs --root $historyRoot
```

Build a dry-run package plan for the external backup repo:

```powershell
$historyRoot = "C:\Users\mohit\Downloads\aurora-india-5y-history\ohlcv"
$cacheRepo = "C:\Users\mohit\Downloads\aurora-market-cache"
node scripts/market-cache/package-india-history-snapshot.mjs --root $historyRoot --cache-repo $cacheRepo --snapshot latest --snapshot-id latest --dry-run
```

The package command is dry-run only in this PR. It does not copy files, write manifests, run apply mode, or push to the backup repo.

## Backup Repo Target

Target repo/path:

```text
aurora-market-cache/
  india/latest/
  manifests/india-cache-manifest.json
```

Weekly and monthly snapshots can use:

```text
aurora-market-cache/india/weekly/YYYY-WW/
aurora-market-cache/india/monthly/YYYY-MM/
```

## Restore Procedure

After the external history package is validated and uploaded by an approved backup flow:

1. Restore dry-run first:

   ```powershell
   node scripts/market-cache/restore-market-cache.mjs --market india --cache-repo C:\Users\mohit\Downloads\aurora-market-cache --snapshot latest --snapshot-id latest
   ```

2. Confirm the restore plan only targets `markets/india/dashboard/cache`.
3. In a separate approved production operation, run apply mode only after Phase C guardrails are satisfied.
4. Re-run:

   ```powershell
   node scripts/market-cache/audit-india-history-coverage.mjs --root markets/india/dashboard/cache/india/ohlcv
   npm --prefix markets/india/dashboard test
   ```

5. Only then re-run India scan/publication through the normal guarded workflow.

## Generated Artifact Exclusions

Do not commit or stage:

- `markets/*/dashboard/cache/**`
- `markets/*/dashboard/data/*.json`
- `public/**`
- `cache/**`
- `AURORA_*Dashboard*.html`
- `*.parquet`
- `*.jsonl.gz`
- `*.csv.gz`
- `*.zip`

The package dry-run filters source-code and generated dashboard artifacts out of package plans.

## Remaining Risks

- Historical corporate-action adjustment quality must be verified before using long-run OHLCV for production MYH.
- Delisted, renamed, merged, suspended, BE/BZ/SME, and BSE-only symbols may have short or fragmented history.
- Provider fallback must stay per-symbol provider-consistent; mixed-provider indicator series should fail validation.
- Actual fetch/upload remains a manual external data operation and is intentionally not performed or committed by this source PR.
