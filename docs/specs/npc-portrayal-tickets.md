# NPC portrayal: tickets

Spec: `docs/specs/npc-portrayal.md`. Contract: `docs/kernel-rpc.md` §260 (draft).

## 01: The Keeper can give a person a beat

**What to build:** `beat` on every interaction branch; hydrated, carried to the author input and the turn record; a
silent response with a beat is nonverbal behavior. Author instruction sentences of §260.6 edited in place.

**Blocked by:** None (can start immediately).

**Status:** draft

- [ ] The packet accepts a beat on silent, greet/refuse/acknowledge and answer-type responses; over 120 characters is refused.
- [ ] The author input and the turn record carry the beat; a response without one is unchanged.
- [ ] The two instruction sentences are replaced, not appended to.

## 02: The host marks attention and projects bearing

**What to build:** the pure tier function (§260.2) and the bearing projection (§260.3) on `presence.people`, reading
today's affinity and §258 P1 fields when present; telemetry of §260.8.

**Blocked by:** 01.

**Status:** draft

- [ ] Addressed speaker, changed disposition, targeted check and first meeting each make `focus`; a third qualifier is `engaged`.
- [ ] A present person with no response and no beat is `background`; first meeting reads §255 looks and §168.5 shown marks.
- [ ] Hidden fear never reaches `felt`; before P1 `felt` is absent and affinity maps by the closed table.

## 03: The bearing grant and the people fact

**What to build:** `bearing` in `AUTHOR_GRANT_LIMITS`, `people` in the settled facts, `npc.bearing.v1` capability;
package validation accepts them.

**Blocked by:** None.

**Status:** draft

- [ ] A section granting `bearing` gets the §260.4 text once after the frame; an unknown grant is refused at install.
- [ ] `people` holds with a seen person present after settlement and not on a turn alone.

## 04: The NPC Portrayal package

**What to build:** `mods/npc-portrayal/` 1.0.0 with the Keeper "Beats" section and the author "People in motion"
section (spec appendices, revised after review), English, original examples.

**Blocked by:** 01, 02, 03.

**Status:** draft

- [ ] Installs default-enabled; author text ≤ 6 KB, Keeper text ≤ 600 bytes; system-language guard passes.
- [ ] A turn with people sends the section and grant; a turn alone does not; narration-craft's people slot still arrives.

## 05: Live A/B on the owner's Mac

**What to build:** same retained seed, package off vs on, MiniMax 3.1 every lane, real driver, one natural input per
turn; blind read of focus picture, background brevity, invented state changes and leaked concealment.

**Blocked by:** 04.

**Status:** draft

- [ ] Report wins, ties and losses as found; retain all evidence.

## 06 (later): Habits are kept

**What to build:** §255 ledger `manner` for people (a recurring habit the prose showed), passed to the author as
`presence.people[].manner`.

**Blocked by:** 05 showing habits drift.

**Status:** draft
