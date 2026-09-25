Status: ready-for-human (filed 2026-09-25 from the 血色公路 batch-8 table; batch 9; implemented 2026-09-25 on `claude/sl58-20260925`)
Stage: SL-59 (P2, admission / entities; follows SL-51 and SL-56)
Spec: docs/kernel-rpc.md §11.5.4 (SL-51), §22.4.7.1 (SL-56), §32.12.3 (line-level admission)

# SL-59 — A batch `apply` placing several persons the carried text names lands, each one as SL-51 lands one

## Evidence (ticket 29 batch-8 entry)
- One `apply` placing three book-named NPCs at once, when the carried `scene_text` note named all three verbatim, was refused hard in 22 ms (`retryable: false`) with no landing; SL-51's `_passage` marking and provisional registration cover a single `npc`/`person` write, not a batch, and the batch's refusal is whole.

## Scope
1. Contract: §11.5.4 addendum: the passage check runs per effect in a batch; each person named in the carried text lands provisionally; a person named nowhere refuses only its own line (line-level, §32.12.3).
2. Host (`extensions/kernel/index.ts`, the `_passage` marking) and kernel (`kernel-ts/apply/entities.ts`): per-effect marking and per-line refusal.
3. Tests, mutation-killable: a batch of three named persons lands three provisional entries; a batch with one unnamed person lands two and refuses one line with `unknown_entity`; the replay of the b8 table's placement turn.

## Comments

### 2026-09-25 — SL-58/59/60 worker (branch `claude/sl58-20260925`, base `e919a4024`)

**Commits.** `20da4c3d9` contract (§11.5.5, and §22.4.3.1 / §22.4.6.1 addendum for the other two tickets
in this batch); `6f9d4432f` implementation and tests; this entry.

**Where the gap actually was.** `extensions/kernel/index.ts`'s per-effect `_passage` marking (SL-51) has
iterated over every `npc`/`person` effect of a batch since it was first written (`bf88d96fd`) — a probe
before touching anything confirmed a batch of three persons each carrying its own valid `_passage`
already lands three receipts with the code on this branch's base. The batch's whole-refusal bug was in
`kernel-ts/apply/index.ts`'s commit: the per-effect loop computes every effect's receipt in memory
regardless of order (a documented, deliberate property, so a batch with two mistakes reports both in one
round trip), but `if (refused.length) throw ...` discarded all of them, landed or not, whenever any one
effect refused. A probe batch of two named persons (each with a `_passage`) plus one truly nameless one
reproduced this exactly: `unknown_entity` on the third, zero receipts.

**The fix, scoped to persons.** A refusal is isolable when its code is `unknown_entity` and its effect's
`kind` is `npc` or `person`, and only when the *whole batch* is npc/person effects (`allPersonEffects` in
the new code): a line like that names nobody but itself, so nothing else depends on it landing.
`tests/kernel/test_apply.py::test_reserved_and_unknown_effect_kinds` pins exactly why the whole-batch
kind matters, not only the refused line's: a `time` effect beside a refused `npc` pin used to refuse
whole, and my first version of this fix broke that test by landing the clock while the pin stayed
refused — silently advancing play past a refusal the Keeper never saw. The narrowed guard (every effect
in the batch, not only the failing ones, must be `npc`/`person`) fixed it; both the new JS test for this
exact shape and the pytest regression pass.

**An open finding, not fixed here (scope discipline, not an oversight).** The ticket's own evidence turn
in the b8 table is actually turn 8, not a fourth `unknown_entity` batch — I could not find any pure
`unknown_entity` batch refusal anywhere in that table's turns. Turn 8's batch (`拉斯·威廉姆斯`,
`内特·帕特森`, `史蒂夫·布朗` as `npc`, plus a `person` label) was refused whole in 26.6 ms with `needs:
the source material for '内特·帕特森' is not prepared` — §22.4.7.1's (SL-56) `material_pending`/
`requireMaterial`/`landPerson` mechanism, not §11.5.4's (SL-51) `personOfEffect`/`unknown_entity` one
this ticket's scope and test list name. `requireMaterial` throws on the *first* book-person name in a
batch it cannot land, discarding the others it had not yet checked, and the host's `landPerson` lands
only one person per retry — so a batch naming several unread book persons at once likely has the same
"batch refusal is whole" defect this ticket fixes, through the other mechanism. I did not extend this fix
there: the ticket's scope, ruling and test list are explicit about `unknown_entity`/§11.5.4, §32.12.3's
line shape, and this file's own evidence quote is the `unknown_entity` shape from ticket 29's earlier
retelling, not turn 8's literal message — extending into `requireMaterial`/`landPerson` batching is a
larger, separately-scoped change (multi-person accumulation across retries, or per-line narrowing on the
host side) that nothing in this ticket asked for. Flagging it here for a follow-up ticket rather than
silently taking it on.

**Tests, mutation-killed** (`tests/extension/passage-person.test.mjs`, copy-revert, runtime rebuilt each
time):
| # | mutation | killed by |
| --- | --- | --- |
| M1 | `isolatedRefusals` gate removed entirely (`= []` always) | "a batch with one unnamed person..." (zero receipts where two are expected) |
| M2 | `isolable` widened to accept any error code/kind | "a non-isolable refusal beside a landing..." and "an npc refusal that is not unknown_entity..." |
| M3 | `allPersonEffects` guard dropped | "a bookkeeping effect beside a refused npc pin..." (the new JS test) and `tests/kernel/test_apply.py::test_reserved_and_unknown_effect_kinds` directly |

**Replay.** Attempted against turn 8 (the batch's actual home), same read-only b8 home/run as SL-58's
entry, same fork recipe (`--turns 8 --queue-at 2026-09-25T07:42:12.141Z`). The replay ran and delivered
(`status: "delivered"`, `wall_ms: 48014` against the live table's 63,280 ms), but its own second model
step never re-issued the recorded npc-placement `apply` at all — the replayed Keeper, under
`--keeper replay`, settled the turn after landing the move alone, diverging from the live table's own
two-call turn. The npc batch was never exercised in this run, live-mechanism-mismatch aside (see the
finding above: turn 8 is `material_pending`, not `unknown_entity`, so it would not have exercised this
ticket's fix even had it fired). Not committed: the fork and replay results held the book and were
deleted from `/tmp` after inspection.

**Suites** (leehow-pc, `e919a4024`): ext `ℹ tests 3138`, `ℹ pass 3138`, `ℹ fail 0` (wall 166 s); loop
`# tests 196`, `# pass 196`, `# fail 0` (wall 43 s); py `1728 passed, 2 skipped` (wall 179 s), including
the `test_reserved_and_unknown_effect_kinds` regression this ticket's first draft caused and then fixed
in the same session.
