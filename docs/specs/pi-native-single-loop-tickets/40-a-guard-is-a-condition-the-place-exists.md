Status: ready-for-human (filed 2026-09-24 from long gate #3 and SL-29A; batch 4; implemented 2026-09-24 on `claude/sl38-20260924`)
Stage: SL-40 (P3, fiction/rules)
Spec: docs/kernel-rpc.md §135.25 (destination rows), §135.28 (ordinary check defaults), §135.31 (carried views)

# SL-40 — A guard is a pacing condition and the place exists; an ordinary check defaults to a skill the investigator holds

## Evidence
- Long gate #3 t14–t18: the basement's guard (`clue_discovered: corbitt-diaries`) held because the diaries were never opened. The destination row reported the guard and its unlock (as SL-25 requires), and the Keeper rendered the guard as physical absence: "壁橱后头是实墙…没有台阶，也没有往下的口子" three turns running, while the book (the window's own answer at t15) says the basement is reached from the ground floor by a bolted door. The Keeper kept the diaries in view ("三本旧书…你没有翻开它们") but the fiction contradicted the house.
- SL-29A t5: the bridge check rolled Engineering, a skill not on the sheet (base value), when the sheet had usable skills.

## Scope
1. Destination rows (`kernel-ts/read/destination-rows.ts`) and the guarded-exit guidance: a guarded row states that the place and its entrance exist, what the book says about the entrance (from the scene's passages where present), and the unlock; the guidance says the Keeper narrates the entrance as the book has it and what is missing, never the place as absent.
2. Ordinary check defaults (§135.28, the ordinary binder): when the compile names no skill, the default is a skill the investigator holds that fits the act feature; a skill absent from the sheet is chosen only when the declaration names it.
3. Tests, mutation-killable: the guarded destination row's fields; the binder's default on a fixture sheet; no prose assertions.

## Comments

### 2026-09-24 — implemented and tested (branch `claude/sl38-20260924`, base `1660ec0fd`, with SL-38)

**Findings.**
- *Guard.* The only guidance on a held exit was §135.30.4's `guarded_note`, which offered "or narrate the way shut". Nothing in the guard said the place or its way exist. The capsule's exits and the prompt carry no other guarded-exit wording.
- *Skill.* `table.resolve.options.profiles` lists every catalog skill: the sheet's, then the rulebook's unlisted skills at their base chance, then the characteristics. The single-loop binder's profile question offered all of them. At SL-29A t5, Jev answered Engineering 0.45 (Carpentry 0.18, Spot Hidden 0.17), which cleared by the margin rule. The sheet (雷·卡特) does not list Engineering.

**Contract.**
- §135.30.6, guard:
  - an unmet unlock gains `exists: {place, entrance, from, from_place}`;
  - the note's guarded entry gains `entrance.passages`: §135.31.1's `scenePassages` for the destination handle from this run's prescreen, fitted to 4 KiB, absent when nothing was located;
  - `guarded_note` is replaced: narrate the entrance as the book has it and what is missing, never the place or its way as absent.
- §135.28.1, skill:
  - profile rows gain `held` (the sheet lists the skill, or it is a characteristic);
  - the single-loop binder's one batch asks `profile` over the held rows, for the act on the state, and `named` over the unheld rows plus `none`;
  - a `named` answer that clears the gate binds; otherwise `profile` binds;
  - the legacy advisory binder, and rows without `held`, ask the one question as before.

**Changes.**
- Guard:
  - `kernel-ts/read/destination-rows.ts` (`guardedWay`) and `kernel-ts/runtime/apply-operation.ts`;
  - `runtime/jev/hybrid-engine.ts` (`GUARDED_NOTE`, `withEntrance`).
- Skill:
  - `kernel-ts/runtime/resolve-operation.ts` (`held`);
  - `runtime/jev/ordinary-resolve-domain.ts` (`ordinaryProfileBatch({held})`, `pickOrdinaryProfile`);
  - `runtime/jev/check-preflight.ts` (evidence `held`/`named`, `evidence.named`);
  - `runtime/jev/step-policy.ts` (the bind record's `held`/`named`); the engine's `bind-ordinary` row carries both.

**Tests** (row fields and selections, no prose):
- guard:
  - `tests/kernel/test_jev_apply.py::test_unmet_unlock_says_the_place_and_its_entrance_exist_from_where_the_party_is`: the office's held morgue says `from: commission-briefing`; after the leads and keys, no `exists`; at the ground floor the basement's says `from: corbitt-house-ground`;
  - `tests/extension/single-loop-destination-rows.test.mjs`: the SL-25 emitted-kernel test now expects `exists` and `GUARDED_NOTE`; `withEntrance` gives the destination's entity, then the scene whose edge leads there, leaves out a book passage read at another scene, gives no key when nothing was located, and cuts to 4 KiB with a mark; `exists` stays off Jev's words;
- skill:
  - `tests/kernel/test_jev_resolve.py::test_profile_rows_say_which_skills_the_sheet_holds`;
  - `tests/extension/single-loop-binding.test.mjs`, 3 SL-40 tests on book A's sheet shape:
    - profile offers only held rows (a listed base-value skill and STR included) and `named` only the rest;
    - `named` none binds Spot Hidden;
    - `named` Engineering at 0.9 binds it, recorded `held: false, named: true`;
    - at 0.4 it does not;
    - the advisory binder and rows without `held` keep the one question.

**Mutations** (copy-revert). All killed:

| id | mutation | tests failed |
| --- | --- | --- |
| M6 | `exists` dropped in the kernel | 1 (the emitted-kernel ext test) |
| M17 | `exists` dropped in the kernel | the pytest `exists` test |
| M7 | `withEntrance` returns the entry unchanged | 1 |
| M8 | held mode's profile offers every row | 1 |
| M9 | `named` taken without the gate | 1 |
| M10 | held mode off | 2 |
| M13 | the bind record's `held`/`named` dropped | 1 |
| M16 | the kernel's `held` always true | the pytest `held` test |

Not covered at the engine seam: the note's `.map(withEntrance)` wiring and its `missedUnlocks` read. Both are one-line calls of the pure functions tested above.

**Live Jev probe** (not a table). Book A t5's sentence through the single-loop binder, with the real profile rows (the t5 distribution's skills; `held` from `party/investigator.json`), live Jev, 3 runs per arm. Script `experiments/single-loop-routing/sl40-binder-probe.mts`; rows in `results/sl40-binder-probe.jsonl`.

| arm | binds | `profile` | `named` |
| --- | --- | --- | --- |
| held | Spot Hidden 2/3; `unknown` 1/3 (the Keeper's, as §135.28 says) | Spot Hidden 0.29–0.32, under the gate, so admission reviews it | `none` 0.99 in every run |
| legacy (one question) | off the sheet 3/3: Craft (Carpentry) ×2, Engineering ×1 | 0.30–0.31 | – |

**Suites.** Same runs as SL-38:
- py 1721 passed, 2 skipped;
- loop 163/163;
- ext 2995/2995.

**Not done.** No live table: the ruling's effect on the Keeper's prose (the basement narrated through its door) is unmeasured.

