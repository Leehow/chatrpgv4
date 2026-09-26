Status: ready (filed 2026-09-26 from long gate #21; batch 16; P1 latency; continues SL-88 under the owner's "能不等就不等")
Stage: SL-92 (P1, Keeper steps: one tool call where the model insists on one)
Spec: docs/kernel-rpc.md §135.5 + §135.5.1 (SL-88: non-blocking writes share the narrate's call), §34.13.1 (effect-key markers), §135.11 (turn close / delivery evidence), §34.14 (only a rendered delivery counts), narration audit (§ narrate); `extensions/kernel/tools.ts` (`apply` schema), `extensions/kernel/index.ts` (tool dispatch, implicit/explicit narrate paths), `runtime/jev/hybrid-engine.ts` (`modelStep`)

# SL-92 — `apply` takes an optional `narrate`: the prose that closes the turn once the writes land, in the same single tool call

## Evidence
- SL-88 put the batching rule in the tool descriptions and the Keeper's turn-flow text. Gate #21 (grok-4.5 low, same Keeper/lanes as #18): `[apply…, narrate]` batches 4 (from 1), standalone `apply` calls 20 (from 18), Keeper calls per turn 2.8 (unchanged). The model emits one tool call per message; guidance does not change that habit.
- Each separate narrate call costs ≈ 1.4 s fixed + a fresh reasoning pass (≈ 160 tokens at ≈ 52 tok/s) + prefill — ≈ 4–5 s per turn that has a non-blocking write before the prose.

## Ruling (filed for the owner; the owner approved the aim: "不需要等结果的写入和 narrate 合进同一次调用")
`apply` gains an optional `narrate` field (same shape and rules as the `narrate` tool's `text`: play_language, markers — effect-key markers `{{kind:handle}}` are the natural ones here — `{{say:…}}` spans). When present: the host settles the apply's lines exactly as today (admission, kernel, receipts, §135.5 failure branch); if every line landed, it runs the narrate with that text through the same path the `narrate` tool uses (rendering, marker resolution, narration audit, delivery, turn close) — one model call for the whole turn. If any line was refused or the audit refuses the text, nothing is delivered and the Keeper gets the refusal as today (the text is held as the draft for the repair, like §135.11's dropped-draft rule). `resolve`/`look`/`lookup`/`recall` get no such field (they block). The `narrate` tool stays for turns with no write.

## Scope
- Contract §135.5 addendum 2 (the combined call), tool schema + one-line description ("put the closing prose here when nothing you are waiting on changes it"), dispatch in `index.ts`/`hybrid-engine.ts` so the embedded narrate is delivery evidence exactly as an explicit one; telemetry `{lane:"delivery", reason:"narrate_in_apply"}`.
- Tests (mutation-killable): `apply {lines…, narrate}` settles lines then delivers and closes the turn in one model step; a refused line → no delivery, refusal back to the Keeper, text held as draft; audit refusal of the embedded text → same as an explicit narrate's refusal; effect-key markers resolve; an `apply` without `narrate` behaves exactly as today.
- Acceptance on gate #22: Keeper calls per turn ≤ 2.0; `narrate_in_apply` deliveries ≥ 8.

## Comments
