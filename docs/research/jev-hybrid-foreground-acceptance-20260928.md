# Jev foreground ownership and actual hybrid acceptance — 2026-09-28

Status: implementation, regression follow-up and scoped review complete. Verified at focused seams and in real RPC play. No packaged-App claim.
Baseline: `d970f4041`, branch `0.9.6a`. Generation: Grok 4.5 / low throughout the live checks.

## Correction to previous evidence

The earlier `jpdf-ref-blood-*` play traces reported `loop_engine: legacy`. Their 87.1-second result did not measure hybrid-v1. The prior report now explicitly marks those runs invalid-for-acceptance of the hybrid engine. Exact-source child and graph-publication observations remain valid component evidence. Nothing was deleted or relabeled as a passing hybrid run.

## Implementation

- The kernel bridge supplies module identity and source runtime to the existing hybrid read port. `prepareKeeperSupport` now receives its source binding, allowing the existing native PDF provider to supply evidence before Keeper inference. A real-kernel/PDF regression drives this actual read port and finds the original notice in its returned material, without any Keeper inference.
- Pre-read reuse binds scene, the source snapshot/accepted-answer revision, and the player's current need. It does not use volatile reader queue bookkeeping as its source identity. Explicit `read_more` refreshes, including when optional preselection is off; ordinary unchanged reads may reuse material.
- The product launcher chooses hybrid-v1 when Jev is available. Explicit engine controls and private legacy experiment modes remain explicit controls. Disabled/missing Jev keeps legacy. Setup uses a separate preparation phase; it is not sent to a play driver that requires a world.
- Source intake enumerates existing absolute local PDF paths by syntax, then asks Jev whether the player actually selected one for a campaign and whether a different play language was requested. Negation, quotation, inspection-only requests, missing files and unresolved language changes leave the usual dialogue in control. The host advances the existing choose-source, prepare-module and create-campaign steps before the Keeper's first request. Cancellation is checked between steps. Advice does not constrain the card.
- Prologue display uses `triggerTurn:false`; displaying already generated guidance is not a request for another model turn.
- Incremental source publication can introduce actors after initialWorld created the campaign. The apply-options owner offers initial presence only for source-linked actors with no recorded location/name identity. Jev checks current source conditions before the normal NPC effect executes. Existing presence, departure, alternate location and obligation guards are preserved. No actor profile or movement of an established person is invented.
- Route questions distinguish unresolved adjudication from final narration. Ordinary descriptive prose/dialogue about settled events belongs to compose. The compose note discourages repeated lookup and optional bookkeeping. SL-79's narrator-only tool catalog remains gated; genuine open parameters retain their existing owner.
- `tests/play/driver.py --expect-engine` verifies a current-process runtime receipt and records expected/actual mode. It fails on mismatch or no report. It never trusts an old campaign startup row.

## Real evidence

| Run | Observation | Limit |
| --- | --- | --- |
| `jpdf-hybrid-wiring-03` | Actual hybrid receipt; Jev executed the return to Esso before the first Keeper request. 52.7 s, one main Keeper request. | That request also supplied unrecorded time/NPC bookkeeping; it was not a prose-only result. Preselection suffered timeouts. |
| `jpdf-setup-preflight-01`, turn 1 | Cold Blood PDF introduction/setup entry: 27.5 s. Source guide child: 16.808 s, one generation, 8,765 input / 271 output tokens. Host had completed choose-source, prepare-module and create-campaign before the first main Keeper request. No main Keeper setup tool call. | The guide child and main dialogue are separate generations. This is not full character creation time. |
| Same setup, turns 2–3 | Card draft 41.5 s; confirmation 9.4 s. Drive Auto 20 preserved. | The draft needed a finance-era argument repair. Human/coding gaps contributed to background overlap; do not sum these as a cold handoff benchmark. |
| `jpdf-hybrid-default-01` | No PI_COC_LOOP_ENGINE override; the actual receipt reports hybrid-v1. Jev executed both town arrival and gas-station moves before Keeper inference. 63.1 s, two main Keeper requests. Source catalogs were supplied by the new bridge. | Keeper bookkeeping plus prose beside apply caused a second narration request. This adverse result motivated the presence/compose corrections. |
| `jpdf-hybrid-final-01` | After the corrections, Jev executed the move to the residential district. 40.5 s; one main Keeper request; its response combined open time bookkeeping and final narration. No model lookup/source request. | Not a pure narrator-only catalog and not a same-state controlled comparison with the old 87.1-second run. |

