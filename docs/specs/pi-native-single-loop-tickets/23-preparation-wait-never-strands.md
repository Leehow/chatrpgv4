Status: ready-for-human
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

### 2026-09-24 — implemented on `claude/sl23-20260924` (from `1dccf4578`)

**Evidence read.** The ticket's "longgate-haunting-1010" is campaign `longgate-haunting-0624` (playtest
`longgate-haunting-0624-20260924T102454Z`) under `chatrpgv4-wt-integ-sl/.coc`; copied, never written. Turn 19's telemetry rows
2721–2786 and the event log's text deltas show the chain: `prepare` 12 243 ms `pending` → the diaries' `apply` (`define` +
`object`, nothing to do with the street) `blocked: preparation_wait` with its process talk dropped (`text_beside_tool_calls`) →
the compose's prose dropped (`preparation_wait`) → `turn_close` steer `adaptation-wait` → the steered leg's prose dropped for
the wait again → `turn_close` none `steer_spent`, `unsent_fix: adaptation-wait` → `stranded`. Turn 20's boundary read the
proposal `ready` (held); the clerk's `apply:move:commission-briefing` and the Keeper's `look` were both refused
`blocked: preparation_wait`. The job (`.coc/adaptation-jobs/longgate-haunting-0624/2561…`): creator 12 s, reviewer 22 s, ready
35 s after it started.

**Cause.**
- `extensions/kernel/index.ts:4590` (at `1dccf4578`): `if (state.preparationWait && !sourceWait)` dropped every prose leg for
  as long as the wait was held, with no `!state.steeredThisTurn` guard and no held draft, so the one steer could never be
  answered with a delivery; `takeTurnCloseSteer` (`:1227`) did not consume the wait's fix, hence `unsent_fix`.
- `extensions/kernel/index.ts:4288-4308`: the `tool_call` gate refused every verb except `narrate` and the adaptation
  controls under a `pending`/`reviewing` wait, and every verb except the controls under a `ready` one (§36.15 "turn
  ownership", its cold-recovery control state, §111.1's one exemption) — the diaries on turn 19 and the clerk's move on turn 20.
- `extensions/kernel/adaptation.ts:10`: `FOREGROUND_WAIT_MS = 12_000` — the 12.2 s inside the turn.

**Fix (contract first: §135.11 addendum "SL-23", with pointers in §36.15, §60 and §111.1).**
1. The wait steers once and holds the draft it drops (`floorDraft`, as the floor and speech steers do); the steer consumes
   the wait's own fix. The steered leg goes through the implicit narrate with `preparation_wait`; a leg that brings nothing,
   or one the kernel refuses, falls back to the held draft (SL-16's path).
2. A held preparation (any held status) refuses only what needs it: an `apply` with a `move` to the proposal's own name
   (id fold) and a second `prepare` (`needsPreparation`). Reads, checks, other effects, moves to existing scenes and the next
   turn's clerk writes pass. §60's over-notice is never spent on, and never refuses, a clerk (policy-origin) call — a move
   that stales the job would otherwise refuse the clerk one turn later.
3. The prepare's budget inside the turn: `PI_COC_ADAPTATION_WAIT_MS` default 2 000 (was 12 000). Measured first: 7/7
   retained prepares that started a job (gate and playtest tables to 2026-09-24) answered `pending`/`reviewing` after
   12 090–12 601 ms, none `ready`. Each prepare now writes `lane: "adaptation", event: "prepare"` with `ms` and
   `wait_budget_ms`.

**Tests** (`tests/extension/preparation-wait-never-strands.test.mjs`, 9; hybrid, fake kernel, the emitted kernel for the
clerk): turn 19's shape delivers the second leg with `preparation_wait`, lands the diaries' apply, one wait drop, no
`unsent_fix`, the cost row; nothing on the second leg → held draft; second leg refused → held draft (`steered_leg_refused`);
both refused → undelivered, three drop rows, `unsent_fix: audit-repair`, the notice; a move to the proposal is refused with
the instruction; a steered leg that tries that move and then brings nothing → held draft; next turn's clerk move to an
existing scene lands under a held pending proposal (emitted kernel, a creator that never answers); the clerk's move that
staled the proposal is not refused and the notice lands on the Keeper's own call; a retained `ready` proposal holds neither
a read nor an unrelated write and refuses a move there by name. `adaptation-host.test.mjs`: the 2 s default and override.
Four old-contract cases in `turn.test.mjs`, one each in `host-state-not-fiction` and `stale-adaptation`, now block a
dependent write where they blocked an ordinary one (the cold-recovery case now asserts the ready proposal is held by name
and the narrate is taken first time).

**Mutations** (each applied alone, the six affected files run): wait drop ignores the spent steer — killed (5); drop holds no
draft — killed (4); every apply needs the preparation — killed (6); a move there does not need it — killed (9); a second
prepare passes — killed (2); the over-notice refuses the clerk — killed (1); wait budget back to 12 s — killed (1); id fold
without case — killed (1); no prepare cost row — killed (1). **Survived: the steer leaving the wait's fix behind** — every
reachable path after the steer either delivers (clears the fix), is refused (overwrites it with `audit-repair`) or pauses
(clears it), so the leftover is visible only on a leg that cannot close; kept for the row's truth, not claimed as tested.

**Replay of turn 19** (new fixture `longgate-t19` from `gate-fixture.mjs`, which now keeps each message's streamed prose
and marks calls the live wait refused; `product-entry.ts` replays those calls and answers a stranded turn's composes with
the recorded prose; recorded Keeper, live Jev, `--latency live`, `PI_COC_READER_CMD` a creator that never answers, as live):
- before (`1dccf4578` + the harness change): 3/3 `undelivered`, `turn_close_steer_spent:no_delivered_evidence`, wall
  63.9 / 62.8 / 62.5 s; prepare 12 242 ms; apply `blocked: preparation_wait`; drops `preparation_wait` ×2; `unsent_fix:
  adaptation-wait` — the live shape.
- after: 3/3 `delivered`, `implicit_narrate`, wall 53.8 / 51.3 / 51.2 s; prepare 2 243 ms (`pending`, cost row
  `wait_budget_ms: 2000`); the apply passes the gate and reaches the kernel, which refuses it `needs:
  mod_generation_required` (the replay mounts no Mod bridge to define items; not the wait); one `preparation_wait` drop, steer
  `adaptation-wait`, the second recorded prose delivered by the implicit narrate.

**Open.** Turn 20 is not replayed: the fixture tarball carries no `.coc/adaptation-jobs`, so the held `ready` proposal is
not in it; the next-turn clerk move is covered by the emitted-kernel tests above. A live table is the stage gate.

**Merged `claude/integ-single-loop-20260923` at `f0d90d626` (SL-25) as `439b9fa22`, clean.** Replay on the merged tree: 3/3
`delivered` `implicit_narrate`, wall 52.8 / 51.2 / 51.3 s, prepare 2 227–2 245 ms.

**Suites on the merged tree `439b9fa22`:** `test:ext` 2912/2912 (leehow-pc, 224 s; and on the Mac, 229 s). Loop suites
137/137 (leehow-pc). `pytest tests/kernel tests/play` 1719 passed, 2 skipped (leehow-pc). Before the merge, on `c87f5efe2`:
two leehow-pc `test:ext` runs at load 50+ (other workers' pytest) each had one or two different timeouts
(`npc-preparation-integration`, `standing-condition-notice`, a source-consultation case), all passing alone and in the Mac's
full run (2908/2908); the baseline at `1dccf4578` was 2898/2898.
