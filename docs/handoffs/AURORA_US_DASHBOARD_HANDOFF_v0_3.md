# AURORA US Unified Dashboard Handoff v0.3

## Current State

The US dashboard now follows the unified India-style architecture:

- One stable HTML dashboard: `AURORA_US_Dashboard.html`
- One code package / handoff bundle: `AURORA_US_UNIFIED_UPDATE_v0_3.zip`
- Two workspaces inside the dashboard:
  - Core AURORA
  - IPO / PEAD / EP / HVE Events
- No separate weekly, daily or event dashboards.
- No separate weekly, daily or event automation should be created.

## Schedule Lock

Run at 9:00 a.m. America/New_York.

- Sunday:
  - Rebuild complete eligible US universe.
  - Select fresh 15-20 `WEEKLY_UNIVERSE`.
  - Maintain persistent weekly continuity, but allow replacement.

- Monday-Friday:
  - Refresh event registry first.
  - Append only the latest completed daily bar when cache already exists.
  - Run lightweight full-universe discovery scan.
  - Update `WEEKLY_FOCUS`.
  - Produce max `DAILY_TOP_1_4` from `WEEKLY_FOCUS` only.
  - Allow stocks to enter, exit or be replaced midweek when fresh AURORA evidence justifies it.

## Data Routing Lock

US free-first route:

1. Official Nasdaq / NYSE / NYSE American directories, SEC EDGAR and issuer IR.
2. Yahoo Finance for validated OHLCV and quotes.
3. EODHD only when free data fails validation or lacks a required field.
4. Parallel Search for routine verification.
5. Tavily only for shortlisted weekly, IPO, PEAD or EP candidates.
6. Firecrawl only for difficult known documents.

Never blend providers inside one indicator series. Record provider, endpoint, data date, currency, adjustment status and fallback label.

## Key Runtime Commands

From repo root:

```bash
cd /workspace/aurora-us-dashboard
npm run scan:universe
npm run render:canonical
npm test
npm run build
npm run validate
npm run visual:validate
```

Current `scan:universe` flow:

```bash
node scripts/scan-universe.mjs &&
node scripts/enrich-sector-classification.mjs &&
node scripts/scan-universe.mjs &&
node scripts/scan-rs-leadership.mjs
```

## Current Validated Run

Latest validated session:

- Completed bar: `2026-06-18`
- Security master: `8,633`
- Current symbols: `7,425`
- Calculated symbols: `6,261`
- Coverage: `72.52%`
- Weekly Universe: `20`
- Daily Top: `4`
- Nasdaq screener sector cache rows ingested: `7,143`
- Mapped sector rows: `6,365`
- Unknown/partial sector rows: `778`

Validation passed:

- `npm run scan:universe`
- `npm run render:canonical`
- `npm test`
- `npm run build`
- `npm run validate`
- `npm run visual:validate`

## Chromium / Visual Validation

Chrome for Testing headless shell was installed locally from uploaded split files.

Installed path:

```bash
/workspace/aurora-us-dashboard/tools/chrome-headless-shell-linux64/chrome-headless-shell
```

Version:

```text
Google Chrome for Testing 150.0.7871.24
```

`scripts/visual-validate.sh` now auto-detects this project-local browser path, so `npm run visual:validate` works without manually setting `CHROMIUM_PATH`.

If the next workspace does not preserve `/workspace/aurora-us-dashboard/tools/`, upload the Chrome split files again or re-download Chrome for Testing Linux64 headless shell.

## Dashboard Structure

Required displayed sections:

- Market Summary Strength Stack first
- Weekly Universe
- Weekly Focus
- Daily Top 1-4
- AURORA-RSLE Top 20
- AURORA-RSLE Developing 21-40
- Developing Watchlist 20
- IPO / PEAD / EP / HVE Event Workspace
- RS21 / RSNH
- PBX Pullback
- Compression / VCP
- BasePivot / Patterns
- RMVP / Early Entry
- VE2 Volume Signature
- Sector and Theme RRG
- RRG legend
- No-Chase / Risk
- Rejected / Data Repair
- Provenance

## Important UI Decisions

- User-facing stock tables must show `User Note`.
- Do not show RRG `direction` in stock tables. It is internal scoring context only.
- RRG user-facing field should show quadrant only.
- Rejected / Data Repair must include user note and remain searchable.
- Long metric-card values must wrap, not clip.

## RSLE / Dual Stop Rules

Keep RS Trifecta as a conviction layer, but enhance discovery with:

- RS line vs EMA21
- RS 1W / 1M / 3M trend
- RS rating delta
- liquidity
- RRG quadrant and improving leadership evidence

Dual stop logic:

- `entry_stop` and `entry_risk_pct` for tactical execution.
- `thesis_stop` and `thesis_risk_pct` for structural invalidation.
- Wide thesis risk must not reject RS leaders if tactical entry risk is valid.

## Sector Mapping

Sector stock mapping uses:

```bash
config/gics_sector_proxy_map.json
cache/us/fundamentals/sector-classification.json
```

Nasdaq screener aliases include:

- `Finance` -> `Financials`
- `Telecommunications` -> `Communication Services`

Sector RRG now includes stock count, RS leader count and representative symbols.

## Files Modified In v0.3

Core package includes:

- `AURORA_US_Dashboard.html`
- `package.json`
- `config/gics_sector_proxy_map.json`
- `scripts/scan-universe.mjs`
- `scripts/scan-rs-leadership.mjs`
- `scripts/render-canonical.mjs`
- `scripts/enrich-sector-classification.mjs`
- `scripts/ingest-nasdaq-screener.mjs`
- `scripts/visual-validate.sh`
- `data/us-dashboard-state.json`
- `data/rs-leadership-scan.json`
- `cache/us/fundamentals/sector-classification.json`

## Files To Upload As Project Sources

Minimum required for the next chat:

1. `AURORA_US_DASHBOARD_HANDOFF_v0_3.md`
2. `AURORA_US_UNIFIED_UPDATE_v0_3.zip`
3. `AURORA_RSLE_DUAL_STOP_ADDENDUM_v0_3.md`
4. `AURORA_RS_LEADERSHIP_ENHANCEMENT_ADDENDUM_v0_2.md`
5. `AURORA_INDIA_DASHBOARD_FORMAT_LOCK.md`
6. `AURORA_MASTER_v2_18_2_WEEKLY_LIST_SINGLE_SOURCE_OF_TRUTH.md`
7. `AURORA_PROJECT_INSTRUCTIONS_RS_LOCK-1-.md`

Optional but useful:

- `AURORA_AXM_Production_Addendum_v1.0.md`
- `AURORA_PBX_Production_Addendum_v1.0.md`
- `AURORA_BPX_Production_Addendum_v1.0.md`
- `AURORA_VE2_Setup_Edge_Volume_Signature_Addendum_v0_1.md`
- `basepivots-and-rmvp-aurora-addendum.md`

Optional for visual validation if workspace resets:

- `chrome-headless-shell-linux64.zip.part-000`
- `chrome-headless-shell-linux64.zip.part-001`
- `chrome-headless-shell-linux64.zip.part-002`

