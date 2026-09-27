Status: ready (filed 2026-09-26; P3, prompt-cache hygiene; after SL-88)
Stage: SL-89 (P3, latency: the Keeper's cached prefix)
Spec: docs/kernel-rpc.md §135.23 ("a turn's request is append-only on the single-loop engine"), §135.8 (`coc-clerk` note per model step), §135.31 (carried views), §128.1 (`context_with_system`)

# SL-89 — The Keeper's request is not append-only across turns: after a ≈32k static prefix, ≈15k is rebuilt every turn

## Evidence (gate #18, 56 calls, grok-build usage `cacheRead` vs `input`)
- The first call of every turn caches exactly 32,128 tokens (p50) and sends ≈16.6k uncached (hit 66%); the request stays 45–50k from turn 1 to turn 20, so the history after the static prefix is a window that is rebuilt, not appended.
- Within a turn later calls hit 92% (p50) — but 9 later calls fell back to the 32,128 prefix and 3 calls (t0 s1, t6 s2, t15 s4) cached 384 tokens only: something before the newest messages is rewritten between two steps of one run.
- Cost today is small (0.047 s per 1k uncached ⇒ ≈ 36 s of 501 s of Keeper calls, 7%), which is why this is P3; it grows with every provider slower at prefill.

## Scope
- Find which message(s) change between consecutive requests (a wire dump of two consecutive requests in a test harness: the static prefix, the per-turn window, the per-step `coc-clerk` note, carried views) and make what can be append-only append-only (e.g. the per-step note appended, not replaced; the rebuilt window placed after stable history). Record the before/after cache hit on a replay. No behaviour change to what the Keeper is told.

## Comments
