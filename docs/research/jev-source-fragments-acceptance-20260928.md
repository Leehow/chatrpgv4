# Original source context and incremental fragments — 2026-09-28

Status: source-reference integration implemented and source-to-action behavior verified. Whole-turn latency and packaged-App acceptance remain open.

## Engine correction (2026-09-28)

All Blood play runs reported below used `loop_engine: legacy`, as their campaign startup telemetry confirms. They are **invalid-for-acceptance of hybrid-v1** and cannot verify native tracked-mutation routing or its performance. Exact-source child operations and graph publication observations remain source API evidence. The owner has approved correcting and retesting the actual hybrid integration; see contract §149 and the active ticket tracker.

## Owner intent and scope

Players should start creating and playing quickly. Jev selects original source, the host copies it, and the foreground generates only the final guide. Small graph fragments publish independently in the background; incomplete coverage remains available through original-PDF access. Character choices remain advisory. Logical identities/links and campaign canon matter more than exact module prose/numbers.

Implementation baseline: `e47c4d4a50b2ed48f0f010f032c1ccfdd93eac87`, branch `0.9.6a`. `0.9.5a` is preserved. Prototype branch: `codex/prototype-source-fragments-20260928`, commit `178ab2c9fbf7a2353b0a6b1458f955721452f2ef`, files `experiments/source-fragments-prototype/`.

## Prototype to production correspondence

| Prototype behavior / adverse case | Production owner | Evidence |
| --- | --- | --- |
| Exact spans are copied, never retyped by a model | `runtime/jev/source-reference.ts`, native Pi source driver | exact-offset tests; real reference packets retain physical pages and source SHA |
| One final guide, no foreground graph or separate generated briefing | `extensions/module/source-reference.ts`, `content/setup/source-reference-guidance.md` | native Pi tool receipt and final guide; real setup Blood03 |
| Guide cannot enforce car/Driving advice | Jev material-issue check and setup text | Blood03 retained the player's basic Driving and confirmed the card |
| Source readiness is separate from full graph | private `module.reference.*`, existing generation owner | campaign created with reference readiness true and `opening_ready:false` |
| First useful fragment can publish before later fragments | two-page source units and existing read/finish pipeline | deterministic tests; live publication check pending below |
| Refused fragment does not revoke original source access | reference packet binding separate from graph review | prototype Masks refused causal fragment, later fragment still published |
| Missing physical place previously blocked movement | Jev heading candidate + original-page confirmation; minimum scene handle in existing graph | real source material probe 10.170 s, no generative calls |
| Unfinished NPC biography blocked a background fragment | source_unit retains explicit pending needs and keeps affected entity unready | regression checks partial publication and rejects false readiness |

## Measurements and adverse evidence

All generation uses Grok 4.5 / low. Jev calls and background work are accounted separately from Keeper generation. These single runs are observations, not latency guarantees.

| Run | Result | Boundary |
| --- | --- | --- |
| Checked Blood prototype | guide 18.672 s; first fragment 24.555 s; next 41.670 s | isolated source prototype |
| Checked Masks prototype | guide 17.047 s; causal fragment refused; another published 58.362 s | isolated source prototype |
| Production source smoke4 | guide 20.196 s | tool-enabled native source session |
| Integration4 | setup context 24.597 s; campaign created while graph incomplete | source/setup API, not gameplay |
| Blood01 | 157.8 s, repeated Jev 503, legacy visual fallback | failed native-path acceptance |
| Blood02 | stopped at 171.1 s after native timeout and legacy fallback | retry under-reservation plus Jev 520; failure retained |
| Blood03 setup | source guide 33.561 s; first complete player turn 47.7 s | real RPC setup; source guide used 8,762 input and 441 output tokens, one generative action |
| Blood03 confirmation | 11.0 s | normal card confirmation/handoff, no graph wait; separate play process startup not included |
| Blood03 play1 | 62.5 s; destination remained pending | failed first-action readiness; exposed typed-place seam |
| Blood04 play1 | 92.0 s; candidate rejected before original-page confirmation; adaptation/action-review delays followed | failed first-action readiness, not a source-speed pass |
| Original-place smoke | 10.170 s, typed station handle + raw source | source API; zero generative source calls; not player-turn timing |
| Masks production attempt1 | missed New York alternative | invalid for multi-opening acceptance; evidence retained |
| Masks production attempt3 | Lima and New York alternatives returned with final guide | corrected bounded candidate evidence; selected-opening continuation pending |

