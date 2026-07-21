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
if [[ ! -f "$SRC/agents/coc-scene-adviser.md" ]]; then
  echo "error: missing optional Grok scene adviser at $SRC/agents/coc-scene-adviser.md" >&2
  exit 1
fi
if [[ ! -f "$SRC/agents/coc-source-pack-worker.md" ]]; then
  echo "error: missing bounded Grok source-pack worker at $SRC/agents/coc-source-pack-worker.md" >&2
  exit 1
fi
if [[ ! -f "$SRC/agents/coc-keeper-kp.md" ]]; then
  echo "error: missing focused Grok main KP profile at $SRC/agents/coc-keeper-kp.md" >&2
  exit 1
fi
if [[ ! -f "$SRC/agents/coc-playtest-player.md" ]]; then
  echo "error: missing protocol-isolated Grok player profile at $SRC/agents/coc-playtest-player.md" >&2
  exit 1
fi
if [[ ! -f "$SRC/references/grok-focused-config.toml" ]]; then
  echo "error: missing focused Grok configuration template" >&2
  exit 1
fi
if [[ ! -f "$SRC/references/grok-focused-requirements.toml" ]]; then
  echo "error: missing focused Grok requirements template" >&2
  exit 1
fi
if [[ ! -f "$SRC/scripts/coc_grok_focused_config.py" ]]; then
  echo "error: missing focused Grok configuration renderer" >&2
  exit 1
fi
if [[ ! -x "$SRC/scripts/run-grok-keeper.sh" ]]; then
  echo "error: missing executable focused Grok Keeper launcher" >&2
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
if ! grep -Eqi 'agent dir|agents|coc-scene-adviser' <<<"$details"; then
  echo "error: Grok installed coc-keeper without its agent directory" >&2
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

# A primary custom agent in Grok Build 0.2.106 still receives every MCP server
# from the ordinary user/plugin merge even with mcpInheritance: none.  Install
# the same canonical plugin into a persistent focused GROK_HOME so live KP
# sessions, resumes, and subagents keep working while unrelated integrations
# never enter the tool-search index.  Credentials are linked, never copied.
focused_home="$grok_state_root/coc-keeper-focused"
focused_config="$focused_home/config.toml"
focused_requirements="$focused_home/requirements.toml"
mkdir -p "$focused_home"
install -m 0600 "$SRC/references/grok-focused-config.toml" "$focused_config"
install -m 0600 "$SRC/references/grok-focused-requirements.toml" \
  "$focused_requirements"
if [[ -f "$grok_state_root/auth.json" ]]; then
  if [[ -e "$focused_home/auth.json" && ! -L "$focused_home/auth.json" ]]; then
    echo "error: refusing to replace non-symlink $focused_home/auth.json" >&2
    exit 1
  fi
  ln -sfn "$grok_state_root/auth.json" "$focused_home/auth.json"
fi
if GROK_HOME="$focused_home" grok plugin list 2>/dev/null | grep -q 'coc-keeper'; then
  GROK_HOME="$focused_home" grok plugin uninstall coc-keeper --confirm >/dev/null 2>&1 || true
fi
GROK_HOME="$focused_home" grok plugin install "$SRC" --trust >/dev/null
GROK_HOME="$focused_home" grok plugin enable coc-keeper >/dev/null 2>&1 || true

focused_details="$(GROK_HOME="$focused_home" grok plugin details coc-keeper 2>&1)" || {
  echo "error: unable to inspect focused coc-keeper plugin install" >&2
  printf '%s\n' "$focused_details" >&2
  exit 1
}
focused_installed_path="$(sed -n 's/^[[:space:]]*path: //p' <<<"$focused_details" | head -n 1)"
if [[ -z "$focused_installed_path" || ! -d "$focused_installed_path" ]]; then
  echo "error: unable to resolve focused coc-keeper install path" >&2
  exit 1
fi
focused_plugin_bridge="$focused_home/coc-keeper-current"
if [[ -e "$focused_plugin_bridge" && ! -L "$focused_plugin_bridge" ]]; then
  echo "error: refusing to replace non-symlink $focused_plugin_bridge" >&2
  exit 1
fi
ln -sfn "$focused_installed_path" "$focused_plugin_bridge"

