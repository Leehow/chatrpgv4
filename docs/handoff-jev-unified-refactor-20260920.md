# Jev unified refactor — continuation handoff

**Continuation update:** the user subsequently reauthorized the writer-budget repair, runtime build and integration regressions only. The unresolved writer/source/build paragraphs below describe the earlier stop point. The bounded closeout is now complete: final runtime build, 2209 extension cases and all 1608 current kernel/controller cases via verified segmented coverage. Read [the new acceptance handoff](handoff-jev-acceptance-20260920.md) for the actual next work; the original pending instructions below are historical.

**Stopped at the user's request on 2026-09-20.** The user will ask another AI to continue. Implementation, provider experiments and play are stopped. This document records the current dirty source tree; it does not mark the refactor complete.

用户要的是统一架构落地：原文通过位置引用恢复，Jev 承担有界的批量判断及工具内部循环，LLM 负责规划、叙事和新增内容。检索、规则、模组、记忆、兑现与 Pi 宿主必须接成一套。最后的指令是分票实现，可按任务使用不同模型，**Astra 只做主控和核心实现**。最新指令是写交接，让其他 AI 继续。

## 1. Start here

1. Read this document, repository `AGENTS.md`, `docs/active-plans/jev-unified-runtime.md`, and the last section of `docs/kernel-rpc.md` (§122). The master spec is `docs/specs/jev-unified-runtime-refactor.md`; ticket bodies are under `docs/specs/jev-unified-runtime-tickets/`.
2. Recheck status and preserve the dirty tree. Work only in `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2`, branch `0.9.4a` at this handoff. HEAD is `d9ad5fecda705a375b5078e15e4b3eecf3339e7f`. `0.9.4a` was verified as the latest `0.*a` line. No task changes have been committed or staged.
3. The terminal writer escrow defect described below has been repaired and verified in the subsequent closeout. Follow the new acceptance handoff rather than repeating this historical repair.
4. Source scope, publication crash recovery, cancellation persistence, final build and integration checks are now closed. The new handoff records the final source/build hashes and exact coverage.
5. Resume genuine play for T12/T13/T14/T15, preserving all old and adverse evidence. Update acceptance only for claims actually demonstrated. Existing bounded successes do not prove full product quality or latency.

The next AI should continue from the implementation, not create another competing architecture or reset the checkout.

## 2. Historical stop-point defects — resolved by the later closeout

### P1: terminal delivery tries to reserve a second future writer

`runtime/jev/task-host-session.ts` currently calls `holdWriter` in `tool_call` for `submit_plan_packet`, reads, mutations, **and `narrate`/`ask`**. Escrow is released/transferred into the next actual Keeper provider request. If dependent work consumed the unprotected budget, that already-funded writer can generate a valid terminal delivery, then its `narrate` is blocked because the hook tries to reserve another whole future-writer envelope.

The new regression is in `tests/extension/jev-writer-budget.test.mjs`, test **“a budget-limited task can still commit its already-funded writer delivery”**. The file contains seven tests, including non-waitable escrow, exact actual-payload charging, bounded result coverage, child ownership and terminal release. It exists on disk. The author reported this concrete defect and wrote the regression, then hit the service usage limit. **No passing final result exists for this file.** Root inspected the source after the stop request but did not run or repair it.

Candidate repair discussed: reserve future-writer room only for work that actually requires a following Keeper response; admission/review calls still pay their own real task budget. Validate narrate and ask, successful delivery, review refusal requiring another writer, cancellation and partial exhaustion. Do not simply exempt all delivery audits from accounting.

Root already releases held escrow before canonical `narrate` commit closure and before accepted mechanics `ask` closure. `TaskLease.reserve(spend, {waitable:false})` deducts reserved budget but excludes it from the capacity on which nested `reserveQueued` can wait; this prevents a child waiting for the writer that itself waits for the child. Default reservations remain waitable.

### Final source-owner correction is saved but not finally revalidated

The source-preparation agent found that actual TaskHost scope uses `owner: session:<sessionId>`, while an earlier source authority validator assumed `campaign:<campaign>`. Earlier deterministic fixtures had matched the incorrect assumption.

