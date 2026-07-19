#!/usr/bin/env bash
# Install/sync the full COC Keeper plugin into Grok Build.
# Grok play requires the full plugins/coc-keeper tree as a first-class plugin
# (all skills under skills/), not a thin routing entry alone.
set -euo pipefail

# scripts/ -> coc-keeper/ -> plugins/ -> repo root
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/plugins/coc-keeper"
MANIFEST="$SRC/.grok-plugin/plugin.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "error: missing $MANIFEST" >&2
  exit 1
fi
if [[ ! -d "$SRC/skills/coc-main" ]]; then
  echo "error: missing canonical skill tree at $SRC/skills" >&2
  exit 1
fi
if ! command -v grok >/dev/null 2>&1; then
  echo "error: 'grok' CLI not found on PATH" >&2
  exit 1
fi

# Local path install with trust so skills activate in this machine's Grok.
# Re-running: uninstall then install when a same-name local copy already exists.
if grok plugin list 2>/dev/null | grep -q 'coc-keeper'; then
  grok plugin uninstall coc-keeper --confirm >/dev/null 2>&1 || true
fi
grok plugin install "$SRC" --trust

# Ensure it is enabled (plugins may install disabled by default in some configs).
if grok plugin enable coc-keeper >/dev/null 2>&1; then
  :
fi

skill_count="$(find "$SRC/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"

cat <<EOF
installed: full COC Keeper plugin from
  $SRC
manifest:  $MANIFEST
skills:    $skill_count directories under skills/ (must include coc-main, coc-keeper-play)
next:
  1. In this repo, run: grok inspect   # confirm plugin: coc-keeper skills
  2. Start a Grok session in $ROOT
  3. Say: 进入 COC 模式 / Activate COC mode
  4. Load coc-main → mode-protocol → coc-keeper-play → coc-story-director
note:
  - This is a full plugin install (Codex-parity skill surface), not a thin entry.
  - Portraits on Grok use built-in image_gen / Imagine (HOST_NATIVE_IMAGEGEN).
  - Whole-product acceptance remains Codex plugin-native unless policy changes.
EOF