# Grok 0.2.106 deliberately ignores `mcpServers` and MCP-pool inheritance on
# plugin-provided subagents. Project the same installed canonical definition
# into this private focused home's documented user-agent scope so its explicit
# coc-source-submit attachment is honored. The unqualified runtime name avoids
# the plugin-qualified security branch; the installed plugin remains the sole
# source and every reinstall refreshes this projection.
focused_agent_dir="$focused_home/agents"
focused_source_agent="$focused_agent_dir/coc-source-pack-worker.md"
if [[ -e "$focused_source_agent" && ( ! -f "$focused_source_agent" || -L "$focused_source_agent" ) ]]; then
  echo "error: refusing to replace non-regular $focused_source_agent" >&2
  exit 1
fi
mkdir -p "$focused_agent_dir"
install -m 0644 \
  "$focused_installed_path/agents/coc-source-pack-worker.md" \
  "$focused_source_agent"
if ! cmp -s \
  "$focused_installed_path/agents/coc-source-pack-worker.md" \
  "$focused_source_agent"; then
  echo "error: focused source worker projection drifted from installed plugin" >&2
  exit 1
fi

# Compatibility plugin discovery is separate from the documented compat
# skills/rules/MCP switches. Render native disabled MCP overrides from Grok's
# own inventory so this stays host/user independent, then fail closed if an
# enabled non-COC MCP remains in the focused tool-search surface.
focused_inventory="$(cd "$focused_home" && \
  GROK_HOME="$focused_home" \
  GROK_CURSOR_SKILLS_ENABLED=false \
  GROK_CURSOR_MCPS_ENABLED=false \
  GROK_CLAUDE_SKILLS_ENABLED=false \
  GROK_CLAUDE_MCPS_ENABLED=false \
  GROK_MANAGED_MCPS_ENABLED=false \
  GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED=false \
  grok inspect --json)" || {
  echo "error: unable to inventory focused Grok configuration" >&2
  exit 1
}
rendered_focused_config="$(mktemp "${TMPDIR:-/tmp}/coc-grok-focused-config.XXXXXX")"
rendered_focused_requirements="$(mktemp "${TMPDIR:-/tmp}/coc-grok-focused-requirements.XXXXXX")"
cleanup_rendered_focused_config() {
  rm -f -- "$rendered_focused_config"
  rm -f -- "$rendered_focused_requirements"
}
trap cleanup_rendered_focused_config EXIT
printf '%s\n' "$focused_inventory" | \
  uv run --project "$ROOT" --frozen python \
    "$SRC/scripts/coc_grok_focused_config.py" render \
    --template "$SRC/references/grok-focused-config.toml" \
    > "$rendered_focused_config"
install -m 0600 "$rendered_focused_config" "$focused_config"
printf '%s\n' "$focused_inventory" | \
  uv run --project "$ROOT" --frozen python \
    "$SRC/scripts/coc_grok_focused_config.py" render-requirements \
    --template "$SRC/references/grok-focused-requirements.toml" \
    > "$rendered_focused_requirements"
install -m 0600 "$rendered_focused_requirements" "$focused_requirements"
cleanup_rendered_focused_config
trap - EXIT

focused_final_inventory="$(cd "$focused_home" && \
  GROK_HOME="$focused_home" \
  GROK_CURSOR_SKILLS_ENABLED=false \
  GROK_CURSOR_MCPS_ENABLED=false \
  GROK_CLAUDE_SKILLS_ENABLED=false \
  GROK_CLAUDE_MCPS_ENABLED=false \
  GROK_MANAGED_MCPS_ENABLED=false \
  GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED=false \
  grok inspect --json)" || {
  echo "error: unable to verify focused Grok configuration" >&2
  exit 1
}
focused_isolation="$(printf '%s\n' "$focused_final_inventory" | \
  uv run --project "$ROOT" --frozen python \
    "$SRC/scripts/coc_grok_focused_config.py" verify \
    --require-source-agent "$focused_source_agent" 2>&1)" || {
  echo "error: focused Grok profile still exposes unrelated MCPs or skills" >&2
  printf '%s\n' "$focused_isolation" >&2
  exit 1
}
focused_hook_dir="$focused_home/hooks"
mkdir -p "$focused_hook_dir"
install -m 0644 "$SRC/hooks/grok-global-hooks.json" \
  "$focused_hook_dir/coc-keeper-continuation.json"

