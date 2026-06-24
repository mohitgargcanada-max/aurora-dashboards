# AURORA India Data Plane

Persistent free-first bulk OHLCV cache for the India dashboard.

## Dashboard Format Lock

Before changing the scanner or dashboard renderer, read:

```text
docs/AURORA_INDIA_DASHBOARD_FORMAT_LOCK.md
```

That file is the handoff source for the India dashboard structure, required
sections, market context labels, dual-stop logic, conviction layers, delivery
handling, shortlist-only pattern context, and verification steps.

## Bootstrap

Place official NSE/BSE bhavcopy CSV or ZIP files in one directory, then run:

```bash
npm run cache:universe -- /path/to/EQUITY_L.csv /path/to/BSE_security_master.csv
npm run cache:bootstrap -- /path/to/archive
npm run cache:audit
```

The archive may contain many daily files. Each source is SHA-256 recorded and
copied into the immutable raw cache. Normalized records retain the latest 420
bars per exchange and symbol.

Benchmark, sector and India VIX histories are cached separately under
`cache/india/indices`. They use EODHD only when the official Nifty Indices
download cannot provide the required range. Validate them with:

```bash
npm run cache:audit:indices -- cache/india/indices YYYY-MM-DD
```

## Daily Append

```bash
npm run cache:refresh:daily -- YYYY-MM-DD
npm run scan:full
```

`scan:full` is the scheduled-safe command. It refreshes or appends the latest
completed India daily bar before running AURORA calculations. It must not be
replaced by a cache-only scan in scheduled jobs.

The daily route is:

1. local official NSE/BSE files in `data/incoming/YYYYMMDD`,
   `data/incoming/YYYY-MM-DD`, or `cache/india/raw/YYYY-MM-DD`;
2. one official NSE/BSE fetch attempt;
3. TapeTide daily-bar endpoint when configured;
4. Yahoo `.NS` / `.BO` one-day fallback when validated;
5. EODHD one-day fallback only as the final repair route.

If the official host blocks automated downloading, download that day's official
bhavcopy in a browser and place it in the dated raw directory. No historical
refetch is needed. If no route can refresh the completed session, the command
writes `data/india-daily-refresh-report.json`, reports `DATA_REFRESH_BLOCKED`,
and preserves the last-good dashboard.

Use this only for diagnostics or historical replays:

```bash
npm run scan:full:cache-only -- YYYY-MM-DD
```

## Discovery Rule

Liquidity, surveillance class and wide thesis stops never remove a symbol from
discovery. They are retained as ranking and execution cautions. Hard exclusions
are invalid data, inactive/non-equity instruments where the selected route does
not apply, or insufficient history for that calculation.
