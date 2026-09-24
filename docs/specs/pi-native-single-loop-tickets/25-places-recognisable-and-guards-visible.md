Status: ready-for-human
Stage: SL-25 (P1; extends SL-13)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "A place the kernel offers must be recognisable from what the player says")

# SL-25 — Destination rows the player can recognise, guarded exits the Keeper can see

## Evidence (long live gate, campaign longgate-haunting-1010)
- Destination rows carry `display_name` placeholders from the starter: "scene previous tenants", "scene upper floor bedroom", "scene basement rites" (content/starters/the-haunting scene nodes). The player said 罗克斯伯里疗养院 (turn 6/7 → `none` 0.99/0.74), 上二楼…主卧 (turn 11 → `none` 0.54), 下地下室 (turn 16 → basement-rites 0.96 cleared but `decided_none`).
- Turn 9 (去科比特宅) and turn 16: the destination cleared but no move candidate was offered (guarded exits, `unlock_when` unmet), so the compile decided none and the Keeper either moved itself (turn 9, lane 4 s) or narrated "no stairs" for four turns (15–18) without knowing what the book says unlocks the basement.
- Compile rows: `lane: route, purpose: compile` for each turn; the candidate builder's guard handling in runtime/jev/candidates.ts (~line 278).

## Scope
1. Contract first (§135.30 amendment, §135.2 rows): a destination row = the scene's authored label in the play language when present, else its name; its summary/where-words; the people and things the kernel knows there. A cleared destination whose move is guarded is reported on the compile row (`guarded: {to, guard}`) and in the clerk projection to the Keeper with the guard's own words (the clue/condition the book names), never the handle alone.
2. Content: author labels (en and zh-Hans) for the haunting starter's scenes whose display_name is a placeholder (module-graph / starter files; check the campaign compile snapshot rule: a new campaign is needed to see them).
3. Implement; tests, mutation-killable; replays with live Jev on fixtures built from the long gate's turns 6, 11 and 16 states (read-only campaign): the destination clears to the right row; the guarded case reports the guard.

## Comments

### 2026-09-24 — contract §135.30.4, kernel rows, the haunting's names, the guarded report (branch `claude/sl25-20260924`, base `1dccf4578`)

**What was actually wrong.** The campaign is `longgate-haunting-0624` (the ticket's `-1010` is the gate's clock time). The
destination rows read `{place: "previous-tenants"}`, `{place: "corbitt-house-ground"}`, `{place: "basement-rites"}`: six of the
haunting's twelve scenes had no authored name (their graph `name` is the placeholder "scene previous tenants", which
`displayName` reads back as the handle; the morgue, library, records hall, chapel and courts had `destination_identity`, the
others none). And a move row carried only the exit's handle and one label, so the Macarios the player named at turn 6 were in
no row either. Turn 16's basement and turn 9's house cleared, but their exits' `unlock_when` was unmet (the diaries clue refused
at t14, the keys clue at t1), no move was issued, and nothing told the Keeper what the book says opens them.

