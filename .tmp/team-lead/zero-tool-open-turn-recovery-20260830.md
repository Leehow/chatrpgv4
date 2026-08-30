# Zero-tool open-turn recovery handoff

## Scope and ownership

- Active track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
- Opposite track: Codex-host implementation, adapters, prompts, launchers, tests, and documentation remained off-limits.
- Branch: `codex/pi-coc-zero-tool-open-turn-recovery-20260830`
- Worktree: `/Users/haoli/leehow/code/chatrpgv4-wt-zero-tool-open-turn-recovery-20260830`
- Exact base: `ce76fc85e6524b4cb57fb9e0385d822020602fe1`
- Lifecycle task: `pi-coc-zero-tool-open-turn-recovery-20260830`

## Observed failure and RED

The production -08 failure accepted a natural external player message and wrote the v2 host cache, but Grok then made zero canonical tool calls before the session was aborted. A fresh official xAI session correctly called `session.resume` first, while canonical state returned `mode=awaiting_player`, `current_turn=null`, and `pending_turn=null`. The Pi host only hydrated cached input for an already materialized `open_turn_recovery` row window, so the accepted action disappeared from the Keeper surface and would have required a forbidden resend.

The production-shaped RED added to `tests/pi/recovery-kp-guidance.mjs` recorded a real v2 anchored input and returned the observed canonical envelope. Before the fix it remained `awaiting_player` instead of recovering the accepted turn.

## Minimal systemic repair

The Pi host now performs a narrow rebound after a successful, contract-accepted `session.resume` and before progress/phase projection. It may reclassify `awaiting_player` as `open_turn_recovery` only when all of these host-authoritative facts agree:

- exact requested/canonical campaign match;
- `current_turn`, `pending_turn`, `pending_output_context`, and `ending_output` are all absent;
- canonical resume returns a valid v2 open-turn anchor;
- the host cache passes schema, campaign, text digest, and exact anchor verification.

The synthetic host-local current-turn marker has zero canonical rows and is accepted by recovery guidance only when the validated zero-tool cache path explicitly authorizes it. Normal row-backed recovery still requires nonempty rows and a real canonical source digest. The model receives exactly one keeper-only semantic `current_turn.player_input` card; the anchor, cache digest, source session, epoch, and other machine identity remain hidden. Existing open-turn recovery ACL/working-set logic then exposes the ordinary pre-journal acting surface (`scene.context`, actions, rules, NPC, and journal as applicable) while setup, new player input, output/review/finalize, and closure surfaces remain unavailable until existing mechanics/journal guards advance them.

No Python cache reader/migration, fixed First Aid or other rule workflow, RuleGraph, rule source, wire, campaign, rewind, or finalize implementation was added or changed. Existing journal/finalize cache clearing and anchor roll-forward paths are unchanged.

## Fail-closed evidence

The production-shaped extension tests cover:

- valid exact-anchor zero-tool recovery;
- missing cache;
- tampered cached text/digest;
- cross-timeline anchor mismatch;
- a canonical pending/journaled pointer.

Only the valid case rebinds. Every neighbor remains ordinary `awaiting_player`, receives no recovery guidance, and gets no journal authorization. The test also proves the player text is not duplicated through a player-visible send.

## Validation

- `tests/pi/recovery-kp-guidance.mjs`: PASS, including the original row-backed recovery suite and new zero-tool/adversarial cases.
- `tests/pi/open-turn-player-input.mjs`: 6/6 passed.
- `tests/pi/tool-working-set.mjs`: 19/19 passed.
- `tests/pi/domain-tools-acl.mjs`: PASS.
- `tests/pi/startup-resume-table-opening.mjs`: PASS.
- `tests/pi/normal-model-id-boundary.mjs`: PASS.
- `tests/pi/system-instruction-protocol.mjs`: PASS.
- Focused Pi package/ACL/role/operation/typed-surface/working-set/cache/startup/recovery/plugin-metadata pytest group: 43 passed in 7.34s.
- `tests/pi/tool-affordance-extension.mjs`: 43/43 passed.
- `tests/pi/turn-processing-fault-gate.mjs`: 21/21 passed.
- `tests/test_continuation_resume.py -q -p no:cacheprovider`: 14 passed in 38.76s.
- `git diff --check`: PASS.

Targeted external precedent research was skipped because this is a narrow repair to an established repository-private host/cache/anchor contract; local production-shaped evidence directly determines correctness and the requested closeout is time-bounded.
