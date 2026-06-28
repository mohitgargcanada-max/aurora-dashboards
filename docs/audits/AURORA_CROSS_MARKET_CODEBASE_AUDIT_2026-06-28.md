# AURORA Cross-Market Codebase Audit

Date: 2026-06-28
Scope: US, India, and Canada dashboard codebase audit only
Branch: `codex/aurora-cross-market-audit`
Base checked: `dab5b2874 [codex] Standardize cross-market dashboard UI clarity (#17)`

## Verdict

Status: `PASS_WITH_FINDINGS`

All three dashboards appear operational from local tests and read-only Pages HEAD checks. The highest-risk area is not AURORA calculation logic; it is generated artifact and workflow policy drift across markets.

No source logic changes were made by this audit. This report is the only intended PR artifact.

## Audit Boundaries

This audit did not run live scans, refresh jobs, or workflows. It did not change formulas, scoring, RS/RMV logic, pivots, buckets, ranking, provider routing, execution logic, data acquisition, workflow cadence, generated dashboard files, cache files, or dashboard JSON data.

Reviewed areas:

- Market source partitioning for US, India, and Canada.
- Provider fallback and provenance guards.
- AURORA bucket and setup-label separation.
- RS wording and RSI ambiguity.
- Workflow triggers, permissions, path filters, install steps, generated-output behavior, and Pages helpers.
- Package dependencies and basic import hygiene.
- Generated artifact tracking policy.
- Market-specific leakage signals.
- Duplicated code drift and missing cross-market tests.

## Validation Run

Local tests:

- `npm --prefix markets/us/dashboard test`: passed.
- `npm --prefix markets/india/dashboard test`: passed.
- `npm --prefix markets/canada/dashboard test`: passed.

Read-only Pages availability checks:

- `curl.exe -I https://mohitgargcanada-max.github.io/aurora-dashboards/us/`: `HTTP/1.1 200 OK`.
- `curl.exe -I https://mohitgargcanada-max.github.io/aurora-dashboards/india/`: `HTTP/1.1 200 OK`.
- `curl.exe -I https://mohitgargcanada-max.github.io/aurora-dashboards/canada/`: `HTTP/1.1 200 OK`.

Dependency/import check:

- India uses `adm-zip` in `markets/india/dashboard/scripts/refresh-india-daily-bars.mjs` and `markets/india/dashboard/scripts/ingest-bhavcopy.mjs`; it is declared in `markets/india/dashboard/package.json`.
- US visual validation references Playwright browser cache discovery in `markets/us/dashboard/scripts/visual-validate.sh`; no undeclared runtime JS dependency was found in the audited script paths.
- No unexpected `axios`, `undici`, `node-fetch`, `papaparse`, `lodash`, `csv-parse`, or `csv-stringify` imports were found in active dashboard code outside generated artifacts.

Generated artifact guard for this audit PR:

- No generated dashboard, cache, or data artifact was created or changed by this audit branch before report authoring.

## Highest-Risk Finding

### HIGH_RISK_AMBIGUITY WF-001: Generated artifact policy differs by market

US and India workflows still commit generated dashboard outputs back to the repository, while Canada validates and deploys without a generated-output commit step.

Evidence:

- `.github/workflows/us-dashboard.yml:261` adds `markets/us/dashboard/data`, `markets/us/dashboard/cache`, and `markets/us/AURORA_US_Dashboard.html`.
- `.github/workflows/us-dashboard.yml:266` commits with `Update AURORA US dashboard`.
- `.github/workflows/india-dashboard.yml:53` adds `markets/india/dashboard/data`, `markets/india/dashboard/cache`, and `markets/india/AURORA_India_Unified_Dashboard.html`.
- `.github/workflows/india-dashboard.yml:55` commits with `Update AURORA India dashboard`.
- `.github/workflows/canada-dashboard.yml:29` uses `contents: read`, and the Canada workflow has no generated-output commit step in the audited path.

Risk:

- Cross-market workflow behavior is inconsistent.
- Generated files can dominate diffs and obscure source changes.
- Automated commits can create merge noise, retention drift, and review ambiguity.
- The repo already tracks many artifact-like paths under `cache/`, `dashboard/data/*.json`, and dashboard HTML outputs, so future source-only PRs need stricter guards.

