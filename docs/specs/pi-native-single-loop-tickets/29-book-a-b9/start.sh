#!/bin/zsh
# Start a driver run on book A's campaign in the fresh home, Jev key from the App vault (never printed).
# Keeper model this batch: opencode-go/deepseek-v4.1-flash, thinking off (grok-build has no quota; SL-61's
# provider-data correction makes "off" sendable for this model). Usage: start.sh setup|play <campaign-id>
set -e
W=/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9
cd $W
KEY="$(node -e "import('./experiments/single-loop-routing/vault.mjs').then(async m => { const v = await m.readVaultSecret('EXT_JEV_APIKEY'); process.stdout.write(String(v || '')); })")"
[ -n "$KEY" ] || { echo "no EXT_JEV_APIKEY in the vault" >&2; exit 2; }
export EXT_JEV_APIKEY="$KEY" PI_COC_HOME=$W/.coc/playtests/sl29a-b9/home PIPIUI_EXT_SETTINGS_JEV='{"ext.jev.preselectEnabled":true}'
if [ "$1" = setup ]; then
  exec uv run --frozen python tests/play/driver.py start --campaign "$2" --run "$2-setup-$(date -u +%Y%m%dT%H%M%SZ)" --launcher bin/pi-coc-setup --model opencode-go/deepseek-v4.1-flash --thinking off
else
  exec uv run --frozen python tests/play/driver.py start --campaign "$2" --env PI_COC_LOOP_ENGINE=hybrid-v1 --env PI_COC_JEV_PRESELECT=1 --model opencode-go/deepseek-v4.1-flash --thinking off
fi
