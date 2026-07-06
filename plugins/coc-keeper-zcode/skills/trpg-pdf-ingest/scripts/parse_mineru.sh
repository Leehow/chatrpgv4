#!/usr/bin/env bash
#
# parse_mineru.sh — thin wrapper over the MinerU skill with caching.
#
# Caches output to checks/ocr-cached/<slug>.md. If the cache file exists
# with >10 lines, skips re-parsing (idempotent).
#
# Usage:
#   bash parse_mineru.sh pdf/<book>.pdf --slug monsters-ch14 --pages 287-348
#   bash parse_mineru.sh pdf/<book>.pdf --slug weapons --pages 412-417 --force
#
set -euo pipefail

MINERU="$HOME/.zcode/cli/plugins/local/mineru/0.1.0/skills/mineru/scripts/parse.sh"
CACHE_DIR=""  # set via --cache-dir, defaults to checks/ocr-cached
SLUG=""
PDF=""
PAGES=""
FORCE=0

# Find project root (look for plugins/ dir)
PROJECT_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
[[ -d "$PROJECT_ROOT/plugins" ]] || PROJECT_ROOT="$(pwd)"

usage() {
  cat >&2 << 'EOF'
parse_mineru.sh — MinerU wrapper with OCR caching

USAGE:
  bash parse_mineru.sh <pdf> --slug <name> --pages <start>-<end> [options]

OPTIONS:
  --slug <name>      Cache filename slug (e.g. monsters-ch14)
  --pages <range>    0-based page range (e.g. 287-348)
  --cache-dir <path> Cache directory (default: checks/ocr-cached)
  --force            Re-parse even if cache exists
EOF
  exit 1
}

[[ $# -lt 1 ]] && usage

# First positional arg is PDF
PDF="$1"; shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug) SLUG="$2"; shift 2 ;;
    --pages) PAGES="$2"; shift 2 ;;
    --cache-dir) CACHE_DIR="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

[[ -z "$SLUG" ]] && { echo "ERROR: --slug required" >&2; exit 1; }
[[ -z "$PAGES" ]] && { echo "ERROR: --pages required" >&2; exit 1; }
[[ -z "$CACHE_DIR" ]] && CACHE_DIR="$PROJECT_ROOT/checks/ocr-cached"

CACHE_FILE="$CACHE_DIR/${SLUG}.md"

# Idempotent check
if [[ -f "$CACHE_FILE" && $(wc -l < "$CACHE_FILE") -gt 10 && $FORCE -eq 0 ]]; then
  echo "[skip] $SLUG already cached ($(wc -l < "$CACHE_FILE") lines) at $CACHE_FILE" >&2
  echo "$CACHE_FILE"
  exit 0
fi

# Parse page range
START="${PAGES%%-*}"
END="${PAGES##*-}"

echo "[mineru] parsing $SLUG (pages $START-$end)..." >&2

# Clean temp and run MinerU
TEMP_DIR="$PROJECT_ROOT/pdf/$(basename "$PDF" .pdf)_mineru"
rm -rf "$TEMP_DIR"

"$MINERU" -p "$PDF" --plain -- -s "$START" -e "$END" 2>&1 | grep -E "Processed|Markdown|ERROR" | tail -2 >&2

# Find and copy output
MD_FILE="$TEMP_DIR/$(basename "$PDF" .pdf)/auto/$(basename "$PDF" .pdf).md"
if [[ -f "$MD_FILE" ]]; then
  mkdir -p "$CACHE_DIR"
  cp "$MD_FILE" "$CACHE_FILE"
  echo "[ok] $SLUG cached at $CACHE_FILE ($(wc -l < "$CACHE_FILE") lines)" >&2
  echo "$CACHE_FILE"
else
  echo "[FAIL] MinerU output not found at $MD_FILE" >&2
  exit 1
fi
