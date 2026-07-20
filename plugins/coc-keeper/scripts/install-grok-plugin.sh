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
if [[ ! -f "$SRC/hooks/hooks.json" || ! -x "$SRC/hooks/run" ]]; then
  echo "error: missing executable continuation lifecycle hooks at $SRC/hooks" >&2
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

# A trusted Grok plugin must discover the convention-based plugin-root
# .mcp.json. Skills without this component would silently return Grok to the
# repeated shell/file cold path.
details="$(grok plugin details coc-keeper 2>&1)" || {
  echo "error: unable to inspect installed coc-keeper plugin" >&2
  printf '%s\n' "$details" >&2
  exit 1
}
if ! grep -Eq 'MCP servers|[1-9][0-9]* MCP server' <<<"$details" \
  || grep -Eqi 'MCP servers?.*(blocked|:[[:space:]]*0)|0 MCP servers?' <<<"$details"; then
  echo "error: Grok installed coc-keeper without its MCP server component" >&2
  printf '%s\n' "$details" >&2
  echo "hint: confirm the plugin is trusted and plugin-root .mcp.json is present" >&2
  exit 1
fi
if ! grep -Eqi 'components:.*hooks|(^|[[:space:]])hooks([,[:space:]]|$)' <<<"$details"; then
  echo "error: Grok installed coc-keeper without its continuation lifecycle hooks" >&2
  printf '%s\n' "$details" >&2
  exit 1
fi

# Grok 0.2.x can inventory an installed plugin hook file without expanding
# its handlers in workspaces that have no detected project root. Register the
# same canonical handler as a trusted global bridge so process start,
# compaction, and process end are still observable there. The MCP process gate
# remains the independent fresh-process baseline.
installed_path="$(sed -n 's/^[[:space:]]*path: //p' <<<"$details" | head -n 1)"
if [[ -z "$installed_path" || ! -d "$installed_path/hooks" ]]; then
  echo "error: unable to resolve installed coc-keeper path for Grok hook bridge" >&2
  exit 1
fi
grok_state_root="$HOME/.grok"
grok_hook_dir="$grok_state_root/hooks"
grok_plugin_bridge="$grok_state_root/coc-keeper-current"
grok_hook_bridge="$grok_hook_dir/coc-keeper-continuation.json"
if [[ -e "$grok_plugin_bridge" && ! -L "$grok_plugin_bridge" ]]; then
  echo "error: refusing to replace non-symlink $grok_plugin_bridge" >&2
  exit 1
fi
mkdir -p "$grok_hook_dir"
ln -sfn "$installed_path" "$grok_plugin_bridge"
install -m 0644 "$SRC/hooks/grok-global-hooks.json" "$grok_hook_bridge"

doctor="$(grok mcp doctor coc-keeper --json 2>&1)" || {
  echo "error: Grok could not start the installed coc-keeper MCP server" >&2
  printf '%s\n' "$doctor" >&2
  exit 1
}
if ! grep -Eq '"healthy"[[:space:]]*:[[:space:]]*true' <<<"$doctor"; then
  echo "error: installed coc-keeper MCP server failed its Grok handshake" >&2
  printf '%s\n' "$doctor" >&2
  exit 1
fi

skill_count="$(find "$SRC/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"

cat <<EOF
installed: full COC Keeper plugin from
  $SRC
manifest:  $MANIFEST
skills:    $skill_count directories under skills/ (must include coc-main, coc-keeper-play)
MCP:       shared coc-keeper toolbox gateway discovered and healthy in Grok
hooks:     startup/compaction resume guard discovered in Grok
            global fallback: $grok_hook_bridge
next:
  1. In this repo, run: grok inspect   # confirm plugin skills + coc-keeper MCP
  2. Start a Grok session in $ROOT
  3. Say: 进入 COC 模式 / Activate COC mode
  4. Load coc-main → mode-protocol → coc-keeper-play → coc-story-director
note:
  - This is a full plugin install (Codex-parity skills + shared MCP), not a thin entry.
  - Portraits on Grok use built-in image_gen / Imagine (HOST_NATIVE_IMAGEGEN).
  - Whole-product acceptance remains Codex plugin-native unless policy changes.
EOF