Evidence roots: `.pi/prototypes/source-fragments/` (source integrations, logs and retained failures), `.coc/playtests/jpdf-ref-blood-{01,02,03,03-play,04-play}/`, and `.pi/jpdf-ref-home-blood{01,02,03}/.coc/`. No campaign, source or failed attempt was removed.

Corrections follow observed causes: retry reservations now cover both allowed attempts; independent selection batches run concurrently under the existing cap; native entry checks retain optional prologue/main alternatives and enough original text; heading confidence admits a candidate for actual page confirmation rather than prematurely forcing old parsing. Scene handles copy source context without granting a move, person, stat or disclosure. Established graph identities are preserved.

## Validation frontier

Targeted typechecks, source-driver/reader/service tests, packet publication, pending fragment needs, exact-copy and system-language guards pass. Full regression and final live source consumption/publication results are recorded at closeout below. No GUI, package, deployment, whole-book completion or universal speed claim is made.

External cross-checks: TypeSafe's [pre-parsed extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook) and [semantic find](https://docs.typesafe.ai/cookbooks/semantic_find) support bounded selection with host-owned materialization; LlamaIndex's [retrieval and synthesis example](https://developers.llamaindex.ai/python/examples/query_engine/custom_query_engine/) confirms the separation of retrieval from final response generation. They do not establish this product's completeness or latency. [HTTP Semantics 503](https://www.rfc-editor.org/rfc/rfc9110.html#name-503-service-unavailable) supports bounded transient retry; it does not justify indefinite retries or ignoring failed retrieval coverage.

## Regression checkpoint

- Full extension suite: 3,795 / 3,796, 425.52 s. The sole failure compared three new private TS methods against the frozen historical vocabulary. Listed those methods in the existing currentOnly set; did not change the oracle.
- Full kernel/play suite: 2,022 passed, 386.85 s.
- After final source checker, campaign packet-copy and follow-up closure fixes: 182 targeted tests passed (real checker CLI, module publication/readiness, reader/service, setup choices, language, inventory and foundation). Full suites precede these last narrow fixes; targeted reruns cover the changed boundaries.
- Existing remote-heavy-test helper still force-checks out/cleans disposable remote worktrees outside the required lifecycle tool. Full suites ran locally, serially; no remote worktree was created and no package was built.
- Review target is all tracked/untracked implementation work since e47, using the code-review skill directly without delegates. Review checked writer → consumer → actor, source/campaign ownership, exact-copy binding, partial readiness and fallback boundaries. It found/fixed incomplete follow-up closure, campaign-copy omissions and the structural-checker/actual-delivery seam.
- Incremental smoke1 accidentally awaited the long-running pump before sampling; stopped only its owned processes and preserved the run. Smoke2 correctly sampled but no fragment published within 241.574 s; actual CLI errors exposed the missing-seen defect. Neither is a passing publication result.

## Incremental publication verified

`incremental-smoke3.log`: after the real source-checker fix, source fragment 15–16 published generation 3 at 83.738 s while fragment 17–18 remained active and index_complete remained false. The manifest contains eight newly ready entities and retains both source-reference materials. This resumed source API check ran alongside setup work; it is publication/liveness evidence, not a cold performance benchmark. Its old graph-only rollup labeled the still-incomplete opening blocked; reference mode now reports preparing until graph completion, while keeping reference readiness separate.

Masks selected-opening continuation completed in 18.425 s using the retained original packet, selected `source-entry-94`, and created the campaign at New York with reference readiness true while full opening readiness stayed false. No full graph was generated on that foreground path.

Blood05 reuses the library source cache: prepare-module completed in 0.363 s. Its single delegated full-card setup turn took 200.9 s and thirteen setup calls, including aptitude, occupation and Credit Rating argument repairs. This is not comparable to a guidance-only turn and is not a satisfactory overall creation latency result. Those existing card-authoring costs are outside the PDF parser correction and remain visible. The campaign confirmed basic Drive Auto 20 and completed handoff while background generation had advanced to 2.

## Real original-source consumption

Blood05-play: the Keeper issued `lookup kind=source source_mode=answer` about the gas station arrival/sign/people. The new source path returned ten exact excerpts in **6.166 s**, zero generative source actions/tokens. The same turn looked up the incrementally published `abattoir-arrival` and `esso-gas-station` scenes, then moved with actual receipts and delivered the original OPEN sign, old pumps, Nova and men under the awning. The whole turn still took **190.5 s**, including equipment definition, extra Keeper calls and NPC dossier waits; this is not a rapid whole-turn pass. The retained trace exposed that native tracked mutations skipped existing text landing. That boundary now admits original-context text landing through the normal operation receipt path, including multiple people in one unchanged batch. Its 24-test regression covers atomic multi-person landing, missing-text refusal, owned dispatch and publication; final continuation below verifies the current code.

Blood06-play (current original-source consumption, before final empty-graph routing correction): original lookup 4.176 s and reference preparation attempt 10.268 s, both zero generative source actions. Whole turn 59.8 s, destination still refused. The trace showed module lookup/adaptation treating absent partial graph content as an absent destination, and an existing unready scene failing to receive original-reference readiness. Both source-routing seams were corrected without overwriting existing source records. Failed continuation remains evidence; it is not a completed destination action.

Blood07-play: registering Mather General Store from original source completed in 7.517 s; the existing Esso identity was admitted from original source in 3.092 s. The Keeper nevertheless requested duplicate adaptation, and the 65.8 s turn did not arrive. The evidence identified a consumer defect: prepared scene identity was nested only in source_answer. The final result now includes standard material_ready/entities and exact scene name, while raw excerpts enter the existing carriedText consumer. Kernel module lookup also explains that partial graph absence is not PDF absence. This run remains a failed actor-consumption check, not a speed pass.

## Final actor consumption and closeout

Blood08-play used the current source reference contract. Module lookup returned the original-text Mather scene; source preparation returned material_ready plus the exact existing scene name. The Keeper applied move to that scene, established the source-named shopkeeper through ordinary state owners, resolved an ordinary check and narrated the arrival at the counter. Actual receipts include move:source-place-26-21-t4-c1, person and NPC receipts. The graph had no completed shopkeeper entity at the preceding lookup; ongoing gas-station dossiers remained background work. No full-store graph/dossier was needed for arrival.

The whole turn took **87.1 s** (six tool calls), including a **26.594 s** repeated scene/source preparation in this run. This is successful source-to-action behavior, not an acceptable universal end-to-end latency claim. Earlier simple original queries measured 4.176–7.789 s and made zero generative source calls. Keeper planning, card/schema repairs, equipment setup and other existing turn work remain visible bottlenecks. The final closeout does not claim a clean cold first-action benchmark or that all earlier JPDF performance gates passed.

Final focused validation after actor/routing changes: 142 tests passed; another 12 destination/starter/text-landing tests passed, 15 boundary tests passed, and the existing-unready-scene identity-preservation regression passed. TypeScript kernel checks and runtime build passed. The final code was used by Blood08-play and its daemon was stopped normally. No push, package, deployment, branch deletion or evidence cleanup occurred.

Known limits: scanned/no-bookmark/ambiguous sources can still use the slower original-page fallback; visual coverage in native packets remains explicitly unassessed. Whole-book background cost/coverage, GUI display and packaged-App behavior were not accepted by these tests. The intermittent kernel close diagnostic was retained without unrelated lifecycle changes.
