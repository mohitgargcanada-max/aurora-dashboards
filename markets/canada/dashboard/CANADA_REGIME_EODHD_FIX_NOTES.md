# Canada Regime + EODHD Fallback Fix

## Purpose

Fix Canada dashboard market-regime blocking caused by optional proxy staleness and add a real EODHD fallback path behind Yahoo Finance.

## Changes

- Primary market-regime blocking now depends on `^GSPTSE` freshness.
- Optional context proxies (`XIC.TO`, `XIU.TO`, `XIT.TO`, `XEG.TO`) degrade market context to `INDEX_CONTEXT_PARTIAL` instead of blocking the entire dashboard.
- Added `eodhd-client.mjs` for normalized EODHD EOD OHLCV.
- Added `canada-data-provider.mjs` for free-first routing:
  1. Yahoo Finance
  2. EODHD fallback only after Yahoo failure, stale completed bar, or insufficient history
- EODHD adjusted-close normalization applies the adjusted-close ratio to open/high/low/close when `adjusted_close` is present.
- Provider blending remains blocked.
- Workflow passes `EODHD_API_TOKEN` only to non-PR live validation/deploy paths.

## Acceptance

- PR validation should run without secrets using fixture smoke scan.
- Main push / workflow_dispatch should use Yahoo first and EODHD only if needed.
- Dashboard provenance should show `EODHD_FALLBACK_ENABLED_ONLY_AFTER_YAHOO_FAILURE_STALE_OR_INCOMPLETE`.
- Canada remains EOD-only.
- RS still means benchmark-relative strength, never RSI.