The correction **is present on disk**:

- `runtime/jev/read-set.ts` preserves a nonempty exact task-issued scope owner.
- `kernel-ts/modules/reading.ts` exports `sourcePreparationScopeMatches`, comparing canonical campaign/worldline/loop/audience; it does not invent a new owner.
- `kernel-ts/modules/index.ts` uses that scope comparison.
- `tests/extension/jev-source-preparation.test.mjs` now uses `session:source-preparation-contract`.

The agent's prior 63/63 integrated and 5/5 source reports precede this last correction. Rerun it, ideally through the actual public-host path as well as the kernel fixture. Exact task/root/operation/job/lease/publication identity checks must remain intact.

### Integrated source is ahead of the frozen live build

No new `npm run build:runtime` was run after the T15 handoff/replan/source-budget changes, final S2 setup selector changes and #99 package alignment. Latest live evidence is therefore from an older frozen build. Do not describe the existing `build/` or installed App as this final source.

The last root strict runtime/dispatcher typecheck and 38-case host/handoff/source group passed before the final writer tests/session-owner correction. Kernel typecheck passed before those final changes. Full `npm run test:ext` and the whole kernel/play suite have **not** been run on the final dirty tree.

## 3. Ticket state at stop

| Ticket | State | What the state proves |
|---|---|---|
| T01–T05 | Accepted bounded gates | Contracts, public SDK seam, SourceRef, lifecycle foundations, canonical dispatcher |
| T06/T07 | Accepted S2 boundary | Dependent real read-only loop and zero-Jev direct delivery; pinned adapter |
| T08 | Accepted functional source boundary | Fresh PDF navigation + original-page readiness + distant clinic consultation |
| T09 | Accepted bounded write/readers | Referenced memory publication, attribution, original spans and existing readers |
| T10 | Accepted bounded v5 read | Adaptive multiquestion retrieval with exact originals and explicit partial coverage |
| T11 | Accepted ordinary resolve | One real check through normal admission/Mods/kernel with exactly one receipt |
| T12 | Implemented, acceptance open | Base effects, finite fulfillment bindings/catalog/readers; real two-clue settlement and recovery; full mutation/reward gate remains |
| T13 | Not accepted | Long-gap, non-module promise → actual condition → correct reward join not played |
| T14 | Implemented families, acceptance open | Copy consumers and opt-in Jev verifier; semantic/live quality gates still open |
| T15 | Active integration, not accepted | Four missing owner joins implemented/tested in slices; final writer issue, whole-root checks and true play still pending |

The ticket manifest and ledger were behind the final hours of implementation. This handoff and §122 describe the latest state; status metadata should be reconciled without upgrading acceptance claims.

## 4. Architecture and code ownership map

No Pi fork/private SDK patch, second game truth store, Python production kernel, semantic regex classifier or new player action authority was introduced.

| Owner | Important files and behavior |
|---|---|
| Task lifecycle / host | `runtime/jev/task-{runtime,context,record,store,host-session}.ts`, `s0-rpc.ts`; one input, bounded dependent loop, cancellation, original deadline/budget, durable observations/identities |
| Canonical operations | `extensions/kernel/canonical-operation-dispatcher.ts`, `extensions/kernel/index.ts`; normal public tools, admission, Mods, kernel transaction and call-status recovery |
| Typed provider | `runtime/jev/decision-adapter.ts`, `question-packing.ts`; TypeSafe `jev-1.13.0`, closed Boolean/Choice questions; independent batches only |
| Source positions | `runtime/jev/source-ref*.ts`, committed-turn/speech modules; original immutable position resolution, duplicates stay distinct |
| Source consultation | `native-source-*`, `source-owner-operations.ts`, fresh-source-navigation/navigator; host-native text navigation, original visual owner for authoritative preparation |
| Memory write/read | `memory-*` in runtime and `kernel-ts/memory/`; exact conversation reports, attributed speech, raw Git fallback, bounded per-need selection |
| Ordinary rules/effects | `ordinary-resolve-domain.ts` v2, `ordinary-apply-domain.ts` v4, `domain-attempt.ts`, `table-evidence-domain.ts`; host-issued choices, canonical settlement |
| Promise fulfillment | `fulfillment-domain.ts`, `kernel-ts/runtime/{apply-operation,fulfillment-options}.ts`, `kernel-ts/memory/fulfillment-{receipt,view}.ts`; original finite terms + actual receipts; memory never pays |
| Nested model budgets | `provider-budget.ts`, lanes/subsession, module reader/reader-context, runtime/tasks, Mods and ReadingService; private IPC grant before child request |
| Writer room | `writer-budget.ts`, TaskHost; 32 KiB public plan packet, retained full private details, non-waitable future-writer allowance; outstanding defect above |

