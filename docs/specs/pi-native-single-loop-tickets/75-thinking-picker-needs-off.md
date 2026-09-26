Status: ready (filed 2026-09-26; Electron UI, for the App-side session; not in this integration branch's scope)
Stage: SL-75 (P3, Electron `packages/ui` thinking picker)
Spec: docs/kernel-rpc.md §135.27.1 (product corrections declare `thinkingLevelMap.off` for models whose provider data lacks it)

# SL-75 — The thinking picker lists Low/Medium/High/Xhigh and no Off; for deepseek Off is the only switch that does anything

## Evidence
- Screenshot 2026-09-26 (PipiUI composer, Keeper "Grok 4.7 Fast", picker "low"): entries Low ✓ / Medium / High / Xhigh. For `opencode-go/deepseek-v4.1-flash` the four levels send the same request (probe on gate #9's real requests: `reasoning_effort` accepted, reasoning unchanged); `off` (SL-61's corrections) cuts a call from 59–92 s to 3 s. The user cannot reach it from the UI.

## Ruling
The picker offers `Off` whenever the selected model's `thinkingLevelMap` (after the product corrections) maps `off` to a value, and hides levels the model's provider data marks as no-ops when that is knowable; the stored key does not change. Same data path as the App's model list (§135.27.1); no per-model list in the UI code.

## Comments
