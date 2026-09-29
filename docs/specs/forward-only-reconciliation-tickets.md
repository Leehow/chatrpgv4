# Forward-only reconciliation — tickets

Parent: [forward-only-reconciliation.md](forward-only-reconciliation.md). Owner ruling 2026-09-29: the delivered fiction is canon, the ledger catches up forward, the Keeper does not confess, and only the player's explicit dispute makes an exception.

Order: FR-01 → FR-02 → FR-03 → FR-04; FR-05 closes. FR-04's wording can land alongside FR-01.

---

## FR-01: the review that detects a divergence names what the ledger owes

Status: ready-for-human (implemented on `claude/forward-only-reconciliation-20260929`; contract §158.2–§158.3; live review replay on the retained turn-26 record pending, see Comments)

**What to build.** Turn 26's post continuity review found the unlanded arrival, but in free text that became a `continuity_finding` whose fix says "avoid the same problem". The review should return what the delivered text established and no receipt carries as structured **owed effects**, in `apply` shape: a move (to a graph handle, or a new place with `establish`), elapsed time, an object handed over, an NPC present or gone, and so on. The kernel records them on the turn record and in `world.owed`, with the delivered quote that established each. §130.4 gains an `owed_state` row kind whose kernel `fix` points forward: land it with an ordinary `apply` as something that already happened, and do not narrate it again or correct it. `unsettled_object` joins it as one owed kind rather than staying a special case.

**Acceptance.**
- [ ] Turn 26's record (retained) replayed through the review yields an owed move to the Poe Street cemetery scene or place and owed travel time, each with its quote.
- [ ] No code classifies prose. Owed effects come only from the review's structured answer, and the kernel validates their shape and graph references.
- [ ] A delivered turn with nothing owed writes nothing; a finding that is not state (tone, style) stays a `continuity_finding`.
- [ ] `world.owed` survives restart, and a worldline fork carries it with the line.

## FR-02: the next turn starts from the told position

Status: ready-for-human (implemented; contract §158.4; see Comments)

**What to build.** The capsule carries an `owed` section (what the player was told and the ledger lacks). The single-loop candidate builder (§135.2) reads it first. The owed effects are the run's first candidates, and any move candidate is bound from the told position, not the ledger's. A clerk step never lands a move that contradicts an open owed position; turn 27's `apply:move:arkham-church-cemetery` would not have been bound.

**Acceptance.**
- [ ] With turn 26's owed move open, turn 27's player line 「我下车走进栏内，蹲在敞开的墓穴旁…」 binds against the Poe Street cemetery, and the first landed receipt is the owed move.
- [ ] A test fails if the builder reads only the ledger again: remove the owed read, and the clerk binds the wrong cemetery.
- [ ] The budget's `deferred_last_turn` note keeps working. Owed state is separate from it and does not depend on the session's memory.

## FR-03: owed effects land as consequences, under a `told` admission basis

Status: ready-for-human (implemented; contract §158.5; see Comments)

**What to build.** An owed effect lands through an ordinary `apply` (Keeper or clerk) as a consequence of what was told. Admission judges it on a basis `told`, like `basis.compile` / `basis.consequence`. The question is whether the delivered text established it, answered from the recorded quote and the delivered turn, not whether the player chose it. A landed owed effect clears its row. One that cannot land (unknown place, invalid target) stays owed, is retried by `establish`, and never flips the fiction to the ledger's version.