Runtime policies are pinned in read sets by each enabled family version, not only the umbrella table domain. Old saved decisions must not be reused under a new policy version.

### T15 exact incumbent handoff

- `TaskStep {kind:'handoff', verbs:['resolve'|'apply'], remainingNeeds}` produces optional `TaskResult.handoff`.
- A closed unsupported family or active subsystem can hand off before any typed mutation attempt. Unknowns/player choice/stale/cancelled/pending settlement cannot create a fallback.
- `TaskRuntime.beginIncumbent` / `completeIncumbent` retain the original lease, pending proposal and journal while actual public tool hooks execute once. Typed resubmission closes; only named verbs become active. A resolve+apply plan can hand both planned verbs over.
- Dispatcher `bindIncumbentScope` is forwarded by the actual kernel bridge. `bindKernelCallId` captures the real `takeCallId` result before its temporary map entry is consumed. No second call ID is minted.
- Existing-owner read calls remain scoped; review-refused delivery can return from auditing to composing for a legitimate correction.
- A settled typed mutation currently prevents initial handoff to another family. This conservative boundary is explicit; do not claim universal action coverage.

### T15 in-goal replan

- At most two replans, same input/root/deadline/budget. Plan-dependent keys use `:attempt:N`; original attempt keys remain unchanged for compatibility.
- Successful receipts remain globally visible. A resolve receipt survives a later apply-only retry.
- Recoverable actual refusal is narrowly `status=refused`, no receipts/unknown settlement, `coc_error.code=invalid_params`, `next=change_input`.
- `action_not_authorized` remains a genuine player boundary; no reword-and-resend workaround.
- Explicit semantic unknown may replan; missing provider answers do not silently become a useful replan. Unsupported required apply family goes to exact incumbent handoff.
- Identical revised plans and identical previously refused effect arguments stop with no progress.
- Mixed read+mutation plans now gather evidence before selecting the mutation. Evidence-phase keys count reads, excluding options/settlement, avoiding extra Jev rounds after evidence was already sufficient.

### T15 owned source publication

- Only a tracked mutation's actual `material_pending` response can invoke internal source preparation. No planner `source.prepare` capability is exposed.
- `runOwnedSourcePreparation` → kernel request before-fork binding → claim/job/lease → independently checked detail publication → exact `advanceSource` → original call retry.
- The authority includes original scope, task/root/op/call/module/job/lease/token and old/new source revision. Children can advance their own branch and ancestors, not siblings. World revision is not changed by this protocol.
- A first campaign source request can fork a shared module before finish; the code captures that chain and validates exact fork origin against foreign background publication.
- Answer cache publication changes bookkeeping only. `task_source_revision` excludes `meta.reading` and `updated_at`; legacy broad `source_revision` is unchanged.
- A failed/interrupted source job may leave real owner bookkeeping/fork state; it never receives an unearned blanket refresh. The task can honestly become stale.
- `_task_read_set` is a boolean in the original mutation payload. Source advancement does not change that saved call/payload. Retry reruns admission/Mod gates; changed prepared arguments still refuse.

### T15 provider and writer budgets

