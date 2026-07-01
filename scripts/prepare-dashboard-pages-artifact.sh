#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="${1:-public}"
shift || true
required_market=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --required-market)
      required_market="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$required_market" in
  us|india|canada) ;;
  *)
    echo "Usage: scripts/prepare-dashboard-pages-artifact.sh public --required-market us|india|canada" >&2
    exit 2
    ;;
esac

public_path="$repo_root/$out_dir"

market_html_path() {
  case "$1" in
    us) echo "$repo_root/markets/us/AURORA_US_Dashboard.html" ;;
    india) echo "$repo_root/markets/india/AURORA_India_Unified_Dashboard.html" ;;
    canada) echo "$repo_root/markets/canada/AURORA_Canada_Unified_Dashboard.html" ;;
  esac
}

market_title() {
  case "$1" in
    us) echo "AURORA US Dashboard" ;;
    india) echo "AURORA India Dashboard" ;;
    canada) echo "AURORA Canada Dashboard" ;;
  esac
}

write_placeholder() {
  local market="$1"
  local target="$2"
  local title
  case "$market" in
    us) title="AURORA US Dashboard" ;;
    india) title="AURORA India Dashboard" ;;
    canada) title="AURORA Canada Dashboard" ;;
  esac
  cat > "$target" <<HTML
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>${title} unavailable</title></head>
  <body>
    <h1>${title}</h1>
    <p>This dashboard has not been published by the latest successful market workflow.</p>
    <p><a href="/aurora-dashboards/">Back to AURORA Dashboards</a></p>
  </body>
</html>
HTML
}

write_redirect() {
  local target="$1"
  local market="$2"
  local title
  case "$market" in
    us) title="AURORA US Dashboard" ;;
    india) title="AURORA India Dashboard" ;;
    canada) title="AURORA Canada Dashboard" ;;
  esac
  mkdir -p "${target%/*}"
  cat > "$target" <<HTML
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=/aurora-dashboards/${market}/">
    <title>${title}</title>
  </head>
  <body><a href="/aurora-dashboards/${market}/">Open ${title}</a></body>
</html>
HTML
}

copy_market() {
  local market="$1"
  local html_path data_dir target_dir target_html
  html_path="$(market_html_path "$market")"
  data_dir="$repo_root/markets/$market/dashboard/data"
  target_dir="$public_path/$market"
  target_html="$target_dir/index.html"

  mkdir -p "$target_dir"
  if [[ -s "$html_path" ]]; then
    cp "$html_path" "$target_html"
  elif [[ "$market" == "$required_market" ]]; then
    echo "Required $market dashboard HTML missing or empty: $html_path" >&2
    exit 1
  else
    write_placeholder "$market" "$target_html"
  fi

  if [[ -d "$data_dir" ]]; then
    mkdir -p "$target_dir/dashboard/data"
    find "$data_dir" -maxdepth 1 -type f -name '*.json' -exec cp {} "$target_dir/dashboard/data/" \;
  fi
}

rm -rf "$public_path"
mkdir -p "$public_path"

for market in us india canada; do
  copy_market "$market"
done

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
      <li><a href="/aurora-dashboards/us/">US Dashboard</a></li>
      <li><a href="/aurora-dashboards/india/">India Dashboard</a></li>
      <li><a href="/aurora-dashboards/canada/">Canada Dashboard</a></li>
    </ul>
  </body>
</html>
HTML

write_redirect "$public_path/markets/us/AURORA_US_Dashboard.html" us
write_redirect "$public_path/markets/india/AURORA_India_Unified_Dashboard.html" india
write_redirect "$public_path/markets/canada/AURORA_Canada_Unified_Dashboard.html" canada

touch "$public_path/.nojekyll"
echo "Prepared unified Pages artifact under $out_dir with required market: $required_market"
