Status: ready-for-human (landed 2026-09-26 on claude/sl71-20260926, commit 3638c719d)
Stage: SL-71 (P2, kernel resolve; a legal path for what the Keeper keeps asking for)
Spec: docs/kernel-rpc.md §11.5 (a combat defence already names an NPC as `actor`), §11.5.2/§11.5.3 (NPC standing defence / action), `kernel-ts/read/handlers.ts:98` (`no investigator … at the table`), §16.2 (public mechanics names: `actor_is_investigator`)

# SL-71 — An NPC the table knows can be the actor of an ordinary `resolve`: the NPC's own roll

## Evidence (long gate #11 `longgate11-haunting-1515`, ticket 02's entry)
- Five `resolve` calls with an NPC as `actor` ("no investigator 'Steven Knott' at the table", also Gabriela, Mr. Dooley) were refused `unknown_entity`; the Keeper repeated each to the class limit and the refusal budget cut two runs. Call of Cthulhu has NPC rolls (an NPC's own Spot Hidden, Psychology, opposed checks); today the only NPC actor the kernel accepts is a combat defender (§11.5), so the Keeper has no legal path for the rest and can only narrate the outcome unrolled.

## Ruling (owner, 2026-09-26)
A `resolve` whose `actor` is a person the table knows (an authored NPC of the module, an established table person, a `from_passage` person) is the NPC's own roll: the kernel rolls it against the NPC's authored skill where the graph has one, else the standing defaults the NPC profile already carries (§11.5.2's shape), settles it as a roll receipt with `actor_is_investigator: false` (Keeper-side by §16.2: no name and no number reaches the player unless the existing public-combat rule says so), and never touches the investigator's sheet. An actor the table does not know is still `unknown_entity` with the candidates (investigators and known people). Opposed checks stay as they are (the investigator's resolve with a `target`).

## Scope
1. Contract: §11.5 addendum (the NPC's own roll; skill source order; receipt flags; visibility) and the `resolve` action row; `kernel-ts/read/handlers.ts` actor resolution accepts known people; `kernel-ts/resolve/*` rolls with the NPC's values; admission grounds unchanged (the compile does not select NPC rolls; they are the Keeper's).
2. Tests, mutation-killable: an NPC actor with an authored skill rolls it and the receipt carries `actor_is_investigator: false` and no public name; an NPC without the skill uses the profile default; an unknown actor still refuses with candidates; the investigator's sheet is untouched; the gate #11 t0/t6/t19 shapes replayed (recorded Keeper) land instead of refusing.

## Comments

**Landed 2026-09-26**, branch `claude/sl71-20260926`, commits `3638c719d` (core: NPC actor for an
ordinary check, rulebook-default fallback, keeper visibility, `unknown_entity` widened; plus the
`natural-npc:first-impression` orientation fix once the coordinator traced the actual gate #11 t0/t19
shapes to a reversed actor/target pair, not a bare NPC-own-roll), `d854f9948` (unrelated: SL-72,
committed alongside), `1545f4481` (a regression the pytest baseline caught during finishing: an
`uncommon` skill must still ask, not default -- see below).

**What shipped, beyond the ticket's original scope.** The owner's evidence review found the gate #11
t0/t6/t19 refusals were not plain "NPC actor, own roll" calls at all: they were
`natural-npc:first-impression` with the NPC written as `actor` and the investigator as `target` (the
pair the English sentence "Steven Knott's first impression of Thomas Hayes" suggests, and this family's
own fixed roles reversed). `kernel-ts/mods/resolve.ts`'s `resolveBeforeMain` now reorients rather than
refuses in that shape and stamps `oriented_from` on the receipt; contract text is §11.5.9's own addendum
(2026-09-26 continued), not a separate ticket. The ordinary "NPC's own roll, no target" shape (t4's
Charm, and this ticket's original scope) is unchanged and still lands via `hostLocked`/`executeCheck`.

**Contract:** docs/kernel-rpc.md §11.5.9 and its addendum (both under §11 in this file).

**Files:** `kernel-ts/read/handlers.ts` (new `actorKnown`/`enrichActorRefusal`, shared by both callers
below), `kernel-ts/resolve/pipeline.ts` (`resolveActor` uses `actorKnown`), `kernel-ts/resolve/bindings.ts`
(`hostLocked`'s rulebook-default fallback, `rulebookSkillDefault`, its `uncommon` guard),
`kernel-ts/resolve/basic.ts` (`executeCheck`'s keeper-visibility default), `kernel-ts/mods/resolve.ts`
(`resolveBeforeMain`'s actor/target reorientation).

**Tests, mutation-killed** (`tests/extension/npc-actor-own-roll.test.mjs`, real kernel via
`kernel-ts/testing/api.ts`, no fake kernel): pinned-skill NPC roll (`actor_is_investigator: false`,
`visibility: "keeper"`, investigator sheet byte-identical before/after); no pinned/authored *common*
skill rolls the rulebook base chance; a missing *uncommon* skill (Animal Handling) still refuses `needs`
(added after the pytest baseline caught the gap -- see below); a bare characteristic with nothing on
record still refuses `needs`; an unknown actor refuses `unknown_entity` with both investigator- and
npc-kind candidates; a first-impression written with actor/target reversed settles oriented, with
`oriented_from` on the outcome and the receipt, investigator sheet untouched; the same decision with
both names unknown to any investigator still refuses, both candidate kinds present; an ordinary Charm
check with an NPC actor and no target is that NPC's own roll. Each product change was reverted via a
scratch copy (`cp` to `/private/tmp/.../scratchpad/mutation/*.orig`, edit in place, run, `cp` back --
never `git checkout --`) and the matching test(s) confirmed red before restoring; four such rounds for
this ticket (rulebook-default fallback, keeper-visibility default, the orientation fix, and the
`uncommon` guard), each isolating exactly the tests it should.

**A real regression, caught by the pytest baseline, not this ticket's own suite.** The first full
`pytest` run after landing (`test:ext` was already green) turned up one red:
`tests/kernel/test_npc_layer.py::test_an_ordinary_npc_helper_needs_their_missing_skill_without_using_player_base`
(Steven Knott, missing Animal Handling) -- the new rulebook-default fallback rolled Animal Handling's
printed base chance (5) instead of asking, exactly the "the kernel inventing a number" §17.9's L3
forbids. Animal Handling is `uncommon: true` in `skills.json`: CoC 7e uses that flag for a skill nobody
has without deliberate training, so its base chance is not "what any ordinary person can do" the way a
common skill's is. `rulebookSkillDefault` now returns null for an uncommon skill (commit `1545f4481`),
leaving that pytest exactly as it was and adding the matching case to this ticket's own suite. This is
the sole reason the final `pytest` count below is the unmodified baseline, not baseline-minus-one.

**Full suites on leehow-pc** (branch head `1545f4481`): `test:ext` 3195/3195 (baseline 3184 + 11 new,
0 failures; three earlier runs each turned up one different, unrelated single-test flake under box load
-- `keeper-call-cap`, `single-loop-prescreen-budget`, `an adaptation wait` -- each gone on the next
run, none touching a file this ticket changed); `test:loop` 196/196 (unmodified baseline); `pytest`
1730 passed, 2 skipped (unmodified baseline, once the `uncommon` fix landed).

**Not done:** the ticket's own suggestion to replay gate #11's exact recorded t0/t6/t19 capsules was
superseded by writing the actual shape (the reversed-pair first impression) as a direct kernel test
instead of a recorded-transcript replay -- faster to write, and it pins the mechanism rather than one
recorded transcript's exact bytes.

Status: **ready-for-human**.
