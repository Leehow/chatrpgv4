# A clue the prose gives is a clue the ledger holds

Status: ready-for-agent (lead decision 2026-10-08 on TR-F2 run 3; implemented on `claude/clue-ledger-20261008`)

Contract: `docs/kernel-rpc.md` §201. Extends §190.2's exception to §166 from the told position to told clues; amends §5's
`apply clue`, §51.4, §135.32's `clue_follow_up`, §158.3 and §158.4.

## 1. Problem (evidence)

TR-F2 run 3: App `4ce2e4cab`, The Haunting, campaign `game-af36b938-4ca6-421e-bdec-759080123f69`, Keeper and lanes
`openai-codex/gpt-6-luna`. The player read the book's clues on several turns and the clue ledger never learned them; on
other turns the ledger learned clues the player never read, or the clerk filed a clue the book finds by a roll without the
roll. What each turn did, from the turn records, the session file and the telemetry:

| Turn | Delivery path | What the Keeper had been told | What reached the ledger | Root cause |
| --- | --- | --- | --- | --- |
| T7 (library) | `apply` refused by Pi's schema check, then explicit `narrate` | the schema's eight-line union dump, no `coc_error`, no fix | nothing; the prose gives the morgue's `globe-unpublished-story` and `macario-tragedy` | closing prose put in an effect (`kind: "narrate"`); no reader of a delivery for clues since §166 retired the verifier (§51.4's only producer); the clues were the morgue's, so `apply clue` would have been `not_here` |
| T9 → T10 (Hall of Records) | T9 `apply` refused whole by admission (`not_authorized`, wrongful); T10 implicit close (prose, no tool) | T9 fix: land nothing, narrate; T10 compile: `will-executor-chapel` yes 0.13 (not cleared), `chapel-closed-1912` no; check selection `no_roll` (0.48/0.50); consequence route cleared nothing | nothing; the prose gives both clues | same: nothing reads the delivered text; `will-executor-chapel` is a Library Use find and no roll was made |
| T18 (basement) | explicit `narrate` after the compile's clerk steps | `clerk_did`: `hollow-boards` and `corbitt-body-found` filed | both clues **did** land (receipts `t18-c1`, `t18-c2`); the prose gives neither in full and says there is no hidden door | the compile's ask row asks whether the declaration *seeks* a clue; `corbitt-body-found` is found by breaking the boards. The book asks no roll for the hollow areas ("a cursory inspection"); the room's Spot Hidden is for the dagger in the tool pile (graph: `environmental: check unspecified`) |
| T6, T13 | consequence route (`clue_follow_up`, executed) | `clerk_did` | `house-built-1835` (Library Use), `chapel-journal-burial` and `liber-ivonis-tome` (Spot Hidden) landed with no roll | `apply clue` and the consequence route never read the clue's check; only the compile's `ask_clue` did |
| T11, T14, T15 | explicit narrate | -- | `chapel-eye-symbol`, `nailed-windows` (landed T15), `catholic-wards`, `upstairs-disturbance` told, not landed | same as T7 |

The run log's reading of T18 ("no clue landed and no Spot Hidden roll") came from the prose alone; the receipts say the
clerk filed both, and the book needs no roll there.

**Hollow deliveries to avoid:** a prompt sentence telling the Keeper to apply clues; matching prose against clue words;
correcting or retracting what the player was told (§158: the ledger moves forward to the story); a reviewer between draft
and player (§166 forbids it without the owner).

## 2. Solution

**CL-01 The ledger follows the told clue (§201.1).** After every delivery a Jev read (`told-clue`, the §190.2 pattern)
asks, for each clue in play the ledger lacks (the delivered scene's, the scenes left that turn, the trail's), whether the
delivered text gives the investigators what the clue states; for each that clears, which delivered sentence does. The host
names each through `table.owe` (`source: "told-clue"`); the kernel writes §158.3's owed row; §158.4's clerk lands it first
on the next run, where the party stands (no `not_here`). One flight for both told reads.

