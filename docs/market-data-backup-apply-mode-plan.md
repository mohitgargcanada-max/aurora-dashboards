# AURORA Market-Data Backup Apply-Mode Plan

## 1. Purpose

AURORA should never depend on rebuilding full market history from providers every run. The backup lane must restore validated historical OHLCV/cache before each scan, then append only missing latest completed bars after provider refresh succeeds.

This plan is for production apply mode. The current repository already has source-only scaffolding in `scripts/market-data-backup/` and dry-run-first runtime scripts in `scripts/market-cache/`; this document defines the guardrails required before apply mode is treated as production.

## 2. Scope

In scope:

- Market-data backup only.
- Historical OHLCV/cache packages used by US, India, and Canada dashboard scans.
- Benchmark/index history, safe listing metadata, provider provenance, validation reports, manifests, and checksums.

Out of scope:

- Source code backup.
- Dashboard Pages artifacts.
- Active trade ledger.
- Scanner output JSON.
- Catalyst, AI, premarket, or discovery data.
- Formula, scoring, ranking, provider-routing, final-bucket, or dashboard-logic changes.

## 3. Preferred Storage

Preferred destination: separate private repo, `aurora-market-data-backup`.

Fallback destination: protected branch, `data/aurora-market-history`.

Existing workflow scaffolding currently references `aurora-market-cache`. Production should either rename that external repo to `aurora-market-data-backup` or keep `aurora-market-cache` as the implementation repo with an explicit alias documented in workflow summaries. In both cases, backup data must stay outside source PRs.

## 4. Snapshot Types

Supported snapshot types:

- `latest`: most recent validated snapshot per market.
- `weekly`: immutable weekly package, keyed by `YYYY-WW`.
- `monthly`: immutable monthly package, keyed by `YYYY-MM`.

`latest` may be replaced only after the previous latest snapshot is retained or recoverable. Weekly and monthly snapshots must not be force-rewritten.

## 5. Required Directory Structure

Preferred repository layout:

```text
aurora-market-data-backup/
  manifests/
    latest.json
  weekly/
  monthly/
  us/
    ohlcv/
    indices/
    manifests/
  india/
    ohlcv/
    indices/
    delivery/
    corporate-actions/
    manifests/
  canada/
    ohlcv/
    indices/
    manifests/
```

The existing `scripts/market-cache/` layout may be used as Phase B/C implementation detail:

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

Before production rollout, choose one layout as canonical and add a migration note for the other.

## 6. Data To Include

Include:

- OHLCV history.
- Benchmark/index history.
- Provider provenance.
- Security master and listing metadata where safe.
- Corporate-action adjustment metadata where available.
- Data validation reports.
- Manifest checksums.

## 7. Data To Exclude

Exclude:

- Source code.
- Dashboard HTML.
- Dashboard output JSON.
- Public Pages artifacts.
- Active trade ledger.
- Secrets.
- Raw provider credentials.
- Gmail or other external reports.

Generated source-repo paths such as `markets/*/dashboard/cache/**`, `markets/*/dashboard/data/*.json`, `cache/**`, `AURORA_*Dashboard*.html`, `*.parquet`, `*.jsonl.gz`, `*.csv.gz`, and `*.zip` must not be committed to ordinary source PRs.

## 8. Provenance Schema

Every backed-up market series should include:

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
- `row_count`
- `first_date`
- `last_date`
- `checksum`
- `source_priority_label`

Compatibility note: existing `scripts/market-data-backup/validate-market-data-manifest.mjs` uses `series_start` and `series_end`. Production should either migrate to `first_date` and `last_date`, or support both names during a schema transition with a single canonical output.

Allowed source priority labels should remain explicit, for example `FREE_PRIMARY`, `YAHOO_FALLBACK`, `EODHD_FALLBACK`, `OFFICIAL_VERIFIED`, `CROSS_VERIFIED`, `STALE`, `PARTIAL`, `CONFLICT`, and `NOT_AVAILABLE`.

## 9. Restore Flow

Restore must run before scan:

1. Read `market_cache_mode`, `market_cache_snapshot`, and `market_cache_snapshot_id`.
2. If mode is `off`, do nothing.
3. Clone or mount the backup repo only outside pull requests.
4. Validate the manifest schema and market/snapshot identity.
5. Validate all checksums before any write.
6. Restore only explicitly allowed cache paths for the selected market.
7. Fail closed on invalid manifest or checksum mismatch unless mode is `dry-run` or `off`.
8. Emit a concise restore status in the workflow summary.

The existing `restore-market-cache.mjs` already validates manifest identity, safe relative paths, byte sizes, and SHA256 before copying. Production apply mode should also validate allowed destination roots before writing.

## 10. Append Flow

Append must run only after scan refreshes latest completed bars:

1. Identify changed cache files for the selected market.
2. Validate each changed series for ordered unique dates, row count, currency, adjustment status, and provider consistency.
3. Reject mixed-provider data inside one indicator series.
4. Update manifest metadata, checksums, file counts, byte totals, source commit, and `data_as_of`.
5. Package or copy files into the selected snapshot path.
6. Retain the previous `latest` package before replacement.
7. Push only to the backup repo or protected data branch when `market_cache_mode=apply`.
8. Emit a concise backup status in the workflow summary.

