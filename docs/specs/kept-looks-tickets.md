# Kept looks: tickets

Spec: `docs/specs/kept-looks.md`. Contract: `docs/kernel-rpc.md` §255.

## 01: The kernel keeps a look and hands it back

**What to build:** `table.looks.job` and `table.looks` on the first-sight ledger; the next capsule's present people and
current place carry their kept look and pronoun; forks carry them.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The job lists the place and present seen people still missing a look or pronoun, with the turn's delivered prose.
- [ ] Spans not found in that turn's delivered text are dropped; bounds and the pronoun enum are enforced.
- [ ] First write wins per field.
- [ ] The next capsule's `present` rows and place row carry `look` / `pronoun`; untold people show no name.
- [ ] A fork at an earlier commit carries the looks of that line.

## 02: The background check records looks after delivery

**What to build:** the first-sight lane asks the look questions after every delivery that has targets, on the legacy
and native paths, anchors spans in the prose and lands them through `table.looks`; never awaited.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Legacy completion: shape check, exact-span anchoring, private content excluded by instruction.
- [ ] Native typed choices over prose units and a pronoun choice per person.
- [ ] Failure records nothing; telemetry `event: "looks"`.

## 03: The sole author reuses kept looks

**What to build:** `decision_context.people[]` and `scene` carry kept `look` / `pronoun`; the author instruction keeps
them.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] The author input carries them for present people and the place; absent when nothing is kept.
- [ ] The instruction sentence is present on the decision author path.

## 04: Live comparison

**What to build:** same seed before and after on the Mac (MiniMax, never Opus): a person met twice and a place
revisited; report look and pronoun drift.

**Blocked by:** 02, 03.

**Status:** done (2026-10-22, MiniMax 3.1 medium, the-haunting zh)

- looks-a2: excerpts carried a nod and a remark as Knott's look -> one verdict per excerpt.
- looks-a3: the office's kept look held the cash on the desk; after the investigator took it, the return visit put it back -> a look is lasting appearance only; the author defers to current outcomes. The newspaper doorman kept his look (sleeve paste) on his second appearance; pronouns held.
- looks-a4: office revisited after taking the cash: walnut desk, streetcar on wet stone kept, no cash on the desk; Knott stays 他; the library's look kept as fixed features only.
