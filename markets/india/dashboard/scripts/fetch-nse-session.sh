#!/usr/bin/env bash
set -u

session="${1:-}"
destination="${2:-cache/india/raw/${session}}"
if [[ ! "$session" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Usage: npm run cache:fetch:nse -- YYYY-MM-DD [destination]" >&2
  exit 2
fi
mkdir -p "$destination"
yyyymmdd="${session//-/}"
ddmmyyyy="${session:8:2}${session:5:2}${session:0:4}"
user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
urls=(
  "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${yyyymmdd}_F_0000.csv.zip"
  "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy}.csv"
)
for url in "${urls[@]}"; do
  output="$destination/$(basename "$url")"
  if curl -A "$user_agent" -H "Referer: https://www.nseindia.com/" -L --fail --silent --show-error --max-time 45 -o "$output" "$url"; then
    echo "$output"
    exit 0
  fi
  rm -f "$output"
done
echo "OFFICIAL_FETCH_BLOCKED: download the session bhavcopy in a browser and place it in $destination" >&2
exit 3
