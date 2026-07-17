#!/usr/bin/env bash
# Install/sync the COC Keeper thin Kimi entry into Kimi Work's user skills
# directory. Kimi loads user skills from <daimon-share>/daimon/skills/<name>/
# SKILL.md, so this copies only the thin routing entry — never the canonical
# plugins/coc-keeper/ tree (single-track law).
set -euo pipefail

# scripts/ -> coc-keeper/ -> plugins/ -> repo root
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/.kimi/skills/coc-keeper/SKILL.md"
CANONICAL="$ROOT/plugins/coc-keeper/skills/coc-main/SKILL.md"
MANIFEST="$ROOT/plugins/coc-keeper/.kimi-plugin/kimi.plugin.json"

SKILLS_DIR="${KIMI_SKILLS_DIR:-$HOME/Library/Application Support/kimi-desktop/daimon-share/daimon/skills}"
DEST="$SKILLS_DIR/coc-keeper"

if [[ ! -f "$SRC" ]]; then
  echo "error: missing $SRC" >&2
  exit 1
fi
if [[ ! -f "$CANONICAL" ]]; then
  echo "error: missing canonical skill $CANONICAL" >&2
  exit 1
fi
if [[ ! -f "$MANIFEST" ]]; then
  echo "error: missing Kimi manifest $MANIFEST" >&2
  exit 1
fi
if ! grep -q '^name: coc-keeper$' "$SRC"; then
  echo "error: $SRC frontmatter must declare 'name: coc-keeper'" >&2
  exit 1
fi

mkdir -p "$DEST"

if [[ -f "$DEST/SKILL.md" ]] && cmp -s "$SRC" "$DEST/SKILL.md"; then
  echo "up to date: $DEST/SKILL.md"
else
  cp "$SRC" "$DEST/SKILL.md"
  echo "installed: $DEST/SKILL.md"
fi

cat <<EOF
source:    $SRC
canonical: $ROOT/plugins/coc-keeper/skills/ (referenced, not copied)
next: start a new Kimi session in $ROOT, then say "进入 COC 模式" / "Activate COC mode".
note: the Kimi skills index is injected at session start; a newly installed
      skill is discoverable from the next session onward.
EOF