Recommended next PR:

- Create a narrow workflow/generated-artifact policy PR that decides whether generated dashboard outputs remain tracked for US/India or move to artifact-only deploy behavior like Canada.

## Findings

### CONFIRMED_BUG

No confirmed runtime calculation, scoring, bucket, ranking, RS/RMV, pivot, provider-routing, data-acquisition, or execution-logic bug was found in the static audit plus local tests.

### HIGH_RISK_AMBIGUITY

#### WF-001: Generated artifact policy differs by market

See highest-risk finding above.

#### WF-002: Canada Pages helper publishes all markets from a Canada-named helper

`scripts/prepare-canada-pages-artifact.sh` is invoked by Canada workflow paths, but it prepares a unified Pages site for US, India, and Canada.

Evidence:

- `scripts/prepare-canada-pages-artifact.sh:6` sets `us_root`.
- `scripts/prepare-canada-pages-artifact.sh:7` sets `india_root`.
- `scripts/prepare-canada-pages-artifact.sh:8` sets `canada_root`.
- `scripts/prepare-canada-pages-artifact.sh:9` requires the US dashboard HTML.
- `scripts/prepare-canada-pages-artifact.sh:10` requires the India dashboard HTML.
- `.github/workflows/canada-dashboard.yml:124` runs `bash scripts/prepare-canada-pages-artifact.sh public`.

Risk:

- The helper name and Canada workflow path filters imply Canada-only behavior, but the helper has cross-market responsibilities.
- A Canada-only deploy path can fail because a US or India artifact is missing.
- Future reviewers may miss cross-market coupling because it is hidden behind a Canada-named script.

Recommended fix:

- Rename or split the helper in a future PR: either `prepare-pages-artifact.sh` for unified publishing, or market-specific helpers for each dashboard.

#### CFG-001: Canada routing config lives under the US dashboard config tree

Evidence:

- `markets/us/dashboard/config/ca_market_routes.json:4` references `source_routing_lock.json`.
- `markets/us/dashboard/config/ca_market_routes.json:8` maps `TSX` to `.TO`.
- `markets/us/dashboard/config/ca_market_routes.json:9` maps `TSXV` to `.V`.

Risk:

- This did not appear to be executable leakage into Canada runtime during the audit, but Canada policy living under `markets/us/dashboard/config` is a maintenance trap.
- Future US-only config edits could unintentionally alter Canada route policy.

Recommended fix:

- Move or mirror Canada-specific route config under `markets/canada/dashboard/config` in a dedicated follow-up PR, with a compatibility check if any old path is still imported.

### MEDIUM_RISK_TECH_DEBT

#### WF-003: US workflow has no explicit package install step

Evidence:

- `.github/workflows/us-dashboard.yml:27` sets up Node.
- `.github/workflows/us-dashboard.yml:180` runs the US renderer.
- `.github/workflows/us-dashboard.yml:181` runs `npm test`.
- No `npm ci --prefix markets/us/dashboard` line was found in the US workflow.

Risk:

- This is currently low-impact because the US dashboard package has no declared dependencies, but it becomes brittle if dependencies are added later.

Recommended fix:

- Add an explicit US install step only when the package actually needs dependencies, or add a workflow assertion that the package remains dependency-free.

#### WF-004: US Pages preparation is inline, India and Canada use helpers

Evidence:

- India deploy uses `scripts/prepare-india-pages-artifact.sh`.
- Canada deploy uses `scripts/prepare-canada-pages-artifact.sh`.
- No `scripts/prepare-us-pages-artifact.sh` exists.

Risk:

- Pages behavior is harder to compare across markets.
- Future market additions may copy inconsistent workflow patterns.

Recommended fix:

- Normalize Pages preparation once the generated-artifact policy is decided.

#### ARCH-001: Similar market contracts are implemented separately

Examples:

- Cache/freshness/provider provenance concepts exist in each market, but implementation boundaries differ.
- Final bucket locking exists across markets, but shared contract tests are limited.
- Provider fallback guards exist in each market, but the assertion style is market-specific.

Risk:

- Market-specific behavior is expected, but shared invariants can drift silently.

Recommended fix:

