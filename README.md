# AURORA Dashboards

This repository preserves the AURORA dashboard logic, math, prompts, source locks, cache snapshots and generated dashboards for multiple markets.

## Markets

- `markets/us/dashboard` - US unified dashboard with Core AURORA and IPO/PEAD/EP/HVE workspace.
- `markets/india/dashboard` - India unified dashboard/cache engine.
- `markets/canada/dashboard` - Canada scaffold, ready to be implemented from the shared AURORA architecture.

## How Runs Work

GitHub Actions can run the dashboards without ChatGPT being open:

- Scheduled runs use `.github/workflows/*.yml`.
- Manual runs use the GitHub Actions `workflow_dispatch` button.
- Each workflow checks out the repo, runs the market scan, validates output, and commits updated dashboard/state files back to the repo.
- GitHub Pages publishes generated dashboard artifacts; India is available at `/india/`.

ChatGPT/Codex can still inspect failures, improve logic, and update prompts/specs, but GitHub Actions should be the reliable scheduler.

## Local Commands

```bash
npm run scan:us
npm run scan:india
npm run scan:canada
```

Or run a market directly:

```bash
cd markets/us/dashboard
npm run scan:universe
npm run render:canonical
npm test
npm run build
npm run validate
npm run visual:validate
```

## Secrets

Do not commit API keys. Configure these in GitHub repository secrets if needed:

```text
EODHD_API_TOKEN
SEC_USER_AGENT
TAVILY_API_KEY
FIRECRAWL_API_KEY
```

## Cache Policy

Normalized JSON cache/state can be committed when reasonably sized. Large raw history archives should be stored in GitHub Releases, external storage, or Git LFS.