**CL-02 A check the book names is passed before its clue lands (§201.2).** `apply clue` refuses a clue whose profile is
`skill_check` with an authored skill until an investigator's roll of that skill passed in the same turn (`check_first`, with
a fix); `table.apply.options` says so on the row (`check.passed`); the consequence route and the plain clue candidates do
not offer it before then. A told row is exempt (the story gave it) and says `check_skipped` when the told turn passed no
such roll.

**CL-03 A schema refusal says how to write it (§201.3).** An `apply` effect with an unknown `kind` (closing prose as
`kind: "narrate"`, another tool's name) or missing a property its kind requires is refused before Pi's schema check, with a
fix that names where prose goes and how a clue is written.

**CL-04 What the ledger holds and the prose did not give is counted (§201.4).** The same read asks `given` of the turn's
own landed clues and counts `landed_untold`; nothing acts on it.

## 3. Decisions

1. **Forward, not a gate.** "Lands it, or is corrected once to do so": the read lands it (§158's ruling, "TRPG 只能向前开").
   A pre-delivery correction would be a reader between the draft and the player, which §166 forbids; §166.2 shows such an
   exception needs the owner. Not added.
2. **The told candidates are the places the party has stood**, not only what compile or consequence offered on that turn:
   T7's told clues were a scene left the turn before. The trail bounds it; `max_candidates` 24 bounds the request.
3. **Bars from measurement**: `given_min` 0.6 (run 3, live Jev, three passes: told 0.77-0.97, others ≤ 0.21),
   `sentence_min` 0.5, `untold_max` 0.15. Shipped `on`; `PI_COC_TOLD_CLUE` overrides the mode.
4. **The check gate is the kernel's**, with one rules identifier compared (NFKC, case, spacing). A `skill_check` with no
   authored skill is not gated (§30.12). The told landing is exempt and counted, because withholding it would leave the
   ledger wrong about what the player knows without un-skipping anything.
5. **What lets prose skip a check is not closed here**: in the driven engine the Keeper cannot roll, check selection may
   choose `no_roll`, and the note then says to narrate the attempt by judgement. The count (`check_skipped`) measures it;
   a delivery-time guard is the owner's call.
6. **The compile's "seeks" question (T18) is not changed**: `landed_untold` counts it first.

## 4. Tickets

- CL-01: `kernel-ts/owed/{told,index,land}.ts`, `kernel-ts/apply/{index,entities}.ts`, `runtime/jev/told-clue.ts`,
  `extensions/kernel/{told-clue,told-position,index}.ts`, `runtime/jev/{host-budgets,candidates}.ts`, `extensions/kernel/tools.ts`
  (`owed` on the clue effect), `content/rulesets/coc7/host-budgets.json`.
- CL-02: `kernel-ts/read/clue-check.ts`, `kernel-ts/apply/entities.ts`, `kernel-ts/runtime/apply-operation.ts`,
  `runtime/jev/{consequence-candidates,candidates}.ts`.
- CL-03: `extensions/kernel/{tools,index}.ts`.
- CL-04: in CL-01's read.

Tests: `tests/extension/clue-ledger.test.mjs`, `tests/extension/clue-ledger-kernel.test.mjs`; fixtures
`tests/extension/fixtures/clue-ledger/run3.json` (run 3's T7, T10 and T18 deliveries and player inputs).

## 5. Comments

- Codex integration (2026-10-08): the stopped worker's tracked patch and new files were copied without changing its
  worktree. The implemented candidate enumeration omitted the world trail despite §201.1 and its own test requiring it.
  The existing real-kernel options test failed with only `here`, then passed after adding the trail newest first (`back`).
- Local real-kernel diagnostic: `clue-ledger-kernel.test.mjs`, 6/6 on exact Node 24.19.0. The host-path file could not start
  because this new checkout has no emitted Pi runtime dependency under `build/node_modules`; no old kernel was borrowed
  and no full Mac build was run. Host-path verification, focused/all on the box, and live acceptance remain pending.
