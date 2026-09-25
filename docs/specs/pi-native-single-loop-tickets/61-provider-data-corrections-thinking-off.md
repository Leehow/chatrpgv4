Status: ready (filed 2026-09-25 from the deepseek Keeper baseline; batch 9)
Stage: SL-61 (P1, Keeper model latency; product-owned provider data)
Spec: docs/kernel-rpc.md §135.27 (thinking schedule) amend; runtime/host.ts (agent home); tests/play/driver.py `--thinking`

# SL-61 — Provider data corrections shipped with the product: a deepseek Keeper via opencode-go can be told thinking off

## Evidence (long gate #9 `longgate9-haunting-1234`, probes in the session scratchpad `thinking-probe/`)
- With the Keeper on `opencode-go/deepseek-v4.1-flash` "low", every turn was over 60 s (median 109 s): 59 model calls with reasoning p50 2,883 tokens (max 13,131), 90% of all output tokens were reasoning. The lane on the same model was fast because its prompts are small.
- Why "low" did nothing: pi-ai's deepseek thinking format sends `reasoning_effort` only when `compat.supportsReasoningEffort` is set, and the opencode-go model data (pi-ai's `providers/data/opencode-go.json`, mirrored in the App's `models-store.json`) has no such flag and declares `thinkingLevelMap.off: null` (off unsupported). So the product sent `thinking: {type: "enabled"}` with no effort and could not send off.
- Probed on the real turn-1 and turn-8 requests (40k tokens): `reasoning_effort` low/minimal is accepted by the endpoint but does not reduce reasoning (1,500–8,700 tokens); `thinking: {type: "disabled"}` is accepted and works: reasoning 0, turn 8 from 59–92 s to 3.1–3.5 s, tools still called. A `models.json` override `providers.opencode-go.modelOverrides.<model>.thinkingLevelMap.off = "off"` makes Pi send it (verified with `ModelRuntime.create({modelsPath})`).

## Ruling (owner, 2026-09-25)
Provider model data the product knows to be wrong is corrected by the product, as data: a corrections file shipped with the product (provider → model → override fields as Pi's `models.json` `modelOverrides` schema) is merged into the agent home's `models.json` when the host prepares the home, never clobbering a user's own entries. The first entries: `opencode-go/deepseek-v4.1-flash` and `deepseek-v4-flash` support `off`. The play driver takes `--thinking` (landed on the integration branch: `tests/play/driver.py`), and the gate launcher passes `off` for the deepseek Keeper.

## Scope
1. Contract: §135.27 addendum (provider data corrections; where the file lives; merge rule: product entries under user entries; the App's canonical models.json path is the pi-backend's business, so the merge happens where the agent home is prepared for a table, `runtime/host.ts`, and the same corrections are applied by pi-backend's home preparation if it has a hook, else recorded as a follow-up).
2. Data file (e.g. `content/providers/model-corrections.json`) with the two entries; the merge at host preparation; a note in the agent home file saying which entries are the product's.
3. Tests, mutation-killable: the merge writes the override into an empty home; keeps a user's existing override and other providers; the registry resolves `off` for the corrected model (Pi's `ModelRuntime.create({modelsPath})` on a fixture home); the driver's `--thinking off` reaches the launcher args.
4. Live: the owner runs long gate #10 with `--thinking off` on this build; the ticket records its numbers.

## Comments

- **2026-09-25, owner, scope 4 (live).** Long gate #10 on the same runtime with the agent home's `models.json` override and `--thinking off`: 73 Keeper calls, reasoning tokens 0 on every one, p50 2.6 s / p90 7.1 s (gate #9 "low": p50 27 s, 11 calls over 45 s); median wall 26 s, 19/20 turns under 60 s; prose zh-Hans and coherent on the four turns read. The one stranded turn (t4) is unrelated to thinking (SL-62/63). The override is the right shape; this ticket ships it as product data.
