#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dashboard=${1:-$project_root/../AURORA_US_Dashboard.html}
output=${2:-$project_root/artifacts/aurora-us-dashboard.png}

find_browser() {
  if [[ -n "${CHROMIUM_PATH:-}" && -x "$CHROMIUM_PATH" ]]; then
    printf '%s\n' "$CHROMIUM_PATH"
    return
  fi
  for command_name in chromium chromium-browser google-chrome google-chrome-stable; do
    if command -v "$command_name" >/dev/null 2>&1; then
      command -v "$command_name"
      return
    fi
  done
  if [[ -x "$project_root/tools/chrome-headless-shell-linux64/chrome-headless-shell" ]]; then
    printf '%s\n' "$project_root/tools/chrome-headless-shell-linux64/chrome-headless-shell"
    return
  fi
  find "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" \
    -type f \( -name chrome -o -name headless_shell \) -perm -111 -print 2>/dev/null \
    | sort -V | tail -1
}

browser=$(find_browser || true)
if [[ -z "$browser" ]]; then
  echo "Chromium is required. Set CHROMIUM_PATH to an executable Chromium/Chrome binary." >&2
  exit 3
fi
if [[ ! -f "$dashboard" ]]; then
  echo "Dashboard not found: $dashboard" >&2
  exit 2
fi

mkdir -p "$(dirname "$output")"
"$browser" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --hide-scrollbars \
  --window-size=1440,1200 \
  --screenshot="$output" \
  "file://$(realpath "$dashboard")"

test -s "$output"
echo "Visual validation screenshot: $output"
