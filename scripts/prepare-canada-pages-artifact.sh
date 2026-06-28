#!/usr/bin/env bash
set -euo pipefail
out_dir="${1:-public}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public_path="$repo_root/$out_dir"
canada_root="$repo_root/markets/canada"
html="$canada_root/AURORA_Canada_Unified_Dashboard.html"
if [[ ! -f "$html" ]]; then
  echo "Canada dashboard HTML missing: $html" >&2
  exit 1
fi
rm -rf "$public_path"
mkdir -p "$public_path/canada"
cp "$html" "$public_path/canada/index.html"
if [[ -d "$canada_root/dashboard/data" ]]; then
  mkdir -p "$public_path/canada/data"
  find "$canada_root/dashboard/data" -maxdepth 1 -type f -name 'canada-*.json' -exec cp {} "$public_path/canada/data/" \;
fi
printf '<!doctype html><meta http-equiv="refresh" content="0; url=./canada/"><a href="./canada/">Canada dashboard</a>\n' > "$public_path/index.html"
touch "$public_path/.nojekyll"
echo "Prepared Canada-only Pages artifact at $out_dir/canada"