- `createTaskProviderBudget(lease,{record,changed})`; `LaneRequest.providerBudget`, `ReaderRequest.providerBudget`, `ReadingService.ensure(...,{providerBudget})`, `ModBridge.prepare(...,providerBudget)`.
- Child model metadata and finite input/output bounds cross a private Node IPC channel. Existing `reader-context.ts` public provider hook waits for grant. It reports real assistant usage; unknown/crashed usage retains reservation. No credentials cross this accounting channel.
- Important SDK behavior: `ExtensionRunner` catches provider-hook exceptions. Child denial must remain pending until parent kills the child, rather than throw and let an unchanged provider payload escape. Tests cover no-dispatch denial.
- `reserveQueued` accepts a caller signal and charges all ancestors. Overrun cancels root and records debt. Main Keeper hook is a separate accounting owner, not double-charged.
- Map/document warmers are background. Character/UI presenters are independent setup workers. Runtime standalone owners have finite separate budgets; an explicitly budgeted unsupported custom reader command refuses before launch.
- Root current defaults: 15-minute absolute total deadline (configured positive ms, maximum one hour); original two-minute inactivity watchdog remains independent. Source/resolve/apply/memory-read enabled tasks start with 1M input /128 actions, plain read tasks 250K/32; all have 150K output/$10. No retry renews these.
- Local pinned Grok 4.6 metadata was checked: API `openai-responses`, context 500K, max output metadata 500K, input/output rates 2/6 per million. Requests are capped at 8192 output. Multimodal nested reservations conservatively use declared context size. This is accounting, not a latency or pricing guarantee outside the pinned environment.
- Root writer estimate uses last actual request bytes + actual assistant bytes + 32 KiB result +16 KiB envelope. Exact next request must still fit; it is not an arbitrary-context guarantee. Fix the terminal second-escrow defect before accepting this.

## 5. T12 fulfillment boundaries

- `table.apply.options` privately binds all eligible current promise occurrences, not just recent NPC rows.
- `table.fulfillment.options` and `table.fulfillment.prepare` are read-only catalogs/preparation. Models see issued semantic aliases, not snapshots, coordinates, receipts or IDs to copy.
- Jev independently judges requested reward, actual condition support, due status, finite coverage and fixed-total versus rate/formula. All terms must be accounted for, including deferred terms.
- Kernel source refs validate original Git text/typed receipt scalar values, promise occurrence, canonical payer/beneficiary/currency/object, scope, complete coverage and unchanged prior terms.
- Canonical normal `apply` attaches fulfillment metadata to its actual effect receipts. No reward side store or memory mutation pays money.
- Prior partial fulfillment reuses immutable terms/digest. Cash uses exact decimals; 0.1+0.2, overpay, independent promises, duplicate retry and correction cases are covered.
- Physical gifts require explicit willing `handover:'given'`, preserve object instance/definition/quantity/ammo/condition, and use current ownership. A paid gift later moved/consumed does not block remaining cash.
- Partial stack creation is outside the bounded typed catalog; requested transfer quantity must equal the current instance quantity. Existing canonical split history is supported using new private `divided_from_instance`, preserving old display-name `divided_from`.
- Derived fulfillment status is shared by obligations, NPC history, recall, memory evidence, continuity and cross-line readers. Old promises/memory text are not rewritten. Stranded retained effect receipts count for payment accounting even without a delivered narration commit.
- Rate/formula rewards, unbound word-only numeric amounts, missing identities/terms or oversized evidence remain explicit unsupported/partial. The existing live Knott promise is **per-day**, not a fabricated finite-total test reward.
- Still required: genuine many-turn non-module promise/reward gate, including actual task condition, return, source recall, correct one-time payment, repeated request and reader consistency. No fixture may stand in for T13.

## 6. T14 copy consumers and #99 alignment