# Run the health check from an ordinary empty campaign directory.  Running it
# from the repository root can mask an installed-package defect by lending the
# MCP child a sibling runtime that real player workspaces do not have.
doctor_workspace="$(mktemp -d "${TMPDIR:-/tmp}/coc-grok-mcp-doctor.XXXXXX")"
cleanup_doctor_workspace() {
  rm -rf -- "$doctor_workspace"
}
trap cleanup_doctor_workspace EXIT
doctor="$(cd "$doctor_workspace" && grok mcp doctor coc-keeper --json 2>&1)" || {
  echo "error: Grok could not start the installed coc-keeper MCP server" >&2
  printf '%s\n' "$doctor" >&2
  exit 1
}
if ! grep -Eq '"healthy"[[:space:]]*:[[:space:]]*true' <<<"$doctor"; then
  echo "error: installed coc-keeper MCP server failed its Grok handshake" >&2
  printf '%s\n' "$doctor" >&2
  exit 1
fi
source_doctor="$(cd "$doctor_workspace" && grok mcp doctor coc-source-submit --json 2>&1)" || {
  echo "error: Grok could not start the installed coc-source-submit MCP server" >&2
  printf '%s\n' "$source_doctor" >&2
  exit 1
}
if ! grep -Eq '"healthy"[[:space:]]*:[[:space:]]*true' <<<"$source_doctor"; then
  echo "error: installed coc-source-submit MCP failed its Grok handshake" >&2
  printf '%s\n' "$source_doctor" >&2
  exit 1
fi
focused_doctor="$(cd "$doctor_workspace" && \
  GROK_HOME="$focused_home" \
  GROK_CURSOR_MCPS_ENABLED=false \
  GROK_CLAUDE_MCPS_ENABLED=false \
  GROK_MANAGED_MCPS_ENABLED=false \
  GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED=false \
  grok mcp doctor coc-keeper --json 2>&1)" || {
  echo "error: focused Grok profile could not start coc-keeper MCP" >&2
  printf '%s\n' "$focused_doctor" >&2
  exit 1
}
if ! grep -Eq '"healthy"[[:space:]]*:[[:space:]]*true' <<<"$focused_doctor"; then
  echo "error: focused coc-keeper MCP failed its Grok handshake" >&2
  printf '%s\n' "$focused_doctor" >&2
  exit 1
fi
focused_source_doctor="$(cd "$doctor_workspace" && \
  GROK_HOME="$focused_home" \
  GROK_CURSOR_MCPS_ENABLED=false \
  GROK_CLAUDE_MCPS_ENABLED=false \
  GROK_MANAGED_MCPS_ENABLED=false \
  GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED=false \
  grok mcp doctor coc-source-submit --json 2>&1)" || {
  echo "error: focused Grok profile could not start coc-source-submit MCP" >&2
  printf '%s\n' "$focused_source_doctor" >&2
  exit 1
}
if ! grep -Eq '"healthy"[[:space:]]*:[[:space:]]*true' <<<"$focused_source_doctor"; then
  echo "error: focused coc-source-submit MCP failed its Grok handshake" >&2
  printf '%s\n' "$focused_source_doctor" >&2
  exit 1
fi
cleanup_doctor_workspace
trap - EXIT

skill_count="$(find "$SRC/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"

cat <<EOF
installed: full COC Keeper plugin from
  $SRC
manifest:  $MANIFEST
skills:    $skill_count directories under skills/ (must include coc-main, coc-keeper-play)
MCP:       coc-keeper gateway + lease-bound coc-source-submit healthy in Grok
hooks:     startup/compaction resume guard discovered in Grok
            global fallback: $grok_hook_bridge
agents:    coc-keeper-kp + coc-playtest-player + coc-scene-adviser
            focused source worker: $focused_source_agent
focused:   $focused_home (persistent sessions; COC-only MCP/skill discovery)
next:
  1. In this repo, run: grok inspect   # confirm plugin skills + coc-keeper MCP
  2. Start a focused session: "$focused_plugin_bridge/scripts/run-grok-keeper.sh" --cwd "$ROOT"
  3. Say: 进入 COC 模式 / Activate COC mode
  4. Load coc-main → mode-protocol → coc-keeper-play → coc-story-director
note:
  - This is a full plugin install (Codex-parity skills + shared MCP), not a thin entry.
  - The main-KP profile narrows tools/MCP discovery; it does not weaken canonical KP craft.
  - Grok Build 0.2.106 suppresses MCPs on plugin subagents and injects managed
    gateway tools separately; the focused user-agent projection/launcher
    preserves the narrow source-submit worker without adding another plugin.
  - Portraits on Grok use built-in image_gen / Imagine (HOST_NATIVE_IMAGEGEN).
  - Scene sidecar advice is optional; the main Grok KP never waits or yields authority.
  - Whole-product acceptance remains Codex plugin-native unless policy changes.
EOF
