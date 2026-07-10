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

# Cursor resolves relative logo paths to raw.githubusercontent.com. For a local
# install that is not published yet, rewrite to a file:// URL so the icon shows.
python3 - "$DEST" <<'PY'
import json, sys
from pathlib import Path
dest = Path(sys.argv[1])
manifest = dest / ".cursor-plugin" / "plugin.json"
logo = dest / "assets" / "logo.png"
if not logo.is_file():
    logo = dest / "assets" / "chatrpg-logo.png"
data = json.loads(manifest.read_text())
if logo.is_file():
    data["logo"] = logo.resolve().as_uri()
    manifest.write_text(json.dumps(data, indent=2) + "\n")
    print(f"logo: {data['logo']}")
else:
    print("warning: no logo asset found", file=sys.stderr)
PY

echo "installed: $DEST"
echo "next: Cursor → Developer: Reload Window, then check Customize → Plugins"