- Add a cross-market contract test suite that validates final buckets, provenance fields, no token leakage, and no generated artifact changes in PR validation.

### LOW_RISK_CLEANUP

#### DOC-001: Some Canada documentation appears stale versus current EODHD fallback tests

Canada code and tests now assert EODHD fallback behavior, including provider-blend blocking and the provenance phrase `EODHD_FALLBACK_ENABLED_ONLY_AFTER_YAHOO_FAILURE_STALE_OR_INCOMPLETE`. Some older notes should be reviewed for stale "not implemented" wording before being used as source-of-truth.

#### DOC-002: India format docs include diagnostic labels that are not final buckets

`markets/india/dashboard/docs/AURORA_INDIA_DASHBOARD_FORMAT_LOCK.md:288` mentions `EXTENDED_NO_CHASE`. Executable India final bucket assignment still maps to the locked bucket set in `markets/india/dashboard/scripts/run-full-dashboard-scan.mjs:583-590`.

#### TESTFIX-001: Old US worker smoke data contains `final_bucket: null`

`markets/us/dashboard/worker/smoke-data.js:45` has scaffold smoke data with `final_bucket: null`. This did not appear to be part of the current canonical dashboard output path, but it can confuse static searches.

### TEST_GAP

#### GAP-001: No cross-market generated-artifact policy test

There is no single test that fails a PR when generated dashboard/cache/data artifacts are changed outside approved workflow-generated commits.

#### GAP-002: No shared final bucket contract across all markets

Each market has local bucket behavior or tests, but a single cross-market invariant test would better protect against accidental `RSLE_*`, diagnostic, or `null` values in final dashboard rows.

#### GAP-003: No workflow coupling test for Pages helpers

The Canada helper's unified publishing role is not encoded as an intentional contract. A future check should assert whether helpers are market-only or unified.

#### GAP-004: No source-config locality guard

No test currently prevents Canada route policy from living under the US dashboard config tree.

### NO_ACTION_REQUIRED

The following audit checks passed or did not require changes:

- US, India, and Canada dashboard test suites passed locally.
- US, India, and Canada public dashboard paths returned `HTTP/1.1 200 OK`.
- India PR #12-style EODHD provider-consistency guard remains present and tested:
  - `markets/india/dashboard/scripts/refresh-india-daily-bars.mjs:813`
  - `markets/india/dashboard/tests/daily-refresh.test.mjs:348`
- Canada provider-blend blocking remains present and tested:
  - `markets/canada/dashboard/engine/scan-engine.mjs:112-113`
  - `markets/canada/dashboard/tests/canada-dashboard.test.mjs:60-62`
- US provider fallback provenance and token leak tests remain present:
  - `markets/us/dashboard/scripts/scan-rs-leadership.mjs:356`
  - `markets/us/dashboard/tests/daily-refresh.test.mjs:234-238`
- Canada EODHD fallback provenance is explicitly tested:
  - `markets/canada/dashboard/tests/canada-dashboard.test.mjs:112`
- RS copy and UI copy tests confirm RS means relative strength, not RSI.
- No static evidence was found that RSI is substituted for benchmark-relative RS in the audited dashboard code.
- No active source evidence was found of US symbols leaking into India/Canada, India symbols leaking into US/Canada, or Canada symbols leaking into India runtime code after excluding generated/cache/data/HTML artifacts.

## Market Review

### US

Status: `PASS_WITH_FINDINGS`

Healthy signals:

- Test suite passed.
- Pages HEAD check returned `HTTP/1.1 200 OK`.
- Canonical renderer exists at `markets/us/dashboard/scripts/render-canonical.mjs`.
- Provider provenance is preserved in the RS leadership path.
- EODHD fallback tests assert fallback label behavior and secret-token non-leakage.
- Final dashboard bucket paths use the locked bucket vocabulary.

Findings:

- Workflow commits generated outputs.
- Workflow lacks an explicit package install step, currently acceptable because no package dependencies are declared.
- US Pages preparation is inline rather than helper-based.
- Canada route config currently exists under the US config tree.

### India

Status: `PASS_WITH_FINDINGS`

Healthy signals:

