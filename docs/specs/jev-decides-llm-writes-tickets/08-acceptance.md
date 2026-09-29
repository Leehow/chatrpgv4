Status: ready-for-human (acceptance run 2026-09-28/29; results below)
Spec: docs/specs/jev-decides-llm-writes.md Testing Decisions

# 08 — Real-table acceptance (lead, main session as player)

(a) Blood PDF background: before/after author/review/reuse/salvage/need dispositions, same model/settings. (b) Default-engine play table: clue steps executed, mode recorded with source. (c) Cold setup on the driven engine against the pre-registered D-E bar. Canonical `tests/play/driver.py`, one natural sentence per turn. Failures recorded as failures.

## Comments

### 2026-09-29 — live acceptance (lead as the only player; canonical `tests/play/driver.py`; Keeper grok-build/grok-4.5 low; Jev key from the App vault; every table `--expect-engine hybrid-v1`)

**(c) Cold setup on the driven engine**
- `jev-accept-blood-01` refused to start: the Jev key was not in the environment, the engine resolved legacy, and the run is `invalid-for-acceptance`. Retained.
- `jev-accept-blood-02` (integration build): turn 2 `fallback: no_candidates`. While the package brief held, `legalMoves` offered nothing, so Jev was never asked and the turn adjudicated with the full tool (6 setup calls, 33.9 s). Fixed as `draft_now` (§150.6 decision 10). Failed; retained.
- `jev-accept-blood-03` (fixes build): `draft_now` 0.87, Journalist 0.99, `occupation_stated` copied, 2 model requests, 29.6 s, 0 refusals. Defects:
  - The interest fit raised Drive Auto 20→55 against the player's 「驾驶保留基础值」, and the reply claimed it was untouched.
  - The interest gate (effective 0.667) left 35 points unspent.
  - The named-skill rows did not clear.
  - Fixed as §150.6 decision 11. Failed; retained.
- `jev-accept-blood-04` (fixes build `5a11962bc`), turn 2:
  - 27.2 s, 2 model requests (bind + compose), 0 refusals.
  - occupation Journalist (jev), `occupation_stated` 自由摄影记者 (stated), aptitude INT (jev), occupation skills Photography + Spot Hidden (jev, 0.92/0.79).
  - Interest Fine Art / Writing / Appraise (jev), 160/160 spent; Drive Auto held at 20.
  - The reply matches the card. Library Use's row reached 0.47, under the gate; it is on the card through the occupation.
  - **The pre-registered D-E bar is met on this table:** ≤ 100 s (27.2), ≤ 3 model requests (2), zero refusals of the two legacy classes, and every closed field carries its path.
- Legacy references for the same turn: 41.5 s with 6 setup calls (`jpdf-setup-preflight-01`); 200.9 s with 13 calls (Blood05).

**(b) Default-engine play, clue steps** (`jev-accept-haunt-01`, pregen, the-haunting)
- Mode recorded `steps_mode: on, steps_mode_source: data` every turn.
- Turn 2: a clerk-routed Persuade failed at the Globe. `globe-fire-cutoff` scored 0.18 and did not execute. The same scene scored 0.42–0.44 and executed on gates #18–#25 before §150.1.1.
- Turn 3: Library Use failed. All four year clues scored about 0.1; none executed; the prose says nothing matched.
- Turn 4: the librarian found the 1866 obituary and lawsuit. `basement-burial-lawsuit` (0.56) and `second-lawsuit-outcome-unrecorded` (0.52) executed, and both clue markers are in the prose.

**(a) PDF background on the integration build** (`jev-accept-blood-02` play, 8 turns, 23 min daemon life)

| Job | Measured |
|---|---|
| read-4, pages 19–20 | Round 1 author 170 s, review 84 s wall. Refused `/claims/6,11`. **Targeted repair author 51 s** (Blood05 on the same pages: full re-author 156 s). Re-review reused 2 of 6 units. |
| read-9, pages 27–28 | Round 1 author 334 s. Refused `/claims/4`. **Targeted repair 48 s**; re-review reused 5 of 7 units. |
| read-5, need `russell-williams` | **`carried` onto pages 39–40 in 3 s**, no author (Blood05's comparable need read: author 79+46 s plus review). |
| read-2, pages 15–16 | Salvage refused correctly: the interrupted draft had no coverage yet. |

- Claim check (shadow): read-3 had 17 eligible records, Jev cleared 10, the vision review supported all 10, 0 negatives.
- No `answered` or `unlocated` disposition occurred in this window; those remain unmeasured live.
- Job accounting now counts the claim-support spend (`75e0010ce`).
- Play turns took 22–70 s. They are not a speed claim for this work, which moved background and setup cost.

**Not accepted / open**
- `npc_reaction`/`time_cost` stay shadow (ticket 05 report).
- The narrator-only setting stays off (D6 3 not run).
- The claim check stays shadow (bar failed).
- `answered`/`unlocated` need dispositions and a second PDF (Masks) were not exercised live.
