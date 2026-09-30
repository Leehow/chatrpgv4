#!/bin/bash
# usage: run-ab.sh <worktree> <prefix> <KEY=VALUE for the "on" arm>
# Four concurrent tables in one worktree and build: <prefix>-off-{z1,j2} and <prefix>-on-{z1,j2}. Provider speed swings by
# the hour, so the control always runs in the same window. Logs land next to this script (table-<run>.log).
# The live tables load build/ (build/extensions/kernel/index.mjs), not the sources: build-fetch the worktree first.
set -u
here=$(cd "$(dirname "$0")" && pwd); wt=$1; prefix=$2; on=$3
cd "$wt"
# Jev's key goes from the App vault into this process's environment only: never printed, never a --env, never a file.
export EXT_JEV_APIKEY="$(node -e "import('./experiments/single-loop-routing/vault.mjs').then(m=>process.stdout.write(m.readVaultSecret('EXT_JEV_APIKEY')||''))")"
[ -n "$EXT_JEV_APIKEY" ] || { echo "no jev key"; exit 1; }
for x in z1 j2; do
  "$here/run-table.sh" "$wt" "$prefix-off-$x" "$here/player-lines-$x.txt" > "$here/table-$prefix-off-$x.log" 2>&1 &
  "$here/run-table.sh" "$wt" "$prefix-on-$x" "$here/player-lines-$x.txt" --env "$on" > "$here/table-$prefix-on-$x.log" 2>&1 &
done
wait
echo "ab-done $prefix"
