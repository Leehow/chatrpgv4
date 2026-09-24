Status: ready (filed 2026-09-24 from the SL-39 addendum; next batch)
Stage: SL-46 (P3, dependency; lanes)
Spec: docs/kernel-rpc.md §135.27 (thinking schedule), fast-model resolution; vendored Pi patches (docs/specs/pi-native-single-loop.md)

# SL-46 — Every Google model fails on the lane because the lane's `thinking` option breaks the vendored google adapter

## Evidence (SL-39 addendum, `experiments/single-loop-routing/results/sl39-lane-alternatives/`, `claude/sl39-20260924`@cc720b98a)
- `google/gemini-2.5-flash-lite` and three other Google models: 0 of 159 lane calls succeeded; every call throws `callerSignal.addEventListener is not a function` inside `ModelRegistry.complete()` of `@earendil-works/pi-coding-agent@0.87.0` (both `build/node_modules` and the live copy) when the lane passes `thinking: {enabled, level}`. Reproducible with the harness `experiments/admission-jev-bank/sl39-lane-alternatives.mjs`.
- Not a quality result: the models never answered. Any lane (admission, npc-voice, memory, journal) resolved to a Google model fails the same way.

## Scope
1. Find whether the adapter mis-handles the signal only with `thinking` set, or always through this call path; fix in the vendored patch series (a new patch, numbered after 0003) or guard the option per provider in the lane's model call, whichever is the real cause.
2. Tests: a lane call against a stub google-generative-ai model with and without `thinking` completes; the harness run for one Google model returns answers.

## Comments
