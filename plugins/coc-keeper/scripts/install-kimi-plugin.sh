#!/usr/bin/env bash
# Compatibility helper for Kimi Code's full plugin manager.
#
# Kimi Code now installs the complete plugin, its MCP server, and the
# continuation lifecycle hooks from the canonical plugin root. This script
# intentionally performs no user-skill copy: copying only a thin entry
# recreates the host-parity bug this repository is fixing.
set -euo pipefail

# scripts/ -> coc-keeper/ -> plugins/ -> repo root
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLUGIN_ROOT="$ROOT/plugins/coc-keeper"
MANIFEST="$PLUGIN_ROOT/.kimi-plugin/plugin.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "error: missing $MANIFEST" >&2
  exit 1
fi

cat <<EOF
plugin:    $PLUGIN_ROOT
manifest:  $MANIFEST
next: start Kimi Code and run:
      /plugins install "$PLUGIN_ROOT"
      /plugins enable coc-keeper
      /reload
note: the canonical skills tree, MCP gateway, and continuation lifecycle
      hooks are installed together, matching the Codex plugin surface.
EOF
