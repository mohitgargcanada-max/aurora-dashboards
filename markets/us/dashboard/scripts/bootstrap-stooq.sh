#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/bootstrap-stooq.sh /path/to/d_us_txt.zip" >&2
  echo "   or: bash scripts/bootstrap-stooq.sh /path/to/d_us_txt.zip.part-*" >&2
  exit 2
fi

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
work_root=$(mktemp -d "${TMPDIR:-/tmp}/aurora-stooq.XXXXXX")
trap 'rm -rf "$work_root"' EXIT

if [[ $# -eq 1 && "$1" == *.zip ]]; then
  archive=$(realpath "$1")
else
  archive="$work_root/d_us_txt.zip"
  for part in "$@"; do
    if [[ ! -f "$part" ]]; then
      echo "Missing archive part: $part" >&2
      exit 2
    fi
    dd if="$part" of="$archive" bs=8M oflag=append conv=notrunc status=none
  done
fi

unzip -tq "$archive" >/dev/null
unzip -q "$archive" -d "$work_root"
node "$project_root/scripts/ingest-stooq.mjs" "$work_root" "$project_root/cache/us/ohlcv"

echo "Stooq bootstrap complete: $project_root/cache/us/manifest.json"
