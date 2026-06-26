#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public_dir="${1:-public}"
public_path="$repo_root/$public_dir"
dashboard_html="$repo_root/markets/india/AURORA_India_Unified_Dashboard.html"
india_data_dir="$repo_root/markets/india/dashboard/data"

if [[ ! -f "$dashboard_html" ]]; then
  echo "India dashboard HTML not found: $dashboard_html" >&2
  exit 1
fi

rm -rf "$public_path"
mkdir -p "$public_path/india/dashboard"

cp "$dashboard_html" "$public_path/india/index.html"
if [[ -d "$india_data_dir" ]]; then
  cp -r "$india_data_dir" "$public_path/india/dashboard/data"
fi

cat > "$public_path/index.html" <<'HTML'
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=india/">
    <title>AURORA India Dashboard</title>
  </head>
  <body>
    <a href="india/">Open AURORA India Dashboard</a>
  </body>
</html>
HTML

touch "$public_path/.nojekyll"
