# The Haunting graph v2: what a newcomer sees, from the book (2026-10-08)

Status: done on `claude/haunting-graph-20261008`. §4's held part was released by owner decision G the same evening (contract §13.1.1).

Owner, 2026-10-08:
- 「这次测试整个团都很空洞，没有任何环境描写和角色神态描写」
- 「这个模组属于我们产品的门面……还是要建好一点，还是内置的」
- 「鬼屋那个图谱就你自己创建就行」

## 1. What was missing, and why the Keeper never saw a room

The built-in Haunting is the one starter listed to players. Its graph was authored in the repo (a7b17bf21) and later migrated, not produced by the reader. Its people and places were thin, and the kernel had a seat for each gap that the graph never filled:

| Gap in the graph | Seat the kernel already reads | Effect at the table |
| --- | --- | --- |
| Every scene's `summary` was its own name (`"scene basement rites"`). | `where.summary` every turn; `look`. | The Keeper read no account of the place at all. `first-sight/index.ts` names this exact case. |
| No scene had `properties.description`. | §168.5 `first_sight.place` (own budget). | First sight fell back to that name, which counts as nothing, so arrival was never owed. |
| No person had `properties.biography`, and all were `keeper-only`. | §168.5 `first_sight.people` (only `player-safe` persons); §194.4 epithets. | No person was ever owed a first sight. The epithet lane had no looks to read (GG-10). |
| The house had one `location` node and no rooms. | `where.places` (`occurs-at` → `located-in`), compact 8 × 90 chars; full on `look`. | The Keeper knew the house only through four affordance cues. |
| 6 clues were `skill_check` with no skill; the basement knife was `environmental`. | `clueGate`: `properties.skill` and `difficulty`. | Gates read "check required (skill unspecified)" or "check unspecified" where the book names Library Use or Spot Hidden. Table 3 skipped the book's Spot Hidden. |
| The Chapel had one road in, from Knott's office. | `route-to` and `scene_edges`. | Dooley points it out, and Handouts 7 and 8 name it, but none of those places led there. Table 3, turn 11: "not reachable". |

## 2. What changed (all from pdf 446–462, printed 435–451, in our own words)

| Kind | Count | Notes |
| --- | --- | --- |
| Scene `summary` | 12 | About 100 characters each: what the place is, for every turn. Kept short because §4's budget cuts lists, not strings. |
| Scene `properties.description` | 12 | What a newcomer sees and hears on arrival. Hidden things are left out (the morgue below, the cellar under the chapel). Where the book leaves a place to the Keeper (the library, the sanitarium), the description is short, and `allowed_improvisation` keeps the Keeper's latitude. |
| `keeper_notes` | 1 | The Globe's morgue as the book shows it once Arty yields (p.437). |
| Person `properties.biography` | 9 | Looks and manner only, no name and no secret. The book gives manner for most people (Arty's pomposity, Dooley's patter, Gabriela's distress, Vittorio and the bible) and gives Corbitt's body in full (p.446). It gives no looks for Knott, Ruth or the clerks, so none are invented. |
| Person `visibility` → `player-safe` | 8 | Everyone the investigators meet openly. Corbitt stays `keeper-only` and Michael Thomas stays `revealable`. |
| Clue checks | 12 skill + difficulty; 3 `delivery_kind` | Library Use (Handouts 3–7, p.437–438); Law, Credit Rating 75+, Persuade, Charm or Fast Talk (Handout 8, p.438); Spot Hidden (chapel cabinet, p.440; basement knife, an obscure clue, p.444); APP or Credit Rating for Dooley's reaction (p.439). Flesh Ward is seen in the fight, not rolled for (p.449). |
| House `location` nodes | 3 floors + 14 rooms | One node per room the book lists (p.442–446), `located-in` its floor, and the floors `located-in` the existing `location-corbitt-house`. The crawl space and the hiding place are `keeper-only`. |
| `occurs-at` | 4 | Ground floor, upper floor, basement, confrontation (the ground floor after §13.1.1, see §4). |
| Roads to the Chapel | 3 | From the block (Dooley, p.439), the Hall of Records (Handout 7) and the police (Handout 8). Each unlocks on `clue-chapel-ruins-location`. Each copies the travel of the road back, so both directions agree (§138.9). |

The graph is still English-only. `character-guidance/{en,zh-Hans}.json` were re-keyed (`graph_sha256`, `fingerprint`) the way `scripts/fill-starter-travel.ts` does it: the old fingerprint was first reproduced on the old graph. Their guidance text is unchanged.

## 3. Measured on the real kernel

Compact `where` size per scene, budget 4096. `truncated` names a cut. A route of 4 prior scenes, then the house and down:

| scene | before | after | exits before → after |
| --- | --- | --- | --- |
| Knott's office | 3325 | 3420 | 7 → 7 |
| Central Library | 3316 | 3541 | 6 → 6 |
| Globe | 2511 | 2814 | 6 → 6 |
| the block | 2201 | 2686 | 5 → 6 (+Chapel) |
| house, ground floor | 3295 | 3369 before its rooms were attached | 7 → 7; after §13.1.1 with its rooms attached: 7 exits, places 0 → 6 (asserted by the v2 test) |
| upper floor | 2782 (cut) | 3320 (cut) | 2 → 2, places 0 → 4 |
| basement | 2546 | 3158 | 2 → 2, places 0 → 4 |

The 12-scene walk (`test_capsule_budgets.WALK`) cuts the Chapel and the upper floor both before and after; neither loses an exit.

## 4. The ground floor's rooms and the where cut order (decision G)

At first the six ground-floor rooms were in the graph but not attached to the scene:
- Attached, the compact `where` passed 4096 once the trail (`where.back`) held about four scenes.
- `fitBudget` then popped from the largest leaf list, which was the exits, not the unbounded trail. The mutation test measured 7 exits → 6, and 3 on the long walk.
- The same order already cut an exit from the Chapel on a long walk, before this change.

Owner, same evening: 「G 按你建议的改，先删来路再删出口」. Contract §13.1.1 and `fitWhere` (`kernel-ts/read/assemble.ts`):
- Over budget, the compact `where` cuts the trail first, down to the one step back.
- Then it cuts the places, from the end.
- Only then does the general cut run.

The ground floor now `occurs-at` its floor. After a four-scene trail the house keeps all 7 exits and all 6 rooms; on the 12-scene walk it keeps all 7 exits, and so does the Chapel.

## 5. Tests

- `tests/extension/haunting-graph-v2.test.mjs`, on a real campaign. Each check below was killed by a mutation (copy-restored):
  - Knott's and the Globe's first sight carry the book's words. Mutation: Arty back to `keeper-only`.
  - Each floor's rooms are `where.places` and the house keeps all 7 exits; on the long walk the trail is cut before any exit. Mutation: `fitWhere` back to `fitBudget` (7 → 6, and 3 on the walk).
  - Library Use and Spot Hidden reach the gates. Mutation: drop the knife's skill.
  - The Chapel roads move.
  - Every new place's anchor is on its page.
- `tests/kernel/test_starters.py`: the whole-graph ledger gains `HG_CHANGES` (135 leaf changes, equal to the computed diff). A road added whole is no longer counted as a filled road.
- `tests/extension/ts-kernel-read.test.mjs`: the frozen captures are read against the freeze-time graph.
  - The new nodes and roads are dropped (`POST_FREEZE_NODES`, `POST_FREEZE_LINKS`).
  - The rewritten fields are put back (`fixtures/haunting-freeze-time-words.json`).
  - No capture was edited.
