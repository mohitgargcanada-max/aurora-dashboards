#!/usr/bin/env bash
set -euo pipefail

market="${1:-}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$market" in
  us)
    cd "$repo_root/markets/us/dashboard"
    npm run scan:universe
    npm run render:canonical
    npm test
    npm run build
    npm run validate
    if npm run visual:validate; then
      echo "US visual validation passed."
    else
      echo "US visual validation blocked or failed; dashboard generation still completed." >&2
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
