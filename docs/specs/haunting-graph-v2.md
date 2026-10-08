# The Haunting graph v2: what a newcomer sees, from the book (2026-10-08)

Status:
- Done on `claude/haunting-graph-20261008`.
- Corrected after the first full box run (§6).
- Owner decision G landed as contract §13.1.1 (§4).

Owner, 2026-10-08:
- 「这次测试整个团都很空洞，没有任何环境描写和角色神态描写」
- 「这个模组属于我们产品的门面……还是要建好一点，还是内置的」
- 「鬼屋那个图谱就你自己创建就行」

## 1. What was missing, and why the Keeper never saw a place

The built-in Haunting is the one starter listed to players. Its graph was authored in the repo (a7b17bf21) and later migrated, not produced by the reader. For each gap below, the kernel already had a seat that the graph never filled:

| Gap in the graph | Seat the kernel already reads | Effect at the table |
| --- | --- | --- |
| Every scene's `summary` was its own name (`"scene basement rites"`). | `where.summary` every turn; `look`; move rows' `destination.summary`. | The Keeper read no account of the place at all. `first-sight/index.ts` names this exact case. |
| No scene had `properties.description`. | §168.5 `first_sight.place` (own budget). | First sight fell back to that name, which counts as nothing, so arrival was never owed. |
| No person had `properties.biography`, and all were `keeper-only`. | §168.5 `first_sight.people` (only `player-safe` persons); §194.4 epithets. | No person was ever owed a first sight. The epithet lane had no looks to read (GG-10). |
| The house's rooms were nowhere. | The floor scene's `keeper_notes` (every turn's `where`, and `look`). | The Keeper knew the house only through four affordance cues. |
| The basement knife was `environmental`, with no check. | `clueProfile`: `properties.skill` and `difficulty` (a check difficulty). | Its gate read "check unspecified" where the book asks for Spot Hidden on an obscure clue. The other checks the book names already reach their gates from the conclusion records' clue table, which `clueProfile` merges. |
| The Chapel had one road in, from Knott's office. | `route-to` and `scene_edges`. | Dooley points it out, and Handouts 7 and 8 name it, but none of those places led there. Table 3, turn 11: "not reachable". |

## 2. What changed (all from pdf 446–462, printed 435–451, in our own words)

| Kind | Count | Notes |
| --- | --- | --- |
| Scene `summary` | 12 | About 100 characters each: what the place is, for every turn. Kept short because `where` has a 4 KiB budget. |
| Scene `properties.description` | 12 | What a newcomer sees and hears on arrival.<br>Hidden things are left out (the morgue below, the cellar under the chapel).<br>Where the book leaves a place to the Keeper (the library, the sanitarium), the description is short, and `allowed_improvisation` keeps the Keeper's latitude. |
| `keeper_notes` | 4 | The Globe's morgue as the book shows it once Arty yields (p.437).<br>One note per floor of the house, listing its rooms and what is in them (p.442–446). |
| Person `properties.biography` | 9 | Looks and manner only, with no name and no secret.<br>The book gives manner for most people (Arty's pomposity, Dooley's patter, Gabriela's distress, Vittorio and the bible) and gives Corbitt's body in full (p.446).<br>It gives no looks for Knott, Ruth or the clerks, so none are invented. |
| Person `visibility` → `player-safe` | 8 | Everyone the investigators meet openly. Corbitt stays `keeper-only` and Michael Thomas stays `revealable`. |
| Clue check | 1 | The basement knife: `skill_check`, Spot Hidden, `regular` (p.444). |
| Roads to the Chapel | 3 | From the block (Dooley, p.439), the Hall of Records (Handout 7) and the police (Handout 8).<br>Each unlocks on `clue-chapel-ruins-location`.<br>Each copies the travel of the road back, so both directions agree (§138.9). |

No node was added.

The graph is still English-only.

`character-guidance/{en,zh-Hans}.json` were re-keyed (`graph_sha256`, `fingerprint`) the way `scripts/fill-starter-travel.ts` does it: the old fingerprint was first reproduced on the old graph. Their guidance text is unchanged.

## 3. Budgets

Every-turn text lives in the compact `where` (4096 bytes).
- Summaries are about 100 characters.
- Room notes are one line per floor.
- Arrival descriptions sit in `first_sight`, which has its own budget.

On a four-scene trail the house keeps its 7 exits with its room note; the v2 test asserts this.

## 4. The where cut order (decision G, contract §13.1.1)

`fitBudget` popped the largest leaf list, which in a busy scene is the exits, while the trail (`where.back`) grows with every move. On a long walk the Chapel lost an exit before this change.

Owner: 「G 按你建议的改，先删来路再删出口」.

`fitWhere` (`kernel-ts/read/assemble.ts`) now cuts in this order:
1. The trail, down to the one step back.
2. `places`, from the end.
3. Then the general cut.

On the 12-scene walk the house and the Chapel keep every exit.

## 5. Tests

- `tests/extension/haunting-graph-v2.test.mjs` runs on a real campaign.
  - Knott's and the Globe's first sight carry the book's words. Mutation: Arty back to `keeper-only`.
  - The floors' room notes reach `where`, and the house keeps its 7 exits.
  - The graph keeps its one location.
  - On the long walk the trail is cut before any exit. Mutation: `fitWhere` back to `fitBudget` gives 7 → 6 exits, and 3 on the walk.
  - The knife's Spot Hidden reaches its gate. Mutation: drop the skill.
  - The Chapel roads move.
- `tests/kernel/test_starters.py`: the whole-graph ledger gains `HG_CHANGES`, 57 leaf changes, equal to the computed diff. A road added whole is not counted as a filled road.
- `tests/extension/ts-kernel-read.test.mjs`: the frozen captures are read against the freeze-time graph.
  - The new roads are dropped (`POST_FREEZE_LINKS`).
  - The rewritten fields are put back (`fixtures/haunting-freeze-time-words.json`).
  - No capture was edited.
- Updated to the new data:
  - `test_capsule.py`: Knott is `player-safe`.
  - `test_jev_apply.py`: the sanitarium's move row carries its real summary.
  - `test_npc_situation.py`: at an artificial 1 KiB budget, the cut order is asserted as a law (surroundings first, constraints last), not as an exact list.

## 6. What the first full box run found (6886cc303), and the corrections (66952186f)

Local single-file runs were green; the box's full run was not. Each regression came from a consumer the change had not traced.

- **Rooms as `location` nodes.**
  - `ModuleGraph.projectSourcePlaces` promotes every source location to a playable scene. The 3 floors and 14 rooms became 17 scenes with no exits and none of their floor's clues (the flat-locus defect).
  - The basement floor read as a second "Corbitt House basement" to the told-position lane (`told-position.test.mjs`).
  - The first-turn module roster grew past its 2 KiB (`test_capsule_nine`, `test_capsule_module`).
  - Fixed: the rooms became notes. Rooms as nodes wait for nested places (the S8 locus slice).
- **Clue checks.**
  - The checks I thought missing were already supplied by the conclusion records' clue table through `clueProfile`.
  - My node-level `difficulty` held prose where the field is a check difficulty, so `mechanics-shape`'s `shape_duplicate` stopped firing.
  - Fixed: reverted. Only the knife gains its check.
- **Known baseline reds**, unchanged: held-answers 4, timeline 4, module-command 1, `test_npc_act_options` 1.
- **`prescreen-material-families`**, 2 fails.
  - The prescreen's round-1 Jev packing sits at its `stateQuestionLimit` edge, with bytes counted as tokens. Round 1 falls from 49 offered to 25, and the interview ledger object drops out.
  - The integration branch `36b437bd3` is red there with the base graph as well. On this branch alone, the v2 summaries add about 75 bytes and tip it over.
  - Not fixed here: the fix belongs in the prescreen.
