# Blood Road: blind two-chapter Jev playtest

## Authorized objective

Continue the real Blood Road campaign, explore as an ordinary player, and complete at least the
first two playable story chapters. Diagnose, repair and retest encountered product failures until
this acceptance is achieved. User authorized sustained work on 2026-09-30 and is offline.

The sole player is the main session. Keeper is `grok-build/grok-4.5`, thinking `low`, through
`tests/play/driver.py` and `bin/pi-coc`. One natural player message after each delivered Keeper
response; no scripted Keeper, batch settlements or synthetic gameplay. Player choices use only
publicly delivered fiction. Do not inspect future PDF chapters, module secrets, private NPC motives
or solutions in the player context. Diagnostics may inspect generic code, rule contracts, question
wording, distributions and non-spoiling metadata. Filter private narrative from tool output.

Chapter completion must reflect meaningful play and committed story progress, not two scene visits
or a fixed turn count. Determine chapter boundaries from delivered progress or a non-spoiling
structural verification after reaching them; setup/reference sections do not count as story chapters.

## Scope and constraints

Repair system paths responsible for failures in this live play, with contract changes and relevant
regressions. Preserve all campaign/module/turn/telemetry/playtest evidence. Do not patch scenario
content to force progress, lower mutation gates merely to pass a test, return check selection to the
LLM, restore the retired Python kernel, change model defaults, push, deploy or package incidentally.
Use isolated task-owned worktrees for overlapping repairs; preserve concurrent dirty work.
Heavy suites/full runtime builds use an available LAN box. Live play stays on the Mac.

## Current state

- Latest branch: `0.9.6a`; source HEAD at intake: `4c1006c8d`.
- Concurrent dirty file: `docs/specs/historical-reference-mod.md`, another task's work.
- Campaign: `blood-road-jev-20260930`; original PDF module `book-2`.
- PDF SHA-256: `9cc71c34dd62462f0f3c7bf765defc4bc49667f1f9fee3f0ac172a32464da50c`.
- Last play run: `blood-road-jev-fixed-play-20260930-v2`, stopped after three delivered turns.
- Packing repair landed in `0f1152f4b` and `4c1006c8d`; integration `4f74f351f`.
  Focused regressions 29 passed; kernel typecheck passed; main repair built on leehow-pc.
  Three real turns had no packing refusal. No successful live roll was observed.
- Installed legacy Keeper `session.resume` rejects this current TS save as `unsupported_save_schema`;
  it was called first at context epoch 9. Continue through the repository's current source driver,
  not the retired plugin state model. Do not repair that unrelated legacy gateway as a shortcut.

## Public player knowledge only

Jack Miller is a 32-year-old travelling car mechanic (canonical card occupation Engineer), English
mother tongue. Mechanical Repair 50, Spot Hidden 25, Persuade 10, Dodge 40, Brawl 25. He has a car,
spare tire/jack and tools, a revolver, and roughly USD 60 before any committed expenses.
The car suffered a flat entering Abattoir in west Texas in July 1975. At the Esso station, Russ
offered help replacing the tire, about an hour. Two other men sit in the shade.
Delivered tire inspection found a rough iron nail. Jack asked Russ to waive labor because money
is tight; the two persuasion attempts stayed unresolved. Russ has not agreed, refused or been
successfully influenced. Do not turn an unresolved roll into any of those results.

## Ready work

1. Diagnose the repeated `check_necessity_uncertain` social ruling using existing question wording
   and answer distributions. Hide module-private narrative during inspection.
2. If a system failure is confirmed, fix and regress the producer-reader-actor path; otherwise
   respect the uncertainty and continue ordinary exploration through legitimate player choices.
3. Resume source-driver play with 4.5 low; verify fixes in the original scenario and preserve evidence.
4. Explore normally to at least two completed story chapters, handling new failures as they occur.
5. Verify committed progress, update this plan and produce a concise evidence-bounded final report.

## Acceptance status

Open. Chapter count is not yet established; do not count the gas-station opening as a completed
chapter without source-bound, non-spoiling progress evidence. The successful packing repair alone
does not complete this sustained playtest.
