# JEV-OPEN-03: combat choice breakpoint and candidate handoff

Date: 2026-10-06. Owner: Codex thread `01a10ef4-0152-75a9-a42a-d1a36e8e0024`.
Base: latest development branch `0.9.6a`, verified at
`17f24438d386819bfe6cf09bf2c5139c93856442`.
Candidate branch: `codex/jev-open-03-owned-20261006`.
This is offline historical diagnosis and owner verification of the changed TypeScript receipt-binding functionality.
It does not claim a current natural-language model comparison or full scenario play acceptance.
No model requests were made, no credentials were read, and the original runs and campaign were not modified.

## Findings

The first fully issued and explicitly answered flight choice precedes v32. It is campaign turn 599 to 600,
v24 driver 338 to 339. The break is after semantic selection, at unavailable action admission. A separate
current-source defect omits the choice receipt when an already selected flight succeeds. The candidate fixes
that receipt binding only. Neither observation establishes that every historical retained fight has one cause.

The historical public world records show one combat start at campaign turn 106, round 2 remaining active through
1541, and the flight end at 1542. The false target selection at turn 106 is already addressed by
`8e1e984d075abb86a079adb6ba8c3ae139c13653` (an ancestor of this task's base). That earlier repair is not repeated.
Existing campaign state is not automatically cleared or migrated. Ordinary movement prose does not prove a
legal escape or authorize a combat end.

### Earliest complete choice-answer attempt

All original paths below are beneath
`/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/.coc/`.
Line numbers are one-based. The campaign is `campaigns/blood-road-jev-20260930`.

| Boundary | Original evidence | Observation |
| --- | --- | --- |
| Issued | `playtests/blood-road-jev-20261002-flapcode-gpt6-luna-v24/turn-338.json`; campaign `turns/0599.json` | Successful mechanics ask, options `push/spend_luck/accept/flee`, pending `ask-combat-investigator-roun-t599`. |
| Public projection | v24 `events.jsonl:111043` | `entry_appended/coc-choice` publishes that exact choice. Historical CLI omission of printed controls is B01, already fixed; an RPC entry alone does not prove the old CLI displayed it. |
| Answer | v24 `turn-339.json`; campaign `turns/0600.json` | The player explicitly chooses to leave the conflict and avoid fighting. This follows the issued choice. |
| Semantic selection | campaign `telemetry.jsonl:56709`, `:56714` | Compile clears `combat:flee`; route selects `resolve:combat:flee:investigator`. |
| Admission | campaign `telemetry.jsonl:56720`, `:56724` | Both original and bounded resend fail with Flapcode HTTP 400. Typed judgments say authorized, but the independent lane is unavailable; unavailable admission grants no authority. |
| Execution / receipt | v24 `events.jsonl:111125`; campaign `telemetry.jsonl:56729`, `:56730`; `turns/0600.json` | Execute is refused, `check_refused/no_roll` and bind `refused` are recorded. No resolve, choice or combat-end receipt lands. The fight remains active. |

This locates the failed attempt; it does not establish whether flight would have succeeded under all rules had
admission been available. The historical source SHA is unknown. There is no current HTTP-400 reproduction,
and weakening or bypassing admission would violate the action-authority contract.

### Later v32 comparison

v32 driver 736 to 745 corresponds to campaign 1532 to 1541 and repeatedly publishes a mechanics flee choice.
Players who elect to stay hidden do not authorize an escape. For driver 743 to 745, the player describes leaving,
but compile selects `none`, not `combat:flee`; `act_gated` therefore prevents the route from executing the escape.

| Driver / campaign | Campaign telemetry | Observation |
| --- | --- | --- |
| 743 / 1539 | `:127593`, `:127595` | Compile `none` .70, probability .76; flight probability .23. Flight gated; no bind or end receipt. |
| 744 / 1540 | `:127640`, `:127643` | Compile `none` .69, probability .75; flight probability .23. Flight gated. |
| 745 / 1541 | `:127690`, `:127692` | Compile `none` .73, probability .78; flight probability .20. Flight gated. |
| 746 / 1542 | `:127736`, `:127739`, `:127750`, `:127755` | Compile clears flight, route selects it, kernel returns `combat/end/fled`. The delivery exposes the end receipt. |
| 747 / 1543 | `:127829`, `:127832`, `:127853` | Ordinary investigation is offered and resolved with no active combat session. |

The prior public choice is issued, and the player's natural-language answer reaches the host, but the later
semantic gate does not select flight until driver 746 explicitly names the option. This is a different break
from turn 600's unavailable admission. Neither a keyword recognizer nor an automatic end is a justified repair.
Current natural-language comparison remains untested here; the semantic classifier is unchanged by this repair.

The successful campaign `turns/1542.json` contains the combat-end receipt and the old top-level pending choice,
but no choice receipt. Narration later clears pending choices; this is not evidence that the ended fight remains
active. It identifies an incomplete answer-to-receipt audit chain.

## Current reproduction and narrow repair

The new regression uses the shipped starter, real emitted TypeScript kernel and standard RPC methods. It opens
a fight, reaches the investigator's turn by the normal NPC hold, issues a mechanics ask, takes the next player
input, selects the issued flight candidate and resolves it. It is a deterministic transaction test, not a
scripted natural play run or a substitute Keeper.

At the unmodified base, the flight produces `combat/end/fled`, but the assertion requiring its `choice/flee`
receipt fails. The current candidate constructor attaches choice binding only for historical player defense;
the investigator's own flight candidate carries none. Without `action.choice`, existing `bindChoice` returns
without consuming or receipting the answer.

The repair retains the pending name and `flee` option in the host-only candidate basis when the choice was open
at the run's input boundary, still matches the current pending name, is mechanics, and still offers `flee`.
`keeperCall` adds the binding to the selected operation. Jev's route/bind state never receives the runtime name.
The same regression now receives both the choice and end receipts, with pending choice and active session null.
Stale, newly issued, story and non-flee choices are not attached. Offering flight alone does not select it:
the candidate remains unforced and the existing compile/route gate still applies. Kernel flight, initiative,
defense and admission rules are unchanged.

## Verification

Node: existing `/Users/haoli/.local/opt/node-v24.19.0-darwin-arm64/bin/node`, version 24.19.0.
Shared `node_modules` is linked, not copied or rebuilt. No `.pi` or original `.coc` tree is copied.
Logs are in `/Users/haoli/Documents/Codex/2026-10-05/task-9/evidence/`.

| Check | Command / result | Evidence |
| --- | --- | --- |
| Initial environment attempt | Node 22 target RPC test failed before campaign creation: shared `fs-ext` ABI 137 vs 127. This is an environment failure, not the defect reproduction. | `flight-before.log` |
| Base reproduction | Node 24 `--test --test-name-pattern="a selected flight answers" tests/extension/single-loop-candidates.test.mjs`: expected failure, missing choice receipt after successful combat end. | `flight-before-node24.log` |
| Final target regression | Node 24 `--test tests/extension/single-loop-candidates.test.mjs tests/extension/single-loop-compile.test.mjs tests/extension/single-loop-binding.test.mjs`: 62 passed, 0 failed. | `target-regressions-final.log` |
| System-language guards | Node 24 `--test tests/extension/system-language.test.mjs`: 5 passed, 0 failed. | `system-language.log` |
| Emitted runtime | Node 24 `scripts/build-runtime.mjs`: exit 0. | `build-final.log` |
| Kernel type check | Node 24 `node_modules/typescript/bin/tsc -p tsconfig.kernel.json`: exit 0. | `kernel-types.log` |
| Integrated source build | Node 24 `scripts/build-runtime.mjs` at `b91cd53a4dbdd38e67f74dd5b58d7b1bf7258c54`: exit 0. | `owner-current-build.log` |
| Refusal and replay boundary | Node 24 `--test --test-name-pattern="flight choice receipts roll back" tests/extension/single-loop-candidates.test.mjs`: 1 passed. The real kernel refuses the investigator's flight during the NPC turn, preserves pending choice and combat, later commits the selected lawful flight, and replays it without duplicating either receipt. | `owner-flight-replay-final.log` |
| Unselected flight boundary | Node 24 `--test --test-name-pattern="flight choice receipts roll back\|an offered but unselected flight" tests/extension/single-loop-candidates.test.mjs`: the unselected-flight test passed. After ordinary narration and the next player input, combat remains active and no flight choice/end receipt exists. | `owner-flight-boundaries-final.log` |

The boundary-test drafts initially expected the wrong RPC refusal code, omitted the narration call ID,
read apply options after closing the turn, and omitted the documented replay marker from an equality assertion.
Those fixture errors were corrected in this owner chat; all intermediate logs are retained.
The unselected-flight test's successful run remains valid and was not repeated when only the replay assertion changed.
The previous 62 target and 5 language tests remain valid; no production code changed during this verification follow-up.
These are actual kernel transactions with explicit candidate selection, not claims about model interpretation
of the English fixture inputs.

No full repository suite, App replacement, push or new paid natural call was performed.

## Owner verification and parent integration

Exact candidate files:

- `runtime/jev/candidates.ts`: internal selected-flight choice receipt attachment.
- `tests/extension/single-loop-candidates.test.mjs`: real RPC receipt chain and negative ownership/visibility guards.
- `docs/kernel-rpc.md`: local addition at section 135.2, "JEV-OPEN-03 choice binding".
- `docs/research/jev-open-03-breakpoint-20261006.md`: this evidence-bounded handoff.

Parent reviewed and locally merged repair `4893cbe83e295815e87181e5954cd8b2d499fb59` through
`daacf9e4c319736f481b0281a61479a23bebd0bc`. The owner verified that repair remains ancestral to current
main `b91cd53a4dbdd38e67f74dd5b58d7b1bf7258c54`, then fast-forwarded only the independent owned tree to
that exact source for the boundary checks. Shared mainline and original runtime state were not edited by this task.

The user's later direction in parent turn `01a10f42-9a07-710e-bda7-9312241f5c1a` requires each owner to
test only its changed functionality in the same chat. This supersedes the former 06 verification dependency.
The changed receipt-binding functionality is owner-verified with the prior valid source regressions and
the real refusal, replay and unselected-flight boundaries above. No additional production repair was needed.
Only this test file and this report changed during the follow-up; parent retains serial review/integration
of that verification commit.

Historical admission 400 origin and v32 natural-answer compile decisions remain unverified under current
source. They are preserved as historical unknowns, not reported as repaired or used to require unrelated
full-scenario play for this unchanged semantic classifier. No model call was needed for the changed functionality,
no budget was consumed or requested, and no admission rule was weakened.

Lifecycle: the working tree was created with `codex-worktree-lifecycle create`, task
`jev-open-03-20261006`, creation `2e7193ee-2845-4e77-8807-4e8143881449`. It is retained for parent integration.
An initial clean tree at `/Users/haoli/Documents/Codex/2026-10-05/task-9/jev-open-03`, branch
`codex/jev-open-03-20261006`, was mistakenly created directly before the lifecycle policy was located. It is
unowned, not adopted or removed, and explicitly retained pending parent disposition. No pre-existing worktree,
branch, WIP, log or running process was modified for cleanup.
