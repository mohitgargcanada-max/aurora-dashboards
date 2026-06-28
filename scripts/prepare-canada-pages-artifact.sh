#!/usr/bin/env bash
set -euo pipefail
out_dir="${1:-public}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public_path="$repo_root/$out_dir"
us_root="$repo_root/markets/us"
india_root="$repo_root/markets/india"
canada_root="$repo_root/markets/canada"
us_html="$us_root/AURORA_US_Dashboard.html"
india_html="$india_root/AURORA_India_Unified_Dashboard.html"
canada_html="$canada_root/AURORA_Canada_Unified_Dashboard.html"

require_file() {
  local path="$1"
  local label="$2"
  if [[ ! -f "$path" ]]; then
    echo "$label dashboard HTML missing: $path" >&2
    exit 1
  fi
}

copy_market_data() {
  local source_dir="$1"
  local target_dir="$2"
  local pattern="$3"
  if [[ -d "$source_dir" ]]; then
    mkdir -p "$target_dir"
    find "$source_dir" -maxdepth 1 -type f -name "$pattern" -exec cp {} "$target_dir/" \;
  fi
}

require_file "$us_html" "US"
require_file "$india_html" "India"
require_file "$canada_html" "Canada"

rm -rf "$public_path"
mkdir -p "$public_path/us" "$public_path/india" "$public_path/canada"

cp "$us_html" "$public_path/us/index.html"
cp "$india_html" "$public_path/india/index.html"
cp "$canada_html" "$public_path/canada/index.html"

copy_market_data "$us_root/dashboard/data" "$public_path/us/dashboard/data" 'us-*.json'
copy_market_data "$india_root/dashboard/data" "$public_path/india/dashboard/data" 'india-*.json'
copy_market_data "$canada_root/dashboard/data" "$public_path/canada/dashboard/data" 'canada-*.json'

cat > "$public_path/index.html" <<'HTML'
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>AURORA Dashboards</title>
  </head>
  <body>
    <h1>AURORA Dashboards</h1>
    <ul>
      <li><a href="./us/">US Dashboard</a></li>
      <li><a href="./india/">India Dashboard</a></li>
      <li><a href="./canada/">Canada Dashboard</a></li>
    </ul>
  </body>
</html>
HTML

touch "$public_path/.nojekyll"
echo "Prepared unified Pages artifact with /us, /india, and /canada under $out_dir"
