#!/bin/bash
# usage: run-table.sh <worktree> <run-id> <lines-file> [driver start args, e.g. --env PI_COC_PROSE_FIRST=1]
# One live table: the Keeper is the real product (grok-build/grok-4.5, thinking low, --pregen thomas-hayes);
# one fixed player line per turn, for A/B comparison only. Real acceptance is a human (or you) playing turn by turn: play-turn.sh.
set -u
wt=$1; run=$2; lines=$3; shift 3
cd "$wt"
python3 tests/play/driver.py start --campaign "$run" --run "$run" --model grok-build/grok-4.5 --thinking low --pregen thomas-hayes --no-default-run "$@" || exit 1
n=0
while IFS= read -r line; do
  n=$((n+1)); echo "== turn $n $(date +%T)"
  python3 tests/play/driver.py turn "$line" --run "$run" --timeout 300; echo "exit $?"
done < "$lines"
python3 tests/play/driver.py stop --run "$run"
echo DONE
