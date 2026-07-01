# AURORA Market-Data Backup Scaffolding

This directory contains source-only, dry-run scaffolding for the future AURORA market-data backup lane.

It does not fetch providers, run scans, write backup data, push to GitHub, update dashboards, or modify active ledgers.

## Scripts

- `validate-backup-paths.mjs`: rejects generated/dashboard/cache destinations and accepts only explicit safe external backup roots.
- `plan-market-data-backup.mjs`: prints the proposed backup structure and restore/append/validate/package flow.
- `validate-market-data-manifest.mjs`: validates synthetic manifest shape and required provenance fields.

## Policy

Normal source PRs must not include market-data cache, dashboard JSON, rendered dashboard HTML, compressed data packages, or real OHLCV/index/fundamental data.

Use a separate private repo such as `aurora-market-data-backup` when available. Fallback is a dedicated data branch such as `data/aurora-market-history`, never merged into `main`.

## Validation

```bash
node --check scripts/market-data-backup/validate-backup-paths.mjs
node --check scripts/market-data-backup/plan-market-data-backup.mjs
node --check scripts/market-data-backup/validate-market-data-manifest.mjs
node --test scripts/market-data-backup/tests/*.test.mjs
```
