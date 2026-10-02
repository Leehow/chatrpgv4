# Pi 1.0 compatibility upgrade

## Objective and acceptance

Upgrade the product's single vendored Pi authority from 0.87.0 to the published
1.0.0 tag. Preserve the four reviewed patches, seven Keeper verbs, sequential
state changes, source-reader tools, profile isolation and append-only evidence.
Accept only after published-source/build identity checks, extension and driver
regressions, focused Electron send-path checks, and real setup/play/reader smoke
runs. Packaging and installed-App acceptance are separate work.

## Approved scope

The user approved the first batch on 2026-10-02: upstream reliability fixes,
input disposition, provider-stream observation and native tool error results.
Do not enable codemode/MCP, replace the battle Jev adapter, switch models or
credentials, or redesign image generation or virtual-model routing.

## Ownership and current state

- Integration target: `0.9.6a`; starting commit `1e66f190dd4ea0620fb1c914243190eb8d96025b`.
- Owned worktree: `codex/pi-1-upgrade-20261002`, lifecycle task `pi-1-upgrade-20261002`.
- Preserve the unrelated dirty main-checkout blood-road playtest plan.
- Upstream: `v1.0.0`, commit `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`.
- LAN probe selected idle leehow-pc WSL; heavy checks run there, live play on Mac.

## Ready steps

1. Amend the host contract, import the exact tag and rebase each patch separately.
2. Synchronize dependency graphs and build resources; adapt only required host seams.
3. Verify the unpatched published sources/emitted JS and the patched lifecycle.
4. Run the scoped regression gates and live setup/play/reader checks.
5. Review and integrate into the latest mainline, preserve evidence, classify worktree closeout.

## Evidence and decisions

- Research compared upstream 1.0 release, package changelogs and source with the
  current product. Upstream still has automatic continuation; our RunDriver and
  both watchdog patches remain required.
- Upstream classifier Score omits distributions/legend and question descriptions
  are strings; the product's richer Jev adapter remains authoritative.
- The four patches replay from published 1.0 source maps and reproduce the vendored files exactly.
- All 241 unpatched source/JS modules match the published release byte for byte.
- Runtime build passed on leehow-pc WSL and was fetched to the Mac. Compiler 5.9.3 still emits the published JS; no compiler upgrade was needed.
- Focused Pi compatibility: 9/9. Electron queue/send/auth/telemetry: 119/119. Backend and kernel typechecks passed.
- Full extension suite is running remotely. Real Grok setup smoke has started in an isolated profile.
- npm shrinkwrap does not guarantee top-level dependencies for the vendored build. Root production pins match the upstream coding-agent dependency list; unrelated dependency families are not intentionally upgraded.

## Live acceptance status

- Grok setup run `pi1-setup-smoke-20261002` reached the real 1.0 provider path,
  then failed with HTTP 403: no credits or subscription. It was stopped and
  retained; zero tools and empty delivery do not count as setup/play acceptance.
- The user was asked whether this smoke may use the currently configured
  Flapcode gpt-6-astra/low instead. The answer is pending; no alternate model
  has been used and no product default has been changed.