The existing `backup-market-cache.mjs` already supports dry-run and apply, builds SHA256 manifests, and excludes dashboard HTML/data artifacts. Production apply mode should add series-level validation before manifest write.

## 11. Modes

- `off`: do nothing. Default for all workflows.
- `dry-run`: validate restore/backup plans and manifests, but no local cache writes and no pushes.
- `apply`: restore/write/push backup data after all guardrails pass.

`apply` must require a dedicated secret such as `AURORA_MARKET_CACHE_PAT` or a renamed `AURORA_MARKET_DATA_BACKUP_PAT` with access limited to the backup destination.

## 12. Guardrails

Production guardrails:

- Never commit backup data to source PRs.
- Never run apply mode on `pull_request`.
- Never force-push the backup branch.
- Never mix providers inside one indicator series.
- Fail safely on checksum mismatch.
- Retain previous snapshot before replacing `latest`.
- Backup must not block source-only PR tests.
- Apply mode must be manual or explicitly scheduled after dry-run has passed.
- Backup pushes must target only the backup repo or protected data branch.
- Manifest and path validation must run before restore and before backup.

## 13. Validation Commands

Source-repo validation:

```bash
node --test scripts/market-data-backup/tests/*.test.mjs
node --test scripts/market-cache/tests/*.test.mjs
node scripts/market-data-backup/validate-backup-paths.mjs --root <absolute-external-backup-root>
node scripts/market-data-backup/validate-market-data-manifest.mjs --file scripts/market-data-backup/tests/fixtures/valid-manifest.json
```

Dry-run restore/package examples:

```bash
node scripts/market-cache/restore-market-cache.mjs --market us --cache-repo ../aurora-market-cache --snapshot latest --snapshot-id latest
node scripts/market-cache/backup-market-cache.mjs --market us --cache-repo ../aurora-market-cache --snapshot latest --snapshot-id latest
```

Generated artifact guard:

```bash
git diff --name-only | grep -E '(^|/)dashboard/cache/|(^|/)dashboard/data/.*json$|AURORA_.*Dashboard.*html$|AURORA_.*Unified_Dashboard.*html$|(^|/)cache/|(^|/)public/|.parquet$|.jsonl.gz$|.csv.gz$|.zip$' && echo "GENERATED_ARTIFACT_FOUND" || echo "NO_GENERATED_FILES"
```

Expected for ordinary source PRs: `NO_GENERATED_FILES`.

## 14. GitHub Actions Design

Workflow input mapping:

- `market_cache_mode=off`: skip restore and backup.
- `market_cache_mode=dry-run`: run restore/backup scripts without `--apply`; do not write local cache or push.
- `market_cache_mode=apply`: run restore/backup scripts with `--apply`, but only outside pull requests and only when the backup secret exists.
- `market_cache_snapshot`: map to `latest`, `weekly`, or `monthly`.
- `market_cache_snapshot_id`: map to `latest`, `YYYY-WW`, or `YYYY-MM`.

Required secret:

- Current: `AURORA_MARKET_CACHE_PAT`.
- Preferred production rename: `AURORA_MARKET_DATA_BACKUP_PAT`.

Pull-request behavior:

- Apply mode must be unavailable on `pull_request`.
- Dry-run validation may run on source PRs only if it does not require private backup secrets or real backup data.
- Source-only tests must not fail because the backup repo is unavailable.

Status reporting:

- Print mode, market, snapshot, snapshot id, manifest path, file count, total bytes, and applied/dry-run result.
- Redact all tokens and remote URLs containing credentials.
- Record skipped reason when mode is `off` or secret is unavailable in dry-run.

## 15. Rollback / Restore Instructions

Source rollback:

1. Restore source from the stable tag or create a recovery branch from it.
2. Do not force-reset `main` without explicit approval.

Market-cache rollback:

1. Select the last good backup snapshot.
2. Validate its manifest and checksums.
3. Restore the market cache with dry-run first.
4. Restore with apply only after validation passes.
5. Rerun the dashboard workflow for the target market.
6. Verify backup `latest.json` or market manifest plus scan JSON freshness.

If a backup package is bad, revert the backup repo or protected data branch commit and mark the package `STALE`, `PARTIAL`, or `CONFLICT` in validation reports.

## 16. Implementation Phases

Phase A: document and tests only.

- Keep current PR source-only.
- Maintain generated-artifact guard.
- Do not run apply mode.

Phase B: dry-run restore/package for US.

- Use synthetic or private backup fixtures only.
- Prove restore and backup plans in `dry-run`.
- Add allowed-root validation for restore destinations.

Phase C: apply mode for US.

- Enable manual US apply mode with dedicated backup secret.
- Add previous-latest retention.
- Add series-level validation before backup push.

Phase D: extend to India/Canada.

- Reuse the same contract.
- Add market-specific metadata such as India delivery and corporate actions where available.
- Keep country workflows isolated.

Phase E: scheduled weekly/monthly snapshots.

- Add scheduled immutable weekly/monthly backup runs.
- Keep source PR tests independent from backup availability.
- Publish concise backup status summaries and rollback pointers.
