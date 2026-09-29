# Forward-only reconciliation — tickets

Parent: [forward-only-reconciliation.md](forward-only-reconciliation.md). Owner ruling 2026-09-29: the delivered fiction is canon, the ledger catches up forward, the Keeper does not confess, and only the player's explicit dispute makes an exception.

Order: FR-01 → FR-02 → FR-03 → FR-04; FR-05 closes. FR-04's wording can land alongside FR-01.

---

## FR-01: the review that detects a divergence names what the ledger owes

Status: needs-triage

**What to build.** Turn 26's post continuity review found the unlanded arrival, but in free text that became a `continuity_finding` whose fix says "avoid the same problem". The review should return what the delivered text established and no receipt carries as structured **owed effects**, in `apply` shape: a move (to a graph handle, or a new place with `establish`), elapsed time, an object handed over, an NPC present or gone, and so on. The kernel records them on the turn record and in `world.owed`, with the delivered quote that established each. §130.4 gains an `owed_state` row kind whose kernel `fix` points forward: land it with an ordinary `apply` as something that already happened, and do not narrate it again or correct it. `unsettled_object` joins it as one owed kind rather than staying a special case.

**Acceptance.**
- [ ] Turn 26's record (retained) replayed through the review yields an owed move to the Poe Street cemetery scene or place and owed travel time, each with its quote.
- [ ] No code classifies prose. Owed effects come only from the review's structured answer, and the kernel validates their shape and graph references.
- [ ] A delivered turn with nothing owed writes nothing; a finding that is not state (tone, style) stays a `continuity_finding`.
- [ ] `world.owed` survives restart, and a worldline fork carries it with the line.

## FR-02: the next turn starts from the told position

Status: needs-triage

**What to build.** The capsule carries an `owed` section (what the player was told and the ledger lacks). The single-loop candidate builder (§135.2) reads it first. The owed effects are the run's first candidates, and any move candidate is bound from the told position, not the ledger's. A clerk step never lands a move that contradicts an open owed position; turn 27's `apply:move:arkham-church-cemetery` would not have been bound.

**Acceptance.**
- [ ] With turn 26's owed move open, turn 27's player line 「我下车走进栏内，蹲在敞开的墓穴旁…」 binds against the Poe Street cemetery, and the first landed receipt is the owed move.
- [ ] A test fails if the builder reads only the ledger again: remove the owed read, and the clerk binds the wrong cemetery.
- [ ] The budget's `deferred_last_turn` note keeps working. Owed state is separate from it and does not depend on the session's memory.

## FR-03: owed effects land as consequences, under a `told` admission basis

Status: needs-triage

**What to build.** An owed effect lands through an ordinary `apply` (Keeper or clerk) as a consequence of what was told. Admission judges it on a basis `told`, like `basis.compile` / `basis.consequence`. The question is whether the delivered text established it, answered from the recorded quote and the delivered turn, not whether the player chose it. A landed owed effect clears its row. One that cannot land (unknown place, invalid target) stays owed, is retried by `establish`, and never flips the fiction to the ledger's version.

**Acceptance.**
- [ ] The owed arrival lands with receipts and clears `world.owed`; §39.2's first-arrival map placement fires on it like on any real move.
- [ ] An owed effect whose quote is not in the delivered text is refused (the basis cannot be forged by the Keeper's own words).
- [ ] Admission rows name `basis: "told"` and the quote; the telemetry tells owed landings apart from player-chosen ones.

## FR-04: the Keeper never corrects or confesses; the player's dispute is the exception

Status: needs-triage

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