- Dependency layout was cross-checked against npm shrinkwrap documentation
  (https://docs.npmjs.com/cli/v11/configuring-npm/npm-shrinkwrap-json/) and Node
  module resolution (https://nodejs.org/api/modules.html#loading-from-node_modules-folders).
  The published CLI tree may stay nested; vendored sources resolve bare imports
  through their own ancestor node_modules, so their direct dependencies must exist
  at the product root with the pinned upstream versions.

## Baseline classification

The full extension run reported `keeper-prose-contract.test.mjs:21`, requiring
the old Narration Craft sentence "Answer the actual question first, with natural
connected speech". Running that same six-test file on both original `0.9.6a`
and the upgrade worktree gives the identical one failure and five passes. Neither
the test, prompts nor Narration Craft is changed by this upgrade. It is a
pre-existing out-of-scope assertion; do not mask it or edit the craft guidance.

## Remote snapshot interference

The first ext invocation is invalid-for-acceptance: the remote lockfile changed
from local e0415b32988e3565fafa1e3631224d5ed9ae4184511d473c8a3e0433f692289e
to 643dd9da6f032ebeac3d00dcc63e55842e0bd5f4f8ea7fd576a1a86af6ef399b, and its log
was unlinked while its Node test process (PID 521, started 20:34 remote time)
remained alive. Its open log was rescued through /proc/521/fd/1 into
.coc/playtests/pi1-upgrade-validation/remote-ext-interrupted.log before stopping
that exact task-owned test process. A different test process belongs to the
speech-edit checkout and is left untouched.

The task-local symlink /tmp/pi-1-upgrade-20261002 selects a unique remote basename
for the existing test helper; it is not a new Git worktree. Wait for the box to
be idle, refresh the exact locked graphs, then rerun through this alias and
verify source/lock digests before and after. Do not change the shared helper.
The Spending Level assertion from the invalid run passes on both local trees;
it is not classified as an upgrade regression or a baseline failure.

## Authorized live model

The user explicitly directed on 2026-10-02: use Flapcode GPT Luna for tests,
not Grok. Use the current catalog model `flapcode/gpt-6-luna`, low, for setup,
Keeper and tool-enabled reader smoke. This supersedes the pending Astra proposal
and the default Grok test model for this task; product defaults remain unchanged.

- Luna setup is live and has reached the setup tool twice, asking for the authored
  starter choice. The main session answered naturally: classic The Haunting.
- Luna tool-enabled reader smoke passed: real read and write calls, exit 0,
  summary and exact source quote in result.json; events/request/exit are retained.
- The box became idle, dependencies were refreshed, and the driver regression
  suite is running under the unique remote basename pi-1-upgrade-20261002.

- Exact-snapshot driver regression: 187 passed, 1 skipped, exit 0, 48.23s suite
  time on leehow-pc WSL. Raw log retained at
  .coc/playtests/pi1-upgrade-validation/remote-py.log. Both private and shared
  lock digests matched e0415b32988e3565fafa1e3631224d5ed9ae4184511d473c8a3e0433f692289e.
- The second full extension invocation uses the unique private directory. During
  the run, its admission source digest matched the local file and both lock
  digests still matched. The first full invocation remains invalid.

- Valid full extension run: 4261 passed, 1 pre-existing Narration Craft assertion
  failed, 4262 tests, exit 1, 550s. No new upgrade failure. The private lock
  digest and admission source digest still match local. Shared dependencies were
  refreshed again after the run; check their mutation time against the final log
  time before attributing that change to the test window. Raw
  output retained at .coc/playtests/pi1-upgrade-validation/remote-ext.log.
- Luna setup completed card confirmation through 11 actual setup tool calls
  across five natural inputs, with zero tool errors. Its process was stopped;
  play is now running under the product default hybrid-v1 engine and Luna/low.
- A main-checkout blood-road driver is active on the existing runtime. Preserve
  that owner: source integration may proceed only on non-overlapping paths;
  do not replace its build or node_modules while it is using them.

- The late vendored-source identity, patch replay, emitted-JS identity and
  one-copy gates all passed in the valid ext run. The shared pi-ai package was
  reinstalled at epoch 1790947116, 50 seconds after the ext log finished at
  1790947066; this is subsequent shared-box work, not a failure of the private
  source snapshot. Do not claim the shared lock was unchanged afterward.
- Luna play turn 1 delivered normally in 46.9s through apply and narrate.
  Continue with one natural movement/inspection turn, then stop the smoke.

## Flapcode lane acceptance gap

KPI inspection after two delivered play turns found existing zero-tool and
budgeted-child calls rejected by Flapcode with 400 Unsupported parameter:
max_output_tokens. The provider extension strips it only through the session
hook, while boundProviderRequest writes it for every output-capped request.
This affects memory, journal, voice, NPC generation and map projection. Main
Keeper and the unbudgeted read/write smoke succeed, so they are not proof of
these budgeted paths. Whole-lane acceptance is incomplete.

A scope extension was requested: declare the provider transport limitation and
reserve the model output ceiling on uncapped transports, refusing an insufficient
owner budget. Never strip a field while claiming the removed 8192-token wire cap
is still enforced. No budget-code change has been made while the answer is pending.

- Upstream 1.0 already exposes `compat.supportsMaxOutputTokens` in the model
  schema. Use that native capability for the proposed transport declaration,
  not a provider-name branch or a fifth Pi patch. The host output-room/budget
  helpers must respect it because their payload callback runs after API body
  construction. Small owner budgets remain too small for an uncapped 128k-token
  Luna request; do not silently enlarge those owners.
- External precedent: OpenAI Codex issue 31181 documents the same relay 400 and
  native Responses omission, while issue 36180 notes the proxy default can
  truncate omitted output limits. Their uncapped request behavior does not
  establish our stronger nested-lease accounting guarantee.

## Approved scope extension

The user explicitly approved the Flapcode transport/budget repair on 2026-10-02:
use the native supportsMaxOutputTokens capability, omit unsupported fields,
reserve the full model output ceiling for uncapped transports, and do not
dispatch when the existing owner cannot fund that bound. Do not automatically
enlarge per-lane budgets. Verify both a funded Luna request and a pre-dispatch
insufficient-budget refusal.

- Approved Flapcode repair implemented without raising any owner budget. Native
  capability survives model composition, uncapped wire payloads omit the field,
  and parent IPC rejects an under-reservation. Google signals and capped APIs
  retain their existing behavior. Targeted budget/reader/reasoning/real-HTTP
  conformance: 51/51 passed. Kernel typecheck passed. Rebuild and funded live
  Luna lane/child probes remain before source integration.

- Real funded Luna zero-tool request passed with actual usage; an 8192-token
  owner was refused before dispatch with task_budget_exhausted.
- The real budgeted child made three successful requests, each reserving 128k
  output, and settled known actual usage (250 output tokens total). Its quote
  normalized a source line break, so it is transport evidence only. A final
  explicitly shaped read/write/bash-verification attempt retains the raw events.

- Final budgeted Luna child passed: read/write/bash observed in retained raw
  events, physical-line quote byte-exact, 4 calls, known usage, zero unknown
  charges. No owner ceiling was changed outside this explicit finite probe.
- Full extension suite after the budget repair: 4265 passed, 1 unchanged
  baseline failure, 4266 tests, exit 1, 717s. Raw log is
  .coc/playtests/pi1-upgrade-validation/remote-ext-after-budget.log.
- Vendored source/build identity and lifecycle checks rechecked: 9/9 passed.
  Ready to commit and integrate source; primary runtime replacement remains
  gated on the active blood-road owner releasing its old build/dependencies.

## Integration refresh

Mainline advanced to b3bf7ed999fe50383741f103a749cd83dca5b2ce while validation
ran. Its committed changes include purchase settlement, textual tool recovery,
history queries, the repaired Narration Craft assertion and a fifth Pi patch
0005-keeper-call-cap-first-answer.patch. Preserve those commits; integrate them
into this branch and replay/review the fifth patch on 1.0 before landing. The
prior suite totals describe the initial base, not the combined final tree.
The dirty blood-road plan and untracked Chinese-expression spec remain foreign.
