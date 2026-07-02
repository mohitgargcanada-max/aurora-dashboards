# History Depth Audit: US, India, Canada

Source-only audit. No fetch, restore apply, backup apply, workflow change, formula change, threshold change, provider-routing change, final-bucket change, generated dashboard artifact, or cache artifact was created for this audit.

Audit command:

```bash
node scripts/market-cache/audit-history-coverage.mjs --market all
```

## Required Distinction

| Market | Capability exists | Historical data fetched at some point | Historical data currently restored into active scan path and used by dashboard scan |
| --- | --- | --- | --- |
| US | Yes. `markets/us/dashboard/scripts/repair-us-history-5y.mjs`, `markets/us/dashboard/scripts/refresh-or-repair-us-data.mjs`, and `markets/us/dashboard/tests/history-repair.test.mjs`. Commit evidence: `052340ae293393df7ef9820e85370a09843d38f0` (`Add US provider-consistent 5Y history repair`). | Yes. Active reports exist: `us-history-repair-report.json` status `UPDATED`, retrieved `2026-07-01T19:56:42.675Z`, latest data `2026-06-30`; `us-daily-refresh-report.json` status `PARTIAL_CURRENT_SESSION`. | Yes for the active US scan root `markets/us/dashboard/cache/us/ohlcv`, and scan output exists at `markets/us/dashboard/data/us-full-dashboard-scan.json`. Depth is not strict 5Y-plus across the full universe: median `1255`, max `1271`, only `2` symbols `>=1260`. |
| India | Yes. PR #3 added `markets/india/dashboard/scripts/backfill-india-history.mjs`; PR #44 adds source-only seed/restore planning and validation tooling. | Yes for recent daily/cache data. No evidence that `backfill-india-history.mjs` ran recently: `markets/india/dashboard/data/india-history-backfill-report.json` is absent. | Yes, the active India scan root is `markets/india/dashboard/cache/india/ohlcv`, and scan output exists. However active cache maxes at `423` usable bars, so 2Y/3Y/5Y MYH is not restored into the active path. |
| Canada | Yes. `markets/canada/dashboard/scripts/backfill-canada-history.mjs` fetches `range: "5y"` via the Canada provider route; `run-full-dashboard-scan.mjs` imports it if the OHLCV root is missing. | No local active-path proof found. | No. Active root `markets/canada/dashboard/cache/canada/ohlcv` does not exist in this branch, and `markets/canada/dashboard/data/canada-full-dashboard-scan.json` is absent. |

## Required Output Table

| Market | Capability found | Capability evidence | Active cache root | Active symbols | Earliest | Latest | Max bars | Median bars | >=1500 | >=1260 | >=756 | >=504 | <504 | MYH mode | Current classification | Refetch/restore needed |
| --- | --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| US | Yes | Commit `052340ae293393df7ef9820e85370a09843d38f0`; `repair-us-history-5y.mjs`; `refresh-or-repair-us-data.mjs`; `history-repair.test.mjs`; active `us-history-repair-report.json` | `markets/us/dashboard/cache/us/ohlcv` | 11952 | 2021-06-28 | 2026-06-30 | 1271 | 1255 | 0 | 2 | 7883 | 8673 | 3279 | `HISTORY_OK_52W_ONLY` | `HISTORY_OK_52W_ONLY` for current MYH wiring; active cache is partial-near-5Y, not full strict 5Y-plus | No for current 52W-mode scan; yes if strict 5Y-plus MYH coverage is required across the universe |
| India | Yes | PR #3 `backfill-india-history.mjs`; PR #44 source-only India 5Y seed/restore plan and validators | `markets/india/dashboard/cache/india/ohlcv` | 8021 | 2024-10-01 | 2026-07-01 | 423 | 32 | 0 | 0 | 0 | 0 | 8021 | `TRUE_2Y_3Y_5Y` | `BACKFILL_CAPABILITY_EXISTS_BUT_CACHE_NOT_RESTORED` / `PARTIAL_RECENT_REFRESH_ONLY` | Yes, restore or refetch long history before accepting MYH insufficiency as final |
| Canada | Yes | `backfill-canada-history.mjs` uses `range: "5y"`; `run-full-dashboard-scan.mjs` can trigger it when cache root is missing | `markets/canada/dashboard/cache/canada/ohlcv` | 0 | null | null | null | null | 0 | 0 | 0 | 0 | 0 | `HISTORY_OK_52W_ONLY` | `CACHE_NOT_FOUND` | Yes, restore or refetch is required before scan-path history can be proven |

## Active Cache Depth Detail