**Acceptance.**
- [ ] The owed arrival lands with receipts and clears `world.owed`; §39.2's first-arrival map placement fires on it like on any real move.
- [ ] An owed effect whose quote is not in the delivered text is refused (the basis cannot be forged by the Keeper's own words).
- [ ] Admission rows name `basis: "told"` and the quote; the telemetry tells owed landings apart from player-chosen ones.

## FR-04: the Keeper never corrects or confesses; the player's dispute is the exception

Status: ready-for-human (wording landed; contract §158.3 fixes and §158.6; the LLM-judged probes are pending, see Comments)

**What to build.** The Keeper's rules (prompt and contract) and every kernel-authored forward fix say the same thing: the delivered fiction is the past; when the ledger disagrees, bring the ledger forward and continue in the fiction; never retract, rewrite, apologise, or tell the player the table erred or a service failed. When the player explicitly disputes what happened and asks for it otherwise, follow the player. §130.4's `continuity_finding` fix ("avoid the same problem") is replaced.

**Acceptance.**
- [ ] A probe with the turn-26/27 shape: the next delivery continues at the told cemetery, and no sentence corrects, retracts or apologises (checked by an LLM judge, not by a word list).
- [ ] A probe with the turn-28 shape (the player disputes): the Keeper follows the player's request without an out-of-fiction apology.
- [ ] A probe with the turn-23 shape (admission unavailable): the delivery does not tell the player the table could not settle; it carries the fiction and waits.

## FR-05: acceptance on the real product path

Status: needs-triage

**What to build.** First seeded probes, then a live table on the installed App.

**Acceptance.**
- [ ] A seeded probe per FR-02/03/04 case passes on the emitted kernel, on the test box.
- [ ] A live table (main session as the player, installed App) plays through a forced divergence; a provider outage or a failed write on an arrival turn is the natural case. The ledger catches up on the next turn, and the player never sees a correction.
- [ ] The retained campaign evidence (turn records, `world.owed`, admission rows) is cited in this file under `## Comments`.

## Comments

### 2026-09-29 — implementation (branch `claude/forward-only-reconciliation-20260929`, contract §158)

**FR-01.** Capability `audit.owed.v1`, `narration-audit` 1.2.32. The report gains `owed` (move / time / npc, selecting the told draft sentence). A `new_locus` with basis `none` needs an owed move. `table.warn` projects owed entries and `missing` objects into rows on the delivered record and in the campaign's `owed.json`, and emits an `owed_state` warning row with a forward fix. `continuity_finding` no longer says "avoid the same problem".

- **Deviation from the ticket's wording: `owed.json`, not `world.owed`.** The review writes after the turn it read has closed, usually under the next open turn. A `world.json` write there changes the world revision that open turn's Jev read set is bound to (§158.3).
- **Deviation: "owed travel time" is the move's own.** §156 (same day) made a move count its journey. An owed move carries `travel_minutes` from a travel band's default (§138.9), and an owed `time` is only time beyond the journey.
- **Evidence.** The turn-26 retained job is the fixture: `tests/extension/fixtures/forward-only/t26-review/`, with `effective.json` trimmed to its scene and npc nodes so the job's own aliases hold. With `owed:[move to scene:20]` it materializes to `to: 勘查波街公墓` and the claim sentence. With `owed: []` it is refused, because the locus review already says the arrival has no move.
- **Tests.** `tests/extension/owed-state.test.mjs` and `tests/kernel/test_worldline.py`: fork carry, rewind and merge close. 14 mutations, all killed.
- **Still open.** Replaying the retained record through the live reviewer (the reviewer lane's configured model) is part of the probes below.

**FR-02.** The capsule has an `owed` section (from `owed.json`, excluding satisfied rows).

- Owed move, npc and time rows are the run's forced first steps (`apply:owed:<name>`, clerk authority `told_bookkeeping`, bound whole from the row).
- While an owed move is open, no move is built from the ledger's position: neither the clerk's moves nor the compile's destination rows.
- The run's first read waits beside its prescreen, within `PI_COC_OWED_WAIT_MS` (default 15 s from the run's start), for the previous delivery's post review still in flight (bus port `coc:owed-review`). This matters because turn 26's review landed 13 s after turn 27 opened; 3 of this table's 27 reviewed turns landed after the next turn opened.
- The Keeper's own apply that lands a row consumes that row's clerk step.
- **Tests.** `tests/extension/owed-told-position.test.mjs`. Turn 27's shape on the haunting: a stub Jev binds the look-alike reachable only from the ledger's office, and the control without the owed row walks there. Also covered: a review landing during the first read, and the host port.

**FR-03.** `move`, `time` and `npc` effects take `owed`. The kernel lands a row only when it is open, the effect lands it, and its quote is still in that turn's `rendered_text`. The reasons are `owed_unknown`, `owed_mismatch`, `owed_not_told`, `owed_kind` and `owed_repeated`.

- The receipt carries `owed` and `told_turn`.
- A landed row closes as `landed`. A row the ledger comes to agree with closes as `satisfied`. Any other move after the told turn closes an open owed move as `superseded`, so an arrival the story has moved past is never landed later.
- Admission basis `told`: a write whose every effect lands an owed row is admitted with no player-choice review. Its rows carry `path: "told"`, `reviewer: "told"` and `basis.told: {owed, turn, quote}`. A policy write must name its candidate's row.
- **Tests.** `tests/extension/owed-landing.test.mjs`.

**FR-04.** `prompts/keeper.md` law 2 now says told-but-unlanded state is owed and landed forward. Law 3 now says the delivered turn is canon: never retract, apologise, correct, or tell the player the table erred or a service failed, and the player's explicit dispute is the one exception.

- The `admission_unavailable` sentence that sent turn 23's 「桌边这边暂时接不上账目与收付」 is replaced. It now follows the refusal's own fix: keep the service out of the fiction.
- The `unrecorded` HEAD sentence no longer says the rows name "never which of them is right".
- The kernel-authored forward fixes are §158.3's.
- **Tests.** A guard test in `tests/extension/keeper-prose-contract.test.mjs`. Whether the model follows it is what the LLM-judged probes measure.

### 2026-09-29 — probes (FR-05's first bullet), live models on the Mac

**Reviewer replay (FR-01).** `tests/play/owed-review-probe.mjs` replays the retained turn-26 job (`f7a10203…`) through the product's `runReader` and brief, as a 1.2.32 job, with the reviewer lane's model on the App (`opencode-go/deepseek-v4.1-flash`).

- Outcomes were pre-registered in the run directory.
- **3/3 PASS**, each on its first submission with no repair (82 s, 82 s, 174 s).
- Each named an owed move `to: 勘查波街公墓`, `travel: local_travel`, quoting the told arrival (「波街公墓就在眼前——…」 twice, the Martin's Beach approach sentence once).
- Evidence: `.coc/playtests/owed-review-probe-2026-09-29T17-49-49-131Z/`.

**Keeper probes (FR-02/03/04).** `tests/play/forward_only_probe.py` lays the haunting out in each shape with the emitted kernel. The driver hands one player sentence to the live Keeper (`grok-build/grok-4.5`, low, hybrid engine). The judge (`opencode-go/deepseek-v4.1-flash`, a tool-enabled `pi -p` whose answers must quote the delivery) answers the pre-registered questions. **6/6 PASS**; I read every delivery as well.

- `told-position` ×2 (turn 26/27):
  - The first receipt is the owed move to `corbitt-house-ground` (`owed: t2-owed-1`, `told_turn: 2`), admitted on `path: "told"`. The first-arrival map (§39.2) followed.
  - Then the player's own check and time landed.
  - The prose continues at the house with no correction.
- `dispute` ×2 (turn 28): the party ends at the house and the delivery follows the player without apologising. One opens 「你仍站在科比特宅门前」, rounding off the delivered-wrong turn in the fiction.
- `service-outage` ×2 (turn 23): the admission lane was unavailable (`model_unavailable`, the lane model does not exist). No sentence tells the player the table could not settle, and the scene carries on.
- Evidence: `.coc/playtests/forward-only-probe-20260929T135408/` and the driver runs `fo-*`.

**Finding outside these tickets (not fixed here).** In both `service-outage` trials the Keeper narrated the refused batch's payment as done (「钱收了」 / 「把钱收下」) although the cash effect never landed. The refusal's own fix says not to narrate the refused batch's effects.

Under the ruling that told payment is now owed cash, but the owed kinds of §158.2 are move, time and npc (and objects through `missing`), not cash. The review can only report it as a `continuity_finding`, whose forward fix asks the Keeper to bring the ledger forward. Two follow-ups are possible: a `cash` owed kind, or a stronger hold on narrating refused effects. Both are new scope and are left for the owner to decide.

