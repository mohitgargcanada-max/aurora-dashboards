# AURORA Routine Alignment + Daily Discovery + AI Catalyst + ISM Sidecar Addendum v0.1

## 1. Purpose

The TraderLion comparison identified a promotion and surfacing gap, not a core technical-engine failure.

AURORA's core technical engine is working. The missing layer is the discovery, surfacing, and promotion funnel that decides which technically valid names deserve more daily attention without destabilizing the locked Weekly Universe.

This addendum defines:

- `AURORA_DAILY_DISCOVERY_WIDE_LIST` for current rotation and emerging technical events.
- `AURORA_DAILY_FOCUS_CANDIDATES` for the smaller daily review set.
- AURORA-CAT v0.1 as an AI catalyst sidecar.
- AURORA-ISM v0.1 as an institutional and smart-money sidecar.

Daily Discovery should catch fresh rotation, new momentum, and actionable technical events. AI, catalyst, premarket, institutional, and smart-money layers are context and prioritization only. They must not replace Weekly Universe selection or AURORA's locked technical gates.

## 2. Hard Non-Disruption Locks

Locked boundaries:

- Do not change AURORA final buckets.
- Do not change AURORA-SIG weights.
- Do not replace RS, BPX, PBX, VE2, AXM, RRG, MC2, RSLE, dual stops, or market permission.
- Do not let AI, catalyst, Google/Gemini, news, sentiment, institutional, or smart-money data promote a stock by itself.
- No full-universe catalyst, news, social, institutional, or smart-money enrichment.
- Core OHLCV feature matrix remains the only full-universe daily calculation.

The sidecars may explain, annotate, prioritize, or help analysts understand candidates that already surfaced through technical evidence. They may not create final buckets or bypass mandatory gates.

## 3. Daily Discovery Funnel

Daily Discovery adds a current-session surfacing lane without replacing the stable Weekly Universe.

Planned lists:

- `AURORA_DAILY_DISCOVERY_WIDE_LIST`: target 30-45 names.
- `AURORA_DAILY_FOCUS_CANDIDATES`: target 10-16 names.
- `DAILY_TOP_1_4`: remains max 4, ideally 1-3, and is never forced.

Weekly Universe remains stable, balanced, and suitable for continuity tracking. Daily Discovery is a separate funnel that catches:

- Current rotation.
- Fresh momentum.
- Weekly winners.
- RS surges.
- Breakouts.
- Gaps.
- RMV, BasePivot, PBX, and VE2 events.
- Technically constructive names that are close to promotion but blocked by one clear near-miss reason.

Suggested flow:

1. Full-universe OHLCV feature matrix runs as usual.
2. Daily Discovery extracts a wide technical event list.
3. Daily Focus Candidates rank the best technically valid or near-valid review names.
4. Daily Top stays small and only includes names that pass all locked gates.
5. CAT and ISM sidecars enrich shortlisted names only.

## 4. Promotion Guardrails

A daily-discovered name may enter Daily Top only if all normal locked gates pass:

- Liquidity.
- Not Stage 4.
- Not `AVOID_FRESH_LONG`.
- Not `NO_CHASE` unless reset or retest is valid.
- RS evidence present.
- Trigger proximity valid.
- Entry risk acceptable.
- Pattern-quality cap not blocking.
- Constructive VE2 and volume context.
- Valid market permission.
- Full mandatory fields available.

Daily Discovery may increase visibility, but it cannot override missing mandatory data, weak RS evidence, invalid market permission, excessive entry risk, or pattern-quality caps.

## 5. AURORA-CAT v0.1 - AI Catalyst Sidecar

AURORA-CAT is a sidecar for catalyst context on shortlisted symbols only.

Input:

- `symbol`
- `market`
- `event_date`
- Price and volume event
- AURORA list source
- Current bucket and setup

Output fields:

- `catalyst_status`
- `source_rank`
- `source_url`
- `published_at`
- `catalyst_type`
- `catalyst_subtype`
- `cqs`
- `dcw`
- `nsi`
- `ces_penalty`
- `catalyst_freshness`
- `materiality_score`
- `recency_score`
- `evidence_summary`
- `dashboard_note`
- `aurora_bucket_impact = NONE`

Source order by market:

- US: SEC EDGAR, company IR, exchange/newswire/official source, then tier-1 media.
- India: BSE announcements, NSE filings, company IR, SEBI/exchange source, then Moneycontrol, ET, or Business Standard as cross-check only.
- Canada: SEDAR+, TMX/company IR, official exchange/issuer source, then Globe and Mail or Financial Post as cross-check only.

CAT statuses:

- `CATALYST_CONFIRMED`
- `CATALYST_LIKELY`
- `CATALYST_NOT_FOUND`
- `OFFICIAL_SOURCE_NOT_FOUND`
- `SOURCE_CONFLICT`
- `PARTIAL`
- `STALE`

