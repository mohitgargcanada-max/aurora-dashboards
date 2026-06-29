# AURORA market cache framework

This directory contains a source-only framework for backing up and restoring validated per-market cache packages to a separate GitHub repo:

```text
aurora-market-cache
```

Supported markets:

```text
us
india
canada
```

Default local cache sources:

```text
markets/us/dashboard/cache
markets/india/dashboard/cache
markets/canada/dashboard/cache
```

The framework is dry-run-first. Nothing is copied or restored unless `--apply` is passed.

## Separate repo model

Expected external repo structure:

```text
aurora-market-cache/
  us/latest/
  us/weekly/YYYY-WW/
  us/monthly/YYYY-MM/
  india/latest/
  india/weekly/YYYY-WW/
  india/monthly/YYYY-MM/
  canada/latest/
  canada/weekly/YYYY-WW/
  canada/monthly/YYYY-MM/
  manifests/us-cache-manifest.json
  manifests/india-cache-manifest.json
  manifests/canada-cache-manifest.json
```

Each manifest records schema version, market, snapshot type/id, source commit, source cache path, file count, total bytes, file paths, byte sizes, and SHA256 checksums.

## Backup examples

Dry-run:

```bash
node scripts/market-cache/backup-market-cache.mjs --market us --cache-repo ../aurora-market-cache --snapshot latest --snapshot-id latest
```

Apply:

```bash
node scripts/market-cache/backup-market-cache.mjs --market india --cache-repo ../aurora-market-cache --snapshot weekly --snapshot-id 2026-26 --apply
```

## Restore examples

Dry-run:

```bash
node scripts/market-cache/restore-market-cache.mjs --market canada --cache-repo ../aurora-market-cache --snapshot latest --snapshot-id latest
```

Apply:

```bash
node scripts/market-cache/restore-market-cache.mjs --market us --cache-repo ../aurora-market-cache --target markets/us/dashboard/cache --snapshot monthly --snapshot-id 2026-06 --apply
```

## Guardrails

- Do not upload real cache data from this PR.
- Do not copy generated dashboard HTML.
- Do not copy `dashboard/data/*.json`.
- Do not copy `.git/`.
- Do not blend providers or modify OHLCV content.
- Restore validates manifest fields and SHA256 checksums before copying.
- Restore does not delete existing local cache files in this first framework PR.

## Workflow integration

The US, India, and Canada dashboard workflows expose manual `workflow_dispatch` controls for market-cache integration:

```text
market_cache_mode: off | dry-run | apply
market_cache_snapshot: latest | weekly | monthly
market_cache_snapshot_id: latest | YYYY-WW | YYYY-MM
```

The default mode is `off`. Scheduled workflows remain off unless a future PR explicitly changes that policy.

When manually selected, `dry-run` validates the integration path without writing local cache files or pushing cache changes. `apply` requires the `AURORA_MARKET_CACHE_PAT` secret, restores cache before the scan, and backs up cache only after the dashboard scan/generation step succeeds.

No real cache is uploaded unless `apply` is selected manually. Workflow integration still relies on the framework exclusions for generated dashboard HTML, `dashboard/data/*.json`, and `.git/`.