| Family | Implemented behavior | Validation / remaining gate |
|---|---|---|
| Continuity audit | New `audit.continuity.v2`; all copied claims/evidence/speech/locus/reentry select occurrence aliases; host materializes canonical v1 accepted shape; raw v2 retained | Core/host/legacy/kernel conformance passed. Actual v2 semantic/live gate remains. Existing locked v1 campaigns remain v1 |
| Post-delivery verifier | `PI_COC_JEV_VERIFIER=1`; six existing advisory findings; exact source quotes; one budgeted incumbent fallback | 45-case focused gate reported. Paired semantic quality/live gate not done; incumbent not globally retired |
| Character/map/UI presenters | `presentation-reference-v1`, keep/translate + protected occurrence aliases; host restores unchanged strings | 110-case combined gate reported; actual provider fidelity/live gates remain |
| Document presenter | Separate title/body source aliases even for identical strings; keep exact CRLF/Unicode; player-edit bypass | Same combined gate; live semantic gate remains |
| Setup guidance | `setup-guidance-reference-v2`; host-selected scene, issued guide alias; generated opening/advice/handoff | Four starter seeds actually regenerated by tool-enabled Grok author + independent review, all approved; 57 extension +7 starter kernel gate reported |
| NPC journal | New `journal-reference-v2`; recordable person aliases, exact source identity, generated descriptions/exchanges | 18 +2 focused tests reported; real journal live gate remains |
| Setup input | `setup-input-reference-v1`; actual Pi user text fields and pending current input; whole-field/grapheme aliases; exact name/pending action with private provenance | 21 host/pure/real-kernel tests reported. Legacy/UI confirm/replay preserved; fresh real setup after this change not run |

Raw equality does not select the first matching occurrence. Host owns epoch/hash/offsets; models never type them. Generated text remains generated, not misrepresented as source. Ambiguous/omitted/stale sources fail explicitly.

Changed packages now on disk:

- `narration-audit` **1.2.30**, v2 references, state version unchanged.
- `keeper-pacing` **1.3.0**, selected goal/real decision boundary in full and brief.
- `narration-craft` **1.3.0**, old mandatory new event/multiple-options floor removed.
- `npc-voice` remains **1.2.0**, already compliant with direct answers and natural closure; no artificial bump.

The #99 assembly test uses the real kernel to check full/brief, enable/disable and exact package bytes. Default active brief total is **4,984/5,000 UTF-8 bytes**. Focused 14/14 passed. Broader 36/39 run had three NPC-voice temp-bundle failures resolving `typebox`; these were not fixed or suppressed. Do not call the full suite green.

The separately specified pacing A/B is still required by `docs/specs/keeper-pacing-decision-boundaries.md`: actual before/after behavior, at least two paired new campaigns, counterbalanced order, real player, matched boundaries, per-goal counts and no autonomy regression. Existing old A/B worktrees/processes were not inspected as owned evidence or modified in this task.

## 7. Retained real evidence

All paths below are relative to this repo. JSON files point to raw turns/telemetry/tasks. Keep adverse runs too. Costs shown in old evidence are Jev estimates, not provider billing receipts or whole-root costs.

| Gate | Evidence / useful result |
|---|---|
| S0 | `.coc/playtests/jev-s0-live-20260920/s0-evidence.json` |
| S2 loop | `.coc/playtests/jev-s2-live-05-20260920/s2-evidence.json`: turn6 dependent loop 4 batches/20 questions, 48.665s, commit `4ede2b4`; turn7 zero-Jev direct 27.808s, `6d05c2a`; unpaired |
| Existing graph source | `.coc/playtests/jev-source-live-20260920/source-evidence.json`: distant clinic page32, hours, no material preparation; 39.777s |
| Fresh PDF setup | `.coc/playtests/jev-fresh-setup-02-20260920/fresh-navigation-evidence.json`: 111 pages, 101 classified/10 empty; minimal skeleton then independently read/reviewed opening; 399.6s unpaired |
| Fresh distant clinic | `.coc/playtests/jev-fresh-live-02-20260920/source-evidence.json`: original page32 answer, 61.054s whole/11.841s lookup, commit `5b0d260` |
| Memory exact write | `.coc/playtests/jev-memory-live-03-20260920/memory-evidence.json`: turn10 attributed Knott promise `mem:t10-48`, 139 questions, three uncertain segments remain pending |
| Memory existing reader | `.coc/playtests/jev-memory-live-04-20260920/memory-reader-evidence.json`: turn11 capsule obligation correct, commit `ac91588`, no payout |
| Adaptive memory v5 | `.coc/playtests/jev-memory-read-live-04-20260920/memory-read-evidence.json`: turn16 exact earlier preference + full conditional promise; explicitly partial, commit `9dadcdc`; 81.5s whole, no speed claim |
| Real ordinary roll | `.coc/playtests/jev-resolve-live-20260920/resolve-evidence.json`: fresh02 turn2, STR15 roll98 fumble, one `roll:str-t2-c1`, commit `41788b4`; 54.1s whole |
| Real base apply, timeout | `.coc/playtests/jev-apply-live-03-20260920/apply-evidence.json`: turn19 two clue receipts actually settled; old absolute120s task ceiling killed productive review before delivery; retain receipts |
| Recovery + new adverse case | `.coc/playtests/jev-apply-live-04-20260920/apply-evidence.json`: turn20 commit `2d37bc3` delivered prior briefing with no repeated apply. Turn21 commit `84a36b7` has departure prose but canonical office location/no move; unsupported catalog + `task_not_planning` drove T15 closure |

