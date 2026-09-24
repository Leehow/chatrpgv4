Status: ready (filed 2026-09-24 from long gate #4; batch 5)
Stage: SL-44 (P2, prescreen)
Spec: docs/kernel-rpc.md §124.11 (binding drift), §135.6, SL-22 (own budget)

# SL-44 — The prescreen neither falls back on a source-revision bump nor runs on a 138 ms allowance

## Evidence (long gate #4, `longgate4-evidence.txt` section E)
- t14: `status: fallback`, `fallback: binding_changed`, `key: source_revision`, after 7 Jev calls and 1.9 s: a memoised answer landing (SL-36) bumped the source revision while the prescreen ran; the compile then fell through and the turn cost 98 s.
- t19: `status: fallback`, `allowance_ms: 138`, aborted "due to timeout" after 41 ms: the prescreen was given 138 ms although SL-22 gives it its own budget.

## Scope
1. Contract: §124.11 amendment: the reading store's revision is not a binding key for the prescreen (what it binds to is the scene/npc state it packed; an answer landing is carried on the note, §135.31.2); SL-22 restated: the allowance is the prescreen's own, never derived from the turn's remainder.
2. `extensions/table/prescreen.ts`: drop `source_revision` from the drift keys; find where the 138 ms came from and make the allowance the named default.
3. Tests, mutation-killable: a source-revision bump mid-prescreen keeps `prepared`; the allowance on a late-turn read equals the default.

## Comments
