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
npm run cache:fetch:nse -- YYYY-MM-DD
npm run cache:append -- cache/india/raw/YYYY-MM-DD YYYY-MM-DD
npm run cache:audit -- cache/india/ohlcv YYYY-MM-DD
```

If the official host blocks automated downloading, download that day's official
bhavcopy in a browser and place it in the dated raw directory. No historical
refetch is needed.

## Discovery Rule

Liquidity, surveillance class and wide thesis stops never remove a symbol from
discovery. They are retained as ranking and execution cautions. Hard exclusions
are invalid data, inactive/non-equity instruments where the selected route does
not apply, or insufficient history for that calculation.
