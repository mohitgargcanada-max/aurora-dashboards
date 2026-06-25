#!/usr/bin/env bash
set -euo pipefail

market="${1:-}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$market" in
  us)
    cd "$repo_root/markets/us/dashboard"
    refresh_status=0
    if npm run scan:universe; then
      echo "US strict refresh and universe scan completed."
    else
      refresh_status=$?
      echo "US strict refresh/scan failed. Preserving last-good dashboard and running cache-only diagnostics." >&2
      echo "The refresh report under data/us-daily-refresh-report.json is the source of truth for why the run is blocked." >&2
      npm run scan:universe:cache-only
    fi
    npm run render:canonical
    npm test
    npm run build
    npm run validate
    if npm run visual:validate; then
      echo "US visual validation passed."
    else
      echo "US visual validation blocked or failed; dashboard generation still completed." >&2
    fi
    if [[ "$refresh_status" -ne 0 ]]; then
      echo "US dashboard preserved from cache, but strict daily refresh is blocked. See data/us-daily-refresh-report.json." >&2
      exit "$refresh_status"
    fi
    ;;
  india)
    cd "$repo_root/markets/india/dashboard"
    npm run scan:full
    npm test
    ;;
  canada)
    cd "$repo_root/markets/canada/dashboard"
    if [[ -f package.json ]]; then
      npm test --if-present
      npm run scan:full --if-present
    else
      echo "Canada dashboard scaffold only. Implement market runner before scheduled use."
    fi
    ;;
  *)
    echo "Usage: $0 {us|india|canada}" >&2
    exit 2
    ;;
esac