- Test suite passed.
- Pages HEAD check returned `HTTP/1.1 200 OK`.
- `npm ci --prefix markets/india/dashboard` exists in the workflow.
- `adm-zip` imports are declared.
- EODHD provider-consistency repair warning remains tested.
- Final bucket assignment maps setup labels into locked final buckets.

Findings:

- Workflow commits generated outputs.
- Some docs mention diagnostic labels that should not be confused with final buckets.

### Canada

Status: `PASS_WITH_FINDINGS`

Healthy signals:

- Test suite passed.
- Pages HEAD check returned `HTTP/1.1 200 OK`.
- Workflow validates PRs using tests and fixture smoke scan.
- Workflow uses `contents: read` and does not commit generated outputs.
- Provider-blend blocking is enforced.
- EODHD fallback route is tested as a fallback after Yahoo failure, stale, or incomplete data.
- Final bucket assignment clamps to the locked set.

Findings:

- Canada Pages helper is actually a unified Pages helper for all three markets.
- Some older documentation may need refresh against current fallback implementation.

## Workflow Review

### Triggers And Cadence

- US, India, and Canada have separate workflows and market-specific time gates.
- No cadence change is recommended in this audit-only PR.
- Canada PR validation is path-filtered to Canada dashboard paths plus the Canada helper.

### Permissions

- Canada uses read-only contents permission for validation and deploy-specific Pages permissions for deployment.
- US and India use contents write because they currently commit generated outputs.

### Generated Output Behavior

- US and India generated-output commits are intentional in current workflow code but create the highest cross-market policy risk.
- Canada is closer to source-only/deploy-artifact behavior.

## Provider Integrity Review

### US

US uses free-first/provider provenance paths with fallback labeling. Tests cover EODHD fallback label behavior and prevent token leakage into reports. No provider-routing change is recommended here.

### India

India keeps provider-specific route metadata and explicitly warns on EODHD provider-consistency repair requirements. The PR #12-style guard remains present and tested. No provider-routing change is recommended here.

### Canada

Canada uses Yahoo primary with EODHD fallback and blocks mixed-provider bars through provider-blend guard logic. The fallback status is surfaced and tested. No provider-routing change is recommended here.

## AURORA Logic Lock Review

No source changes were made, and the audit found no static evidence of accidental changes to:

- AURORA formula logic.
- Scoring.
- RS/RMV calculations.
- Pivot calculation.
- Bucket assignment semantics.
- Ranking and sort behavior.
- Provider routing.
- Execution logic.
- Data acquisition logic.

Final bucket vocabulary is preserved across current active paths. Setup labels and diagnostic labels still exist, but active final bucket assignment is mapped or clamped to the locked bucket vocabulary.

## Market Leakage Review

No active runtime leakage requiring immediate code changes was found.

Notes:

- Search hits for `NSE` in US/Canada were mostly false positives from words such as `DEFENSE`.
- Search hits for Canada symbols under US included actual Canada route config files under `markets/us/dashboard/config`, which is tracked as `CFG-001`.
- Canada source naturally contains `.TO`, `.V`, TSX, and Canadian theme examples.
- The Canada Pages helper intentionally references all markets, tracked as `WF-002`.

## Generated Artifact Hygiene

Current audit PR status:

- No generated artifacts changed by this PR.
- The intended changed file is only `docs/audits/AURORA_CROSS_MARKET_CODEBASE_AUDIT_2026-06-28.md`.

Existing repository status:

- The repository tracks many existing artifact-like paths under cache, dashboard data JSON, and rendered dashboard HTML locations.
- US and India workflows intentionally commit generated artifacts today.
- Canada workflow does not commit generated artifacts in the audited path.

Recommendation:

- Decide and document whether dashboard output artifacts are source-of-truth history or deploy-only build products.
- Add a CI guard after the policy is decided.

## Recommended Next PR

Next PR should be a narrow workflow/generated-artifact policy PR.

Suggested title:

`[codex] Normalize dashboard generated-artifact policy`

Suggested scope:

- Decide whether US/India generated outputs stay tracked or move to Pages artifact-only deploy.
- Rename or split `scripts/prepare-canada-pages-artifact.sh`.
- Add a generated-artifact guard for source PRs.
- Add cross-market invariant tests for final buckets and provider provenance.

Do not combine that PR with formula, ranking, provider-routing, or scan logic changes.
