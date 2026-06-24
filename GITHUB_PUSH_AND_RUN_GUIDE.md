# GitHub Push and Run Guide

## Who Runs The Dashboard?

GitHub can run it.

After this folder is pushed to a GitHub repository, GitHub Actions will run the dashboards on schedule and can also run them manually from the Actions tab.

ChatGPT/Codex is still useful for:

- fixing scan logic
- reviewing failed Actions logs
- updating prompts/specs/math
- adding new market support
- interpreting dashboard output

But the reliable scheduled runner should be GitHub Actions, not a long chat thread.

## Push Locally

Create an empty GitHub repo first, for example:

```text
aurora-dashboards
```

Then from your machine:

```bash
cd aurora-dashboards
git init
git branch -M main
git add .
git commit -m "Initial AURORA dashboards monorepo"
git remote add origin https://github.com/YOUR_USER_OR_ORG/aurora-dashboards.git
git push -u origin main
```

If GitHub rejects a file for size, remove that file from git and store it in GitHub Releases, external storage, or Git LFS. The repo has already excluded raw zip archives and browser binaries.

## GitHub Actions

Workflow files:

```text
.github/workflows/us-dashboard.yml
.github/workflows/india-dashboard.yml
.github/workflows/canada-dashboard.yml
```

Manual run:

1. Open the GitHub repo.
2. Go to `Actions`.
3. Pick `AURORA US Dashboard`, `AURORA India Dashboard`, or `AURORA Canada Dashboard`.
4. Click `Run workflow`.

Scheduled run:

- US: 9:00 a.m. America/New_York, Sunday-Friday.
- India: scheduled in UTC for India morning run.
- Canada: scaffolded; workflow exists but runner currently reports `SCAFFOLD_ONLY`.

GitHub cron uses UTC, so US and Canada workflows include both 13:00 UTC and 14:00 UTC. A Node gate script checks `America/New_York` local time and exits unless it is the 9:00 a.m. run window. This handles daylight saving time.

## GitHub Secrets

Go to:

```text
Repo > Settings > Secrets and variables > Actions > New repository secret
```

Add only what you actually use:

```text
EODHD_API_TOKEN
SEC_USER_AGENT
TAVILY_API_KEY
FIRECRAWL_API_KEY
```

Do not commit `.env`.

## Market Commands

From repo root:

```bash
npm run scan:us
npm run scan:india
npm run scan:canada
```

Direct US command:

```bash
cd markets/us/dashboard
npm run scan:universe
npm run render:canonical
npm test
npm run build
npm run validate
npm run visual:validate
```

Direct India command:

```bash
cd markets/india/dashboard
npm run cache:audit
npm run scan:full
npm test
```

## Current Status

US:

- Monorepo runner passed scan, render, tests, build and validate.
- Uses committed normalized JSON cache.
- No longer requires raw `d_us_txt.zip` for normal scan.
- Local visual validation is blocked unless Chrome exists locally.
- GitHub Actions installs Chrome using `browser-actions/setup-chrome`.

India:

- Monorepo runner passed cache audit, full scan and tests.
- Current scan output data date: `2026-06-22`.

Canada:

- Scaffold only.
- Routing rules and workflow exist.
- Market-specific implementation still required before production use.

