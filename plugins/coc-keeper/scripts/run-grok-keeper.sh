#!/usr/bin/env bash
# Start a persistent Grok Build live-KP window with only the canonical COC
# plugin/config surface.  The focused GROK_HOME keeps normal Grok plugins and
# MCP integrations out of the KP's progressive tool search without changing
# the user's ordinary Grok configuration.
set -euo pipefail

grok_bin="${COC_GROK_BINARY:-$(command -v grok || true)}"
if [[ -z "$grok_bin" || ! -x "$grok_bin" ]]; then
  echo "error: Grok Build CLI is unavailable; run install-grok-plugin.sh first" >&2
  exit 1
fi

focused_home="${COC_GROK_FOCUSED_HOME:-$HOME/.grok/coc-keeper-focused}"
plugin_bridge="$focused_home/coc-keeper-current"
keeper_profile="$plugin_bridge/agents/coc-keeper-kp.md"
if [[ ! -f "$keeper_profile" ]]; then
  echo "error: focused COC Keeper profile is not installed at $keeper_profile" >&2
  echo "hint: run plugins/coc-keeper/scripts/install-grok-plugin.sh" >&2
  exit 1
fi

export GROK_HOME="$focused_home"
export GROK_CURSOR_SKILLS_ENABLED=false
export GROK_CURSOR_RULES_ENABLED=false
export GROK_CURSOR_AGENTS_ENABLED=false
export GROK_CURSOR_MCPS_ENABLED=false
export GROK_CURSOR_HOOKS_ENABLED=false
export GROK_CLAUDE_SKILLS_ENABLED=false
export GROK_CLAUDE_RULES_ENABLED=false
export GROK_CLAUDE_AGENTS_ENABLED=false
export GROK_CLAUDE_MCPS_ENABLED=false
export GROK_CLAUDE_HOOKS_ENABLED=false
# Grok 0.2.106 injects account-managed MCP gateway tools outside the local
# `grok inspect` inventory.  Disable both managed paths for this focused live
# KP process so its user-scoped source worker can receive only the named
# lease-bound submit server declared by the installed plugin.
export GROK_MANAGED_MCPS_ENABLED=false
export GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED=false

exec "$grok_bin" --agent "$keeper_profile" "$@"
