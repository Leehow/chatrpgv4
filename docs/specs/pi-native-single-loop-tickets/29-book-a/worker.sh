#!/bin/zsh
# Run one action of the App's onboarding worker (pipicoc/onboarding-worker.ts, built) exactly as
# runtime/preparation.ts spawns it, with the Jev key and settings the App's preparationEnv passes.
# Usage: [E=<evidence dir>] [H=<coc home>] worker.sh <action> <input-json>. Events (JSONL, timestamped) append to $E/<action>.events.jsonl.
set -e
W=/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a
E=${E:-$W/.coc/playtests/sl29-a-import}
H=${H:-$W}
cd $W
KEY="$(node -e "import('./experiments/single-loop-routing/vault.mjs').then(async m => { const v = await m.readVaultSecret('EXT_JEV_APIKEY'); process.stdout.write(String(v || '')); })")"
[ -n "$KEY" ] || { echo "no EXT_JEV_APIKEY in the vault" >&2; exit 2; }
NODE="$(command -v node)"
CONF="{\"layout\":\"source\",\"backend\":\"typescript\",\"resourceRoot\":\"$W\",\"contentRoot\":\"$W/content\",\"agentHome\":\"$W/.pi/coc-agent\",\"nodeExecutable\":\"$NODE\",\"kernelEntrypoint\":\"$W/build/kernel/rpc.mjs\"}"
INPUT="$(node -e 'const i=JSON.parse(process.argv[1]); i.home=process.argv[2]; process.stdout.write(JSON.stringify(i))' "$2" "$H")"
echo "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"type\":\"start\",\"data\":{\"action\":\"$1\"}}" >> $E/$1.events.jsonl
EXT_JEV_APIKEY="$KEY" PIPIUI_EXT_SETTINGS_JEV='{"ext.jev.preselectEnabled":true}' ELECTRON_RUN_AS_NODE=1 PYTHONDONTWRITEBYTECODE=1 PI_CODING_AGENT_DIR=$W/.pi/coc-agent \
  "$NODE" $W/build/pipicoc/onboarding-worker.mjs "$1" "$INPUT" "$CONF" 2>>$E/$1.stderr.log \
  | while IFS= read -r line; do printf '{"at":"%s","event":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$line"; done >> $E/$1.events.jsonl
echo "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"type\":\"exit\"}" >> $E/$1.events.jsonl
