Status: ready-for-agent
Stage: SL-23 (P0; extends SL-16)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "A preparation wait never strands a turn")

# SL-23 — A preparation wait never strands a turn, and never blocks the next one

## Evidence (long live gate, campaign longgate-haunting-1010 under chatrpgv4-wt-integ-sl/.coc/campaigns, turn 19, run run-01a0d301-c8da-7552-937e-4f223e5bd6a9)
- The Keeper called `lookup kind: adaptation action: prepare purpose: new_destination name: corbitt-house-front` (12.2 s inside the turn) after a failed `look object "Corbitt Diaries"` (unknown_entity) and a module lookup.
- Drops: `text_beside_tool_calls`, then `preparation_wait` twice; turn_close steer `adaptation-wait` spent; `unsent_fix: adaptation-wait`; run_end `turn_close_steer_spent:no_delivered_evidence`; turn 0019 `closed_by: stranded`, the player saw the unfinished notice.
- Turn 20: the clerk's compile-selected `apply:move:commission-briefing` was refused `blocked: preparation_wait`; the Keeper's own apply then took an 11.8 s lane review.

## Scope
1. Contract first (§135.11 addendum; the adaptation/preparation sections it touches): the second leg after a preparation-wait steer is delivered with the wait stated (implicit narrate carries `preparation_wait`), and if it is refused the dropped draft is delivered as SL-16 does; a pending preparation blocks only the writes that depend on it (the new destination), never a move to an existing scene or the next turn's clerk writes.
2. Implement in extensions/kernel/index.ts (the delivery hook's preparation_wait branch, takeTurnCloseSteer) and wherever `blocked: preparation_wait` is raised for apply; the adaptation prepare call gets a budget inside the turn (report what it costs today).
3. Tests, mutation-killable: a run whose Keeper prepares a destination and writes prose delivers; both legs refused → notice with rows; next turn's clerk move not blocked. Replay a fixture from the long gate's turn 19 state (read-only campaign) with the recorded Keeper.

## Comments