Earlier apply v1/v2, memory-write v1/v2, memory-read v1–v4 and source-navigation v1 trials remain under their respective run directories. Do not discard them or silently replace their quality conclusions with later success.

Independent bounded review reports: `.tmp/team-lead/jev-t08-final-review.md`, `jev-t09-core-review.md`, `jev-t10-final-review.md`, `jev-t11-final-review.md`. T15 original gap audit is `.tmp/team-lead/jev-t15-owner-audit.md`; its findings explain the last edits, not the current all-fixed state.

`.coc/playtests/jev-source-preparation-contracts`, `jev-fulfillment-options-contracts` and similar directories explicitly contain **deterministic contract fixtures**, not real play. Their scripts mark them accordingly.

## 8. Resume mechanics, flags and validation

Main ongoing campaign: `jev-s2-20260920` under the normal repo home, investigator Thomas Hayes; latest committed turn21 is still canonically at Knott's office. Last task-owned driver `jev-apply-live-04-20260920` was stopped successfully (two inputs, eight tool calls, 137.7s). No task-owned driver, Node test or typecheck was running at the handoff process check.

Fresh source campaign: `jev-fresh-02-20260920` under alternate home `.coc/playtests/jev-fresh-home-02-20260920`, investigator Kevin Hull (Chinese player name in save). Preserve the home override when continuing it.

The process check saw two unrelated old daemons in `.pi/worktrees/pacing-ab-a` and `pacing-ab-b` (`pacing-road-a2`/`pacing-road-b2`, PIDs 92084/91984 at check time). Ownership was not established. They were **left untouched**. Recheck, do not blindly kill or adopt them.

If a host continuation guard requires `session.resume`, call it first with the exact root/campaign. Installed coc-keeper MCP currently targets a legacy save schema and returns `unsupported_save_schema` for this TS campaign. That refusal is expected; never restore old Python/plugin state to satisfy it. Current `bin/pi-coc` + driver owns the actual product continuation.

Transport-only helper: `.tmp/team-lead/start-jev-s2.mjs <run> <campaign> [setup]`. It loads the already-authorized TypeSafe credential privately from this task's retained user message and passes `TYPESAFE_API_KEY` only in child environment. It prints no key. No key is in this document. If moving machines/tasks makes that source unavailable, obtain a protected environment credential; do not copy secrets into source, notes or logs.

Flags inherited by the helper include `PI_COC_JEV_SOURCE`, `PI_COC_JEV_MEMORY`, `PI_COC_JEV_MEMORY_READ`, `PI_COC_JEV_RESOLVE`, `PI_COC_JEV_APPLY`. It sets `PI_COC_TASK_RUNTIME=1` and real Keeper `xai/grok-4.6`. Verifier has separate `PI_COC_JEV_VERIFIER=1`. Last apply run enabled memory-read/resolve/apply but disabled memory-write/source. Choose and record flags explicitly for the next gate.

After the user authorizes continuation, suggested first commands (not executed after the stop):

