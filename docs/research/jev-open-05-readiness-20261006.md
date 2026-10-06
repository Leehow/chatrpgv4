# JEV-OPEN-05 retained preparation: candidate and evidence

Date: 2026-10-06. Owner: `01a10ef5-dece-76c3-90fd-6bea904c4003`.
Coordinator: `01a104b9-96e3-7401-b529-ee16ec848014`.
Base: `0.9.6a@17f24438d386819bfe6cf09bf2c5139c93856442`, verified before work.
Branch: `codex/jev-open-05-20261006`.
Worktree: `/Users/haoli/Documents/Codex/2026-10-05/task-14/jev-open-05`.
Candidate commit: recorded in `chatrpgv4/jev-open-05` in project-tracker and the final handoff.

The original task is to execute the already selected action once after actual
mechanical preparation, preserve its actor/target/method and vehicle roster,
and retire it when its scene, actors or run ownership expire. Existing
preparation code was present at the base; it was not reimplemented. This
candidate fixes only failures reproduced by executing the current TS kernel
and host paths. Mainline, user WIP, original evidence and installed/running
applications were not modified. Dependencies are shared by node_modules links;
no campaign or Pi home was copied from another task.

## Read and verification boundary

Read the full original untracked issue document at
`/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/docs/research/jev-open-issues-20261005.md`,
repository `Agents.md`, C04 in `jev-post-playtest-triage-20261005.md`, contract
159.11-159.12, and the readiness implementation/final-review reports in
`/Users/haoli/.codex/worktrees/jev-root-readiness-20261005/.tmp/team-lead/`.
Both readiness reports left continuation/race execution unverified. That was
the initial coverage gap, not evidence that an old failure still occurred.
No repository-local `.agents/skills` was present. The available diagnosing-bugs
skill was used for current-path reproduction.

Evidence below is local deterministic regression. The real vendored driver
test uses fixed Keeper/Jev/NPC responses, real extension dispatch/admission,
and the emitted current TypeScript kernel. The other tests use the existing
host-port/policy seams and actual RPC catalogs, completion writes, receipts
and save files. They do not claim natural model judgement, full combat/chase
progression, source-reader accuracy or App acceptance. No paid model call was
made; no credential value was read or changed. A task-specific paid budget
was not identified or borrowed.

## Reproduced defects and repairs

All log paths below are relative to this worktree, under `.tmp/jev-open-05/`.
Logs, including failed fixture experiments, remain intact.

| Current failure | Evidence before repair | Narrow repair |
| --- | --- | --- |
| Replacing a run while NPC resume awaited readiness wrote the old intention and combat starter. Resume had already removed the packet from its map, so replacement did not close it through the map. | `npc-retained-before-3.log`, old generated intention and `session:combat-start` after replacement | Every NPC writer checks run identity, closed check inputs, closed NPC preparation and cancellation before canonical dispatch. |
| Leaving and returning to the same scene republished the old NPC act after completion. | `npc-scene-before.log`, one resume candidate when zero was required | A read that loses the original actor/place/session/way/bound parameters permanently expires the packet. Temporary profile incompleteness still waits. The host removes expired packets and records a no-roll. |
| Changed driver placement evidence released the obsolete selected vehicle roster after profile/skill completion. | `chase-before-2.log`, stale-roster assertion | Fresh preparation release checks the original names, placement evidence and published vehicle domain without choosing new roles or links. |
| Retiring the obsolete roster still offered a new chase plan for the same player declaration. | `chase-replan-before.log`, replan assertion | An expired prepared decision stays retired for that player run, across further scene changes. A fresh player run receives its own current capabilities. |
| An NPC pursuit of an investigator implicitly recruited all other present NPCs. Completing the original pursuer was still refused on an unrelated Old warden's partial block. | `partial-before-2.log`, Old warden DEX/CON/MOV refusal | The existing foot starter retains the selected NPC as sole pursuer and the bound investigator as quarry. Investigator-owned defaults remain as before. |

The writer still uses normal admission and kernel validation. There are no
new fallback statistics, keyword intent patches, forced narrative shortcuts,
provider changes or runtime budget increases. Contract 159.12 documents the
expiry and ownership behavior.

## Coverage on the actual paths

- NPC first blow: null profile on real hybrid host ports, source-authored partial
  creature profile through actual completion, and a full vendored driver run
  through the extension gateway. The driver case first settles a real Persuade
  check against the editor, then prepares the resulting held act. The preparation
  receipt precedes all generated action receipts; one combat starter is written.
- NPC foot pursuit: real combat/flee first creates the legal pursuit context;
  an NPC missing only MOV completes through apply npc and resumes its original
  ref/target/method. Source characteristics survive completion. Saved participants
  contain only the original pursuer and quarry.
