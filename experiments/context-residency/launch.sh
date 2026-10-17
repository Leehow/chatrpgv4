#!/bin/bash
# Initial non-journal hookup only. MiniMax uses the admitted launch-minimax.sh
# recorded in the experiment's admission.json, with the isolated pre-journal seam.
set -euo pipefail
prototype_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$prototype_dir/../.." && pwd)"
exec "$repo_dir/bin/pi-coc" --extension "$prototype_dir/extension.ts" "$@"