CAT may annotate the dashboard and help explain why a move happened. It must never change `final_bucket`, AURORA-SIG weights, market permission, or locked promotion gates.

## 6. Google/Gemini Catalyst Research Adapter

Use Gemini API with Google Search grounding as a research adapter for shortlisted symbols only.

Preferred model:

- `gemini-2.5-flash-lite`

Fallback model:

- `gemini-2.5-flash`

Rules:

- Do not use Google Custom Search JSON API because it is not a long-term path.
- Do not scrape Google Finance.
- Google/Gemini output must be verified against source URLs.
- Google/Gemini may suggest a likely catalyst, but cannot be treated as official unless the supporting source is official.
- Return structured JSON only.
- Fail safely with `CATALYST_NOT_FOUND`, `SOURCE_CONFLICT`, `OFFICIAL_SOURCE_NOT_FOUND`, or `PARTIAL`.

Required adapter behavior:

1. Accept only shortlisted symbols and event context.
2. Search for likely official catalyst sources first.
3. Return official URL evidence when found.
4. Mark cross-check media as non-official unless it links to or quotes the official filing/source.
5. Refuse to infer official status from model text alone.
6. Validate JSON schema before joining CAT output into dashboard data.

## 7. AURORA-ISM v0.1 - Institutional / Smart-Money Sidecar

AURORA-ISM is a sidecar for institutional and smart-money context on shortlisted symbols only.

Output fields:

- `ism_status`
- `smart_money_score`
- `smart_money_label`
- `institutional_score`
- `institutional_label`
- `key_signals`
- `false_positive_flags`
- `data_freshness`
- `dashboard_note`
- `aurora_bucket_impact = NONE`

Market-specific v0.1:

- India: FII/DII daily flow, delivery %, bulk/block deals where available, promoter pledge/shareholding quarterly.
- US: Form 4/OpenInsider where available, filtered 13F quarterly later, COT later, unusual options later.
- Canada: SEDI later, TMX short interest later, commodity COT for resource names later.

False-positive guardrails:

- 13F stale data.
- Passive/quant 13F contamination.
- Optical insider buys.
- Passive index rebalancing FII flows.
- High delivery on thin volume.
- Promoter pledge defensive buying.
- SEDI option exercise not open-market buying.
- Short covering into downtrend not squeeze.
- Calendar-volume noise.

ISM may summarize accumulation-like evidence, but it cannot promote a stock by itself. ISM must surface uncertainty and false-positive flags prominently when the evidence is weak, stale, mechanical, or explainable by passive flows.

## 8. Data Pull Budget and Cadence

Full universe daily:

- OHLCV.
- Benchmarks.
- Sector/index data.
- Core technical matrix.

Shortlist only:

- CAT enrichment.
- ISM enrichment.

Cadence:

- Catalyst official source: daily for shortlisted/event names.
- Google/Gemini grounding: only when a price/volume event or missing catalyst explanation exists.
- India FII/DII and delivery: daily.
- Form 4/SEDI: daily or event-driven for shortlist.
- 13F: quarterly only.
- Shareholding/promoter pledge: quarterly only.
- COT/COT proxy: weekly only.
- Full filing NLP/social sentiment: future phase, not v0.1.

Budget rule: no full-universe CAT/ISM enrichment in v0.1. CAT/ISM calls must be downstream of technical discovery and should be bounded by list sizes, source priority, timeout, and fail-safe behavior.

## 9. Dashboard Presentation

Planned diagnostic columns:

- Catalyst.
- CQS/DCW.
- Fresh/Exhausted.
- Source.
- ISM.
- Smart-money note.
- Near-miss / promotion blocker note.

No planned column may create or modify a final bucket.

Presentation rules:

- CAT and ISM cells are diagnostic labels and notes.
- Missing CAT/ISM data should render as neutral or unavailable, not as a failure.
- Source links should prefer official sources.
- Near-miss notes should explain the locked blocker, for example `NO_CHASE`, missing RS evidence, invalid trigger proximity, or market permission.

## 10. Acceptance Tests / Future Implementation Requirements

When implemented later, tests must prove:

- No `final_bucket` changes.
- No AURORA-SIG weight changes.
- No full-universe CAT/ISM enrichment.
- CAT/ISM failures do not block dashboard generation.
- Google/Gemini results are source-cited and JSON-schema validated.
- Custom Search JSON API is not used.
- Google Finance scraping is not used.
- CAT/ISM outputs join by symbol/date only.
- Dashboard still renders when CAT/ISM are missing.

Additional future checks:

- CAT and ISM outputs always set `aurora_bucket_impact = NONE`.
- Sidecar enrichment runs only after technical shortlist selection.
- Unsupported or conflicting sources produce safe statuses instead of promotion.
- PR-level generated-artifact guards continue to block cache/data/dashboard output churn.