- Player foot and vehicle chase: actual catalog -> selector -> preparation hold
  -> fresh policy release -> host canonical starter -> saved chase. The original
  action is deep-equal on release; no extra semantic planning is called. Vehicle
  keys, Drive Auto 80, vehicle MOV 14 and the passenger's original driver link
  persist; the passenger has zero movement actions.
- Missing profiles and repeated accepted preparation refreshes produce no
  original intention, attack, damage or chase starter. The pre-existing stakes
  read may retain its separate roll receipt.
- Delivery, cancellation, agent_end and replacement retire late completion. Each
  is also tested while the actual readiness response is paused before candidate
  publication and before resume dispatch. The pause gates an actual kernel read;
  it does not substitute readiness data.
- Concurrent duplicate resume and later duplicate stale candidate calls execute
  once. NPC authorship and binding are not repeated.
- Leaving/returning to a scene, removing/returning an NPC, changing driver placement
  evidence and removing/returning a passenger cannot revive the old action or
  offer another plan for that declaration. Expiry does not cross into a new run.

## Commands and results

All node commands used
`/Applications/PipiCOC.app/Contents/Resources/pi-coc/node/bin/node` (v24.19.0).
The task's own `build/kernel/rpc.mjs` was rebuilt from `kernel-ts/rpc.ts` with
esbuild (`bundle`, external packages, node24, ESM). The installed App was not
rebuilt or replaced.

| Command | Result | Evidence |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc -p tsconfig.kernel.json` | exit 0 | `kernel-typecheck.log` |
| `node --test tests/extension/single-loop-npc-act.test.mjs tests/extension/partial-stat-block.test.mjs tests/extension/chase-readiness-continuation.test.mjs tests/extension/chase-roster-selection.test.mjs tests/extension/chase-vehicle-gateway.test.mjs tests/extension/attack-preparation.test.mjs tests/extension/check-preparation-host.test.mjs tests/extension/system-language.test.mjs` | 109/109 pass, exit 0; before the four final additional tests and final expiry replan guard | `targeted-regression.log` |
| `node --test tests/extension/chase-readiness-continuation.test.mjs tests/extension/chase-roster-selection.test.mjs tests/extension/check-preparation-host.test.mjs` | 15/15 pass, exit 0 after the final replan guard | `chase-final-regression.log` |
| `node --test --test-name-pattern='JEV-OPEN-05' tests/extension/single-loop-npc-act.test.mjs tests/extension/partial-stat-block.test.mjs tests/extension/chase-readiness-continuation.test.mjs` | 24/24 pass, exit 0 on final source | `final-focused.log` |
| `node --test tests/extension/system-language.test.mjs` | 5/5 pass, exit 0 after the final source edit | `system-language-final.log` |
| `git diff --check` | exit 0 | Final handoff receipt |

Earlier successful focused logs include `npc-races.log` (14),
`driver-first-blow-final.log` (1), `actor-expiry.log` (2),
`concurrent-resume.log` (1), `partial-npc-after-2.log` (2), and
`chase-after.log` (4). These are overlapping regression evidence, not additional
acceptance counts. Preliminary fixture failures (projected rather than raw
catalog options, the receipt's profile field, or triggering NPC scan after a
model cash write) are not product-failure evidence; their original logs remain.

## Integration and open boundaries

Exact touched files:

- `kernel-ts/chase/bindings.ts`
- `runtime/jev/hybrid-engine.ts`
- `runtime/jev/npc-act-step.ts`
- `runtime/jev/step-policy.ts`
- `tests/extension/single-loop-npc-act.test.mjs`
- `tests/extension/partial-stat-block.test.mjs`
- `tests/extension/chase-readiness-continuation.test.mjs`
- `docs/kernel-rpc.md`
- This research report.

The coordinator owns serial review and integration of shared files. No merge,
push or App replacement is part of this candidate. JEV-OPEN-03's combat exit
and JEV-OPEN-06's full combat/chase/SAN/healing natural acceptance remain with
their owners. Full repository suites, full runtime typecheck, a paid natural
driver session and installed App acceptance were not run here.

A real additional failure remains outside this candidate: completing a passenger
with the existing ordinary_adult archetype can produce a valid negative body
Build, which the chase snapshot validator rejects as `chase snapshot participant
build is invalid`. `vehicle-diagnostic.log` preserves the actual refusal. This
was reported to the coordinator for JEV-OPEN-06. The retained-roster regression
uses the existing capable_adult completion to isolate continuation with a legal
current snapshot; it does not prove all passenger profiles work or fix the
statistics/validator policy. That broader boundary remains open.

The tracker records implementation candidate, integration not started, scoped
verification partial and packaging not applicable. It preserves the original
request and an open completion gate for coordinator review and uncovered natural
branches. No task-specific paid budget has been spent.
