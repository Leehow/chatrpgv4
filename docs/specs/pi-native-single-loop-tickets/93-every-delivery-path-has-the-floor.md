Status: ready (filed 2026-09-26 from long gate #22; batch 17; P0 — the player saw a placeholder as the turn)
Stage: SL-93 (P0, delivery: one floor for every path that delivers prose)
Spec: docs/kernel-rpc.md §135.11 / §135.11.4 (SL-80: the floor's one steer, the dropped-draft rule), §135.5.2 (SL-92: `apply.narrate`), §34.13/§34.14 (markers, rendered delivery); `extensions/kernel/index.ts` (`FLOOR_STEER` ~754, the implicit-path floor ~5604–5614, the embedded narrate dispatch ~4090–4101, the explicit `narrate` tool path), `extensions/kernel/unwrapped-speech.ts` (`isSpeechOnlyDraft`), `content/rulesets/coc7/host-budgets.json`

# SL-93 — The floor applies to the explicit `narrate` and to `apply.narrate`, not only to the implicit path

## Evidence (long gate #22, `longgate22-haunting-1448`, d64c7a7c4, Keeper grok-4.5 low)
- Turn 1: `apply {effects, narrate: "text thriftily-placeholder"}` → delivered verbatim as the whole turn (`narrate_in_apply` ok, `closed_how: explicit`). The Keeper's real intent sat in text beside its tool calls ("受理委托与抵达已由书记结算。正在补登钥匙、称呼…"), dropped as `text_beside_tool_calls`.
- Turn 8: `apply {effects, narrate: "text"}` → the player read "text".
- The floor (§135.11.4) runs only on the implicit path (`toolCallsThisTurn === 0 || isSpeechOnlyDraft`); an explicit or embedded narrate of four characters passes every check, including the narration audit (it checks claims, not omissions).

## Ruling (filed for the owner; P0 because it reached the player)
One floor for every delivery path — implicit, explicit `narrate`, and `apply.narrate`: the rendered prose with markers and `{{say}}` tokens removed (speech inside say spans still counts as prose unless the whole draft is speech-only, SL-80's rule) must reach `delivery_floor.min_prose_chars` Unicode code points (data in `content/rulesets/coc7/host-budgets.json`, start at 40; structural length only, no word lists). Below it the draft is not delivered: the turn's one steer (`FLOOR_STEER`, existing budget) goes back to the Keeper naming what the turn settled; for `apply.narrate` the writes stay landed and only the embedded narrate is refused. Once the turn's steer is spent, the next draft closes the turn whatever its length (existing dropped-draft rule — the floor never strands a turn). Also: the `apply.narrate` schema description says the field holds the complete closing prose and is omitted when the Keeper will narrate separately.

## Scope
- Contract §135.11.4 addendum (the floor on every path; the data knob); the check shared by the three paths (one function), telemetry `{lane:"floor", reason:"below_floor", path:"explicit"|"embedded"|"implicit", chars}`.
- Tests (mutation-killable): `apply {…, narrate:"text"}` → writes land, no delivery, one floor steer; the second leg with real prose delivers; an explicit `narrate {text:"text"}` → steered; after the steer is spent a short draft delivers (no strand); a 40+ char Chinese draft delivers on the first leg; the threshold is read from the data file.
- Acceptance on gate #23: floor rows counted; no delivered turn below the floor unless it followed a spent steer (report each).

## Comments