| Market | Symbols | Earliest | Latest | Min bars | Median bars | Max bars | >=1500 | >=1260 | >=756 | >=504 | <504 | No usable history |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| US | 11952 | 2021-06-28 | 2026-06-30 | 1 | 1255 | 1271 | 0 | 2 | 7883 | 8673 | 3279 | 0 |
| India | 8021 | 2024-10-01 | 2026-07-01 | 1 | 32 | 423 | 0 | 0 | 0 | 0 | 8021 | 0 |
| Canada | 0 | null | null | null | null | null | 0 | 0 | 0 | 0 | 0 | 0 |

## Active Scan List Coverage

| Market | List | Scan key | Symbols | Cache matches | >=1500 | >=1260 | >=756 | >=504 | <504 | Missing symbols |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| US | Weekly Universe | `weekly_universe` | 20 | 20 | 0 | 0 | 20 | 20 | 0 | none |
| US | RSLE | `rsle_top_20` | 20 | 20 | 0 | 0 | 19 | 20 | 0 | none |
| US | Developing Watchlist | `developing_watchlist` | 20 | 20 | 0 | 0 | 18 | 19 | 1 | none |
| India | Weekly Universe | `weekly_universe` | 20 | 20 | 0 | 0 | 0 | 0 | 20 | none |
| India | RSLE | `rsle_top20` | 20 | 20 | 0 | 0 | 0 | 0 | 20 | none |
| India | Developing Watchlist | `developing_watchlist_20` | 20 | 20 | 0 | 0 | 0 | 0 | 20 | none |
| Canada | Weekly Universe | not available | 0 | 0 | 0 | 0 | 0 | 0 | 0 | scan missing |
| Canada | RSLE | not available | 0 | 0 | 0 | 0 | 0 | 0 | 0 | scan missing |
| Canada | Developing Watchlist | not available | 0 | 0 | 0 | 0 | 0 | 0 | 0 | scan missing |

## US Notes

- Active scan root: `markets/us/dashboard/cache/us/ohlcv`.
- Active scan path: `markets/us/dashboard/data/us-full-dashboard-scan.json`.
- `scan-universe.mjs` reads the active cache root directly.
- `refresh-or-repair-us-data.mjs` uses the same root and can invoke `repairUsHistory`.
- `history-repair.test.mjs` proves the repair route can write provider-consistent history in fixtures.
- Current MYH is not true 2Y/3Y/5Y in the US scanner. The scanner uses `price52Prox` / `S01_52W_HIGH`, and shared MYH approaching treats that as `MYH_52W`.
- Classification: `HISTORY_OK_52W_ONLY`. The active cache is deep enough for 2Y/3Y coverage on many names, but it is not strict 5Y-plus by the `>=1260` or `>=1500` thresholds across the full universe.

## India Notes

- Active scan root: `markets/india/dashboard/cache/india/ohlcv`.
- Active scan path: `markets/india/dashboard/data/india-full-dashboard-scan.json`.
- India scanner has true MYH windows: `MYH_5Y = 1260`, `MYH_3Y = 756`, `MYH_2Y = 504`.
- Current active cache maxes at `423` usable bars. Therefore `MYH_HISTORY_INSUFFICIENT` is legitimate for the current active files, but the deeper issue is that the 5Y cache/backfill is not restored into the active scan path.
- `markets/india/dashboard/data/india-history-backfill-report.json` is absent, so there is no local evidence that `backfill-india-history.mjs` ran recently. It is neither a committed nor untracked generated report in the current working tree because the file is not present.
- Classification: `BACKFILL_CAPABILITY_EXISTS_BUT_CACHE_NOT_RESTORED` and `PARTIAL_RECENT_REFRESH_ONLY`.

## Canada Notes

- Active scan root expected by code: `markets/canada/dashboard/cache/canada/ohlcv`.
- Active scan output expected by code: `markets/canada/dashboard/data/canada-full-dashboard-scan.json`.
- The active OHLCV root is missing in this branch. The Canada scan output and daily refresh report are also absent.
- Canada has long-history capability: `backfill-canada-history.mjs` calls `fetchCanadaDaily(..., { range: "5y" })`.
- Canada MYH is currently a 52-week proxy: `scan-engine.mjs` sets `myh_label: "MYH_52W"` and `myh_lookback_sessions: 252`.
- Canada symbol normalization supports TSX `.TO` and TSXV `.V`: `canada-adapter.mjs` maps `TSX -> .TO`, `TSXV -> .V`; `eodhd-client.mjs` preserves `.TO` / `.V` and maps TSXV to `.V`.
- Classification: `CACHE_NOT_FOUND`.

## Conclusion

- US: capability exists, historical repair/fetch evidence exists, and active scan-path cache exists. Refetch/restore is not needed for the current 52W-mode scan, but is needed if the requirement is strict 5Y-plus MYH across the full universe.
- India: capability exists, but active scan-path cache is recent-only. Restore or refetch long history before relying on India 2Y/3Y/5Y MYH.
- Canada: capability exists, but no active cache root or scan output exists locally. Restore or refetch before any dashboard scan-path history claim.
