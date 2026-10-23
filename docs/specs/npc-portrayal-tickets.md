# NPC portrayal: tickets

Spec: `docs/specs/npc-portrayal.md` (draft r2). Contract: `docs/kernel-rpc.md` §260 (draft r2).

## 01: Two layers of fact and the beat

**What to build:** `beat` on every interaction branch, hydrated into the author input and turn record; the §260.7
instruction edits and the §260.1 invariant stated once in the author instruction.

**Blocked by:** None (can start immediately).

**Status:** draft

- [ ] The packet accepts a beat on every branch; over 120 characters is refused; without a beat nothing changes.
- [ ] The two instruction sentences are replaced in place; the invariant and the nonverbal-semantics rule appear once.

## 02: Attention, introduction and public presentation

**What to build:** the pure tier function (§260.3) and `bearing` projection (§260.5) on `presence.people`, telemetry
(§260.8).

**Blocked by:** 01.

**Status:** draft

- [ ] Addressed, targeted, an NPC answering another NPC in view, and a public outcome each make `focus`; responses otherwise `engaged`; the rest `background`; no cap.
- [ ] Changing only hidden trust/fear/pressure/control/private disposition leaves the author input byte-identical.
- [ ] `needs_introduction` follows §168.5 shown marks and ignores this turn's looks write-back.
- [ ] `toward` is directed per investigator; affinity maps by the closed table before §258 P1; no numbers reach the author.

## 03: The bearing grant and the people fact

**What to build:** `bearing` in `AUTHOR_GRANT_LIMITS` (§260.4), `people` in settled facts, capability `npc.bearing.v1`.

**Blocked by:** None.

**Status:** draft

- [ ] A section granting `bearing` gets the limits text once after the frame; unknown grants are refused at install.
- [ ] `people` holds with someone in presence after settlement, not on a turn alone.

## 04: The NPC Portrayal package (default off)

**What to build:** `mods/npc-portrayal/` 1.0.0 with spec Appendices A and B as revised by review.

**Blocked by:** 01, 02, 03.

**Status:** draft

- [ ] Installs disabled by default; author text well under 4 KB, Keeper text ≤ 600 bytes; system-language guard passes.
- [ ] The assembled author prompt for a people turn carries narration-craft's people slot and this bearing slot without two competing first-meeting rules.

## 05: Frozen-input A/B/C

**What to build:** twelve settled inputs (spec Testing 2), three MiniMax generations each, conditions A/B/C, blind read
and hard-violation counts.

**Blocked by:** 04.

**Status:** draft

- [ ] Wins, losses, ties and violations reported as found; all outputs and parameters retained.

## 06: Continuous live play and the default

**What to build:** real-driver play on the owner's Mac, retained seed, one natural input per turn; the package turns
default-on (version bump) only if C beats B without hard violations.

**Blocked by:** 05.

**Status:** draft