```sh
node --test tests/extension/jev-writer-budget.test.mjs
node --test tests/extension/jev-source-preparation.test.mjs tests/extension/jev-owner-handoff.test.mjs tests/extension/jev-in-goal-replan.test.mjs tests/extension/jev-provider-budget.test.mjs
npm run check:kernel
npx tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --skipLibCheck runtime/jev/*.ts extensions/kernel/canonical-operation-dispatcher.ts
```

Then the relevant family regressions, shared build and genuine driver. `npm run build:runtime` requires no active consumer. Python controllers use `uv run --frozen python`; never run two pytest jobs concurrently. Test counts reported separately above overlap—do not sum them as unique coverage. Ad-hoc broad extension typechecks also reach older declaration errors; use actual package checks and distinguish new failures.

True-table acceptance is only `tests/play/driver.py` → current `bin/pi-coc` (setup via `bin/pi-coc-setup`), configured Grok Keeper, main controlling AI as the sole natural player, one sentence/turn at a time. Read the actual response before choosing the next input. Use `tests/play/kpi.py` for retained metrics. Do not use fixture effects, scripted players, synthetic Keeper output or a batch payment script as T13/T15 evidence.

## 9. Remaining completion queue

1. Close terminal writer escrow regression; recheck source session-owner correction and root budget/provider dispatch integration on final source.
2. Review exact current diff and run appropriate focused/broader checks; build a frozen current runtime. No App package/restart is part of this task's granted delivery.
3. Real base apply/handoff/replan/source-preparation gate: revisit the retained failed move as a natural continuation, require actual move receipt and consistent narration, no duplicate prior clue receipts. Test exact specialized owner without a global fallback.
4. T13: establish/retain an actual non-module finite promise in normal play; meaningfully leave it behind, satisfy real conditions, return, retrieve original terms, settle once, and verify all promise readers. Do not relabel the existing per-day promise as finite.
5. T14: actual v2 audit/new journal/setup/presentation semantic gates; paired opt-in Jev post-delivery verifier quality/cost/latency against incumbent. Unchanged copy fidelity tests alone do not validate judgments.
6. #99 genuine paired A/B and enable/disable coverage per its own spec. Do not reuse old unrelated A/B runs without verifying ownership, controls and actual source/package versions.
7. T15 old/new campaign compatibility, restart/cancel/lost-settlement, source/module/memory freshness, whole-root provider accounting, outage/partial writer behavior, paired performance and player experience. Report adverse results and any unsupported route as limits.
8. Only then reconcile tickets, retirement switches and rollout. No blanket “Jev faster” claim from atomic classifier medians. No completion claim from file count/tests/report alone.

## 10. Preservation and delegation

- Production is `kernel-ts/`; existing Python oracle is frozen historical test evidence. Do not recreate retired Python production paths.
- Keep `.coc/campaigns`, `.coc/modules`, `.coc/playtests`, task records, raw/accepted artifacts and telemetry. No clean/reset/stash/restore, worktree deletion or blanket staging.
- No task commit, push, package, App restart or remote ticket publication occurred. Local tickets are the current tracker; parent #101 is the design reference, #100 historical, #92–#98 external KIC references, #99 pacing dependency.
- Astra root owned shared runtime/dispatcher/integration. Astra core helpers owned audit/kernel/fulfillment/source/budget slices; Sol owned bounded integration tests and non-core Mod alignment. Core helper IDs in the old session were `/root/audit_core`, `/root/fulfillment_catalog_core`; Sol `/root/task_runtime_tests`. They are not assumed available to a new AI.
- The last core helper hit its provider usage limit before its writer audit final answer. Its file edits/test file are retained; this is not a reason to redeem credits or retry automatically after the user's stop.
- An earlier scratch feasibility report `.tmp/team-lead/jev-t12-fulfillment-binding.md` was overwritten by a test handoff, then that handoff copied to `jev-t12-apply-tests.md`. The original scratch report was not reconstructed. Normative §122 and implemented contracts remain; no campaign evidence was lost.
- `.tmp/team-lead/jev-current-state.md` is stale. Use this handoff, current source, original evidence and the normative spec/contract instead.