The first two engine-guard launches were retained as failures: a missing internal parser option, then a startup event that was not yet available through RPC. The current-process receipt fixes the transport seam. Neither failed launch is gameplay evidence.

Evidence lives in `.coc/playtests/<run>/`, `.pi/jpdf-ref-home-blood03/.coc/`, `.pi/jpdf-setup-preflight-home01/.coc/` and `.pi/hybrid-*.log`. Real play used the canonical RPC driver with the main session as player, one natural input at a time. All daemons were stopped normally after their checks.

## Verification boundaries

Focused checks cover the actual hybrid source read port, source/campaign authority, source/need cache invalidation, explicit read-more, source intake, opening choices, source-presence candidate binding, existing location protection, default engine choice, missing/incorrect engine rejection, system language and inference inventory. Conditional actor initialization is verified deterministically; this report does not claim a separate live scheduling/absence benchmark for it.

The source graph may remain partial; visual/scanned pages still need their real source reader. Main Keeper calls are separated from source-guide generation, Jev requests, NPC creative lanes and background readers. A one-request result does not mean zero other model work or complete source coverage. Remaining latency includes pre-read scope/timeouts and final prose generation. No threshold was lowered to force player actions, and no receipt/admission guard was removed.

Full regression results and final review are recorded below. Heavy suites run locally in sequence because the available remote helper still force-checks out/cleans scratch worktrees outside the required lifecycle owner; no remote scratch worktree is created.

## Final regression and review

- Kernel typecheck and runtime build passed.
- Full extension suite: 3,805 passed, one failed in 418.269 s. The failure exposed a repeated compose note; the producer was corrected to put it in the existing first-note header, preserving the original test. The final relevant extension subset passed all 39 tests in 19.77 s (`.pi/hybrid-last-targeted.log`).
- Full kernel/play suite: 2,022 passed, one failed in 387.37 s. The failure expected the old two-family apply-options coverage. Updated that exact assertion to include the new contracted source_presence family; all 83 apply-options/driver tests then passed in 48.64 s (`.pi/hybrid-last-python.log`). No production behavior or other assertion was weakened to satisfy it.
- Full suites were each run once; after the two corrections only relevant tests were rerun. Final build log: `.pi/hybrid-last-build.log`; full logs: `.pi/hybrid-full-kernel-play.log` and the preserved extension-suite output.
- Review compared all current tracked and new files with d970f4041. It checked scoped Jev disablement, setup cancellation/choice handling, source authority and revision reuse, conditional NPC presence and existing-position protection, and current-process engine verification. No remaining actionable finding in this scope. The final small corrections preserve opening_shown in setup preflight and the driver's env=None behavior without flags.
- The unused `jpdf-hybrid-presence-01` daemon was found during final process audit and stopped normally: zero turns, zero tool calls; it contributes no acceptance evidence. All task play daemons are stopped; evidence is retained.

## External cross-check

[LangChain's retrieval architecture documentation](https://docs.langchain.com/oss/python/deepagents/retrieval) supports retrieval before generation for predictable model-call counts, while explicitly noting variable retrieval/network latency. [Anthropic's workflow guidance](https://www.anthropic.com/engineering/building-effective-agents) supports explicit routing for defined categories and keeping workflows simple. Both support the chosen source-preparation seam; neither establishes this product's latency or completeness. Unlike a document Q&A example, game actions still require authoritative state transactions and unresolved parameters may need the Keeper. These comparisons do not justify removing that fallback or promising one call for every action.
