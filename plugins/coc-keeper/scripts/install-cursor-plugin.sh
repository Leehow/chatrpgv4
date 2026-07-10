#!/usr/bin/env bash
# Install/sync COC Keeper into Cursor's local plugin directory.
# Cursor rejects softlinks that point outside ~/.cursor/plugins/local,
# so this copies the plugin tree instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/plugins/coc-keeper"
DEST="${HOME}/.cursor/plugins/local/coc-keeper"

if [[ ! -f "$SRC/.cursor-plugin/plugin.json" ]]; then
  echo "error: missing $SRC/.cursor-plugin/plugin.json" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
mkdir -p "$DEST"
rsync -a --delete \
  --exclude '.codex-plugin' \
  --exclude '.claude-plugin' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  "$SRC/" "$DEST/"

echo "installed: $DEST"
echo "next: Cursor → Developer: Reload Window, then check Customize → Plugins"