**Where each piece lives.**
- Contract: `docs/kernel-rpc.md` §135.30.4 (after §135.30.2; §135.30.3 is SL-26's), with §135.2's first bullet and §135.30's
  destination row amended.
- Kernel: `kernel-ts/read/destination-rows.ts` (`destinationView`: the book's other names, summary unless it is the node's own
  name, `location_tags`, people by `personLabel`, non-media assets; `unlockGuard`: the clue's handle, its own words, and every
  scene the book puts it in with the granting affordance cues; the flag); wired in `kernel-ts/runtime/apply-operation.ts`
  (`table.apply.options` move rows gain `description.destination` and, when unmet, `unlock_when.clue` / `unlock_when.flag`).
- Runtime: `runtime/jev/compile-rows.ts` (the destination row = the label plus the kernel's words; a held-back move's `guard`
  beside `describe`, never sent to Jev: the unmet unlock without `met`, or `{obligation, demand}` for `guarded_by`);
  `runtime/jev/route-compile.ts` (`FeatureRow.guard`, `guardedDestinations`, `CompileOutcome.guarded`; no predicate touched);
  `runtime/jev/step-policy.ts` (the compile step's detail) and `runtime/jev/hybrid-engine.ts` (the compile row's `guarded`; the
  next `coc-clerk` note carries `guarded` + `guarded_note` once per destination per run).
- Content: `content/starters/the-haunting/module-graph.json` gains `destination_identity` on the six scenes (below); the two
  guidance bundles re-stamped with `guidanceFingerprint` (text unchanged; the script reproduced the committed stamps exactly on
  the parent graph before re-stamping, as RD-04 did).

**The labels authored** (canonical, then aliases; English, the graph's language):
- `previous-tenants`: "Roxbury Sanitarium" -- "the Roxbury Sanitarium", "the sanitarium in Roxbury";
- `corbitt-house-ground`: "The Corbitt House" -- "Corbitt House", "the old Corbitt place", "the Corbitt residence", "Corbitt House ground floor";
- `upper-floor-bedroom`: "Corbitt House upper floor" -- "the upper story of the Corbitt House", "upstairs in the Corbitt House", "the Corbitt House bedrooms", "Corbitt's old bedroom";
- `basement-rites`: "Corbitt House basement" -- "the basement of the Corbitt House", "the Corbitt House cellar", "the sealed cellar";
- `neighborhood-gossip`: "Corbitt House neighborhood" -- "the neighborhood around the Corbitt House", "the street outside the Corbitt House", "the neighbors of the Corbitt House";
- `corbitt-confrontation`: "Corbitt's Hiding Place" -- "Corbitt's lair".

**No zh-Hans labels were authored, on purpose.** The existing labelled scenes carry English `destination_identity` only; the
starter README says the graph is English-only with no table-language cache; and Agents.md §multilingual forbids a
`{"zh-Hans": …}` table in code or data. The play-language label is the table's own (`world.scene_labels`, which the Keeper's
move writes in the play language and `sceneLabel` already prefers). The replays show Jev matching 罗克斯伯里疗养院 to "Roxbury
Sanitarium" at 1.00, so no translated row was needed. If the owner wants a pre-play play-language label, that is a
presentation-lane projection (§23), a separate decision.

**Pre-registered** (before any code change; the session scratchpad's `sl25/preregistration.md`): t6 and t11 clear on the right
row in ≥ 4/5 and the compile selects the move; t16 (and t9) clear, the compile row carries `guarded` with the book's clue, words
and cue, and the Keeper's next note carries the same entry; a miss is a wrong/none/below-gate row in ≥ 2/5, or a cleared row
without the guard.

**Replays** (`--llm replay`, recorded Keeper and admission, live Jev, `--seed 1`, one process at a time on the Mac). *before* =
base `1dccf4578` on `longgate25-tN`; *code only* = SL-25 code on the unchanged module (`longgate25-tN`); *after* = SL-25 code on
`longgate25-labels-tN` (module re-registered from the SL-25 starter by `module.register`), final run on the committed fixtures.

| turn | input | before | code only | after (5 runs) |
| --- | --- | --- | --- | --- |
| 6 | 我去罗克斯伯里疗养院，请求探视维托里奥·马卡里奥… | `none` 0.99, 3/3 | `previous-tenants` 0.92–0.93, move selected 3/3 | `previous-tenants` 1.00, `apply:move:previous-tenants` selected and executed by the clerk 5/5 |
| 11 | 我上二楼，先站在楼梯口听一会儿，再去主卧。 | `none` 0.52–0.54 (not cleared) 3/3 | `upper-floor-bedroom` 0.62–0.64, selected 3/3 | `upper-floor-bedroom` 0.88–0.89, selected 5/5 |
| 16 | 我打着手电，沿楼梯下地下室。 | `basement-rites` 0.96–0.97, `decided_none`, no guard 3/3 | -- | `basement-rites` 0.99, `guarded` 5/5: `clue_discovered: corbitt-diaries`, "Three bound diaries of W. Corbitt describe…", found at `corbitt-house-ground` (科比特宅) by "Pry open the nailed-shut cupboard in the storage room…"; the note in every Keeper request, once |
| 9 | 我去科比特宅，先绕着房子外面走一圈… | `corbitt-house-ground` 0.87–0.94, no guard 3/3 | -- | `corbitt-house-ground` 0.97–0.99, `guarded` 5/5: `knott-keys`, "Knott hands over the house keys…", found at Knott's Office by "Accept the commission explicitly and take the key…"; the note once |

All pre-registered outcomes met; no miss. The code alone (people and where-words) already clears t6 and just clears t11; the
authored names take t11 from 0.63 to 0.89.

**Tests.** `tests/extension/single-loop-destination-rows.test.mjs` (rows and the guard kept off Jev; `guarded` on a cleared
held-back row, the obligation guard, none below the gate / on `none` / on an issued move; on the emitted kernel over the haunting,
heading for the house before the keys: the compile row and one `coc-clerk` note over two model steps carry the keys guard in the
book's words). `tests/kernel/test_jev_apply.py` (+3: the sanatorium's row from the graph on disk, no placeholder summary; an
unmet unlock's clue, words, scene and cues, gone once found; people by the table's name, things without the place's media).
`tests/kernel/test_starters.py`: the RD-04 graph-diff pin now also expects the six `destination_identity` additions.
`tests/extension/narrated-clue-accounting.test.mjs`: a stale fixture, not a defect -- its "place the book never wrote" was the
Roxbury sanitarium, which the kernel now rightly refuses to adapt twice (`same_place`, the exact duplicate campaign
`game-1c0faba5` minted on 2026-09-16); it moves to a parish charity office.

**Mutations** (17, each one edit, rebuilt when kernel/content, run against the two SL-25 files): all killed.
M1 rows drop the kernel words; M2 rows carry no guard; M3 guard leaks into Jev's words; M4 obligation guard dropped; M5 guarded
reported although the move is issued; M6 interpretCompile drops guarded; M7 policy step row drops it; M8 engine compile row drops
it; M9 engine never tells the Keeper; M10 the Keeper told on every step; M11 kernel move row without destination; M12 unmet unlock
names nothing; M13 cues dropped; M14 placeholder summary repeated; M15 people by the book's name (first survived, killed after the
person-label test was added); M16 the sanatorium unnamed; M17 media assets as things (first survived, killed after the things test).

**Suites (leehow-pc).** test:ext 2902/2902 (`f545016a8`); loop 137/137 (`f545016a8`); pytest 1719 passed, 2 skipped
(`afcd4eb85`). The first ext run failed only `narrated-clue-accounting` (above); the first pytest only the RD-04 pin (above).
At the ticket commit `044d8514a`: loop 137/137; test:ext 2901/2902 with the box at load 57 (wall 355 s against 121 s), the one
failure `jev-source-domain.test.mjs` "root consultation completes through a child…" (6.0 s), which no SL-25 file touches and which
passes 5/5 on the Mac on the same tree -- a load flake, not a regression.

**For the integrator.** SL-26 also inserts §135.30.3 before §135.31 and edits `route-compile.ts` (`Fired`, a predicate,
`interpretCompile`'s settled map); SL-25 touches the `FeatureRow`/`CompileOutcome` interfaces and the end of `interpretCompile`.
Any other branch that edits the haunting graph must re-stamp the guidance bundles again (`guidanceFingerprint`). Existing
campaigns see the names only after the module is re-registered (a compile snapshot).
