# 回合事件、人物认知与公开表达

Status: ready-for-agent
Date: 2026-10-13
Scope: spec only; implementation has not started.
Baseline: 当前主线 0.9.7a，HEAD c9df4d27b；按包含现有未提交修改的源码核查，不代表已安装 App 状态。
Owner direction: 复用现有内核与 output，分开保存每轮事件、世界和 NPC 影响、各自知道什么、未执行意图；output 只接收允许玩家看到的材料。

## Problem Statement

玩家希望自己的行动在世界中留下持续、可理解的后果：一件旧事影响 NPC 这次的判断，一次检定改变具体局势，一个秘密只被实际接触它的人知道，一个尚未实施的打算不会被当成既成事实。续局之后这些关系仍然成立。

当前产品已有规则结算、世界事务、NPC 收据账本、带归属的记忆、玩家所知投影和独立 output 写作者。缺口在它们之间：事件的因果、世界后果、人物心理及关系变化、获知过程和待执行意图分散在不同路径；一些语义变化仍依赖交付后的正文抽取。表达材料的 keeper 标记只控制写作者输入，不自动提供持久状态。现有 attempted 意图代表已经尝试或正在进行，不能忠实承载尚未行动的计划。

只增加一个总结 JSON、把完整秘密交给写作者再要求它保密、或在正文之后猜测全部后果，都不满足本需求。成功必须表现为后续回合真正读取并使用这些记录，且不越过人物认知、玩家行动授权和内核数值权威。

## Solution

保留 KP 的语义判断、Jev 的证据筛选和封闭判断、内核的规则算术及事务、output 的表达分工。在现有 apply 效果批上提供事件记录能力，将非数值语义变化与已结算收据关联；在既有回合记录上形成可重建的分栏结果视图。世界影响仍由原效果写入，新增语义记录不成为第二套伤害、物品、位置或时间引擎。

每个世界内回合分开呈现：发生的事件、世界影响、NPC 影响、认知变化、意图变化、披露情况。一个回合可以有多件事件，也可以只有对话或观察而没有世界数值变化。缺少某类变化就保留空集合，不为填字段制造剧情。纯 OOC 不产生虚构事件。

KP 从当前状态、相关历史、人物目标与认知、玩家行动和剧本依据形成判断；需要时通过原规则路径结算。剧本后续是可选依据，检索相关性不是剧情触发或披露授权。KP 记录成立的结果和待发生事项，再显式选用 output 实现允许公开的材料。公开交付成功之后，原 publication owner 记录实际表达的内容及其披露后果。

以下示例仅用于解释行为，不是产品内置剧情：门卫因为过去受过帮助而允许玩家进入。开门和通行条件由世界效果记录；本次合作及其原因属于事件和有方向的关系影响；“里面没人”是门卫对指定听众说的话，不自动变成世界真相；仓库里实际有人可以继续保密；门卫打算稍后报告主管属于 planned，主管尚未因此知情。

## User Stories

1. As a player, I want my declared action to produce consequences within its chosen scope, so that the Keeper does not decide a different action for me.
2. As a player, I want earlier shared events to affect an NPC's later response, so that relationships have continuity.
3. As a player, I want possessions, position, resources and time to follow settled results, so that prose cannot silently change the game.
4. As a player, I want an action that needs no roll to remain playable, so that every interaction does not become a check.
5. As a player, I want a failed or partial action to have its actual consequences retained, so that a retry does not erase history.
6. As a player, I want NPC statements to retain their speakers, so that a lie or mistaken report does not become objective truth.
7. As a player, I want hearing a statement to remain distinct from believing it, so that my character's interpretation stays open.
8. As a player, I want my private thoughts and unshared writing to remain private, so that nearby NPCs do not acquire them automatically.
9. As a player, I want secrets to be absent from the author's input until disclosure is allowed, so that output does not reveal backstage information.
10. As a player, I want familiar information to be recalled with its source and uncertainty, so that a summary cannot strengthen an old claim.
11. As a player, I want a quiet or conversational turn to be recorded without invented progress, so that pacing follows the situation.
12. As a player, I want the scenario to remain a reference that responds to my choices, so that retrieved future scenes do not force a route.
13. As a player, I want a pure OOC question to receive the existing direct reply, so that it does not advance time or fictional events.
14. As a player, I want mixed OOC and story replies to stay separate, so that hosting explanations do not enter NPC dialogue or memory as events.
15. As a player, I want failed writing to retry the same settled result, so that dice, money and items are not processed twice.
16. As a player, I want a resumed campaign to preserve consequences and knowledge boundaries, so that restarting does not create amnesia or omniscience.
17. As a Keeper, I want a current result view with events, world effects, NPC effects, knowledge changes, intentions and disclosures in separate sections, so that I can reason about each accurately.
18. As a Keeper, I want event causes to refer to supplied history, source evidence and actual receipts, so that the causal account can be inspected.
19. As a Keeper, I want several effects to belong to one event and several events to belong to one turn, so that the record follows the fictional interaction.
20. As a Keeper, I want mechanical effects to retain their original owners, so that recording an event cannot override a roll or resource calculation.
21. As a Keeper, I want directed relationship changes to name their subject, counterpart and supporting event, so that cooperation is not assumed to be reciprocal.
22. As a Keeper, I want current mood, lasting relationship and factual knowledge to remain distinct, so that a temporary emotion does not rewrite a person's history.
23. As a Keeper, I want each knowledge change to name its recipient and acquisition evidence, so that mentioning a person does not make them a hearer.
24. As a Keeper, I want a false belief to coexist with a different world fact, so that NPC decisions can follow their own understanding.
25. As a Keeper, I want planned intentions to remain separate from attempted actions, so that a future plan does not consume time, resources or a combat turn.
26. As a Keeper, I want an intention's execution to use ordinary guarded actions, so that a plan cannot grant itself permission to happen.
27. As a Keeper, I want intentions to retain done, failed and abandoned outcomes, so that an already resolved action is not offered again as unfinished.
28. As a Keeper, I want intent conditions to be remembered without automatically forcing their execution, so that circumstances and player choices still matter.
29. As a Keeper, I want references to use issued semantic names, so that I do not copy hashes, receipt ids or storage paths.
30. As a Keeper, I want missing or conflicting evidence to remain explicit, so that retrieval does not convert uncertainty into authorization.
31. As a Keeper, I want current canonical semantic changes to be readable before background memory extraction completes, so that the next decision does not depend on a lane finishing.
32. As a Keeper, I want older candidate memories to retain their original attribution and authority, so that introducing the feature does not rewrite past evidence.
33. As a Keeper, I want disclosure preparation to remain private and repeatable, so that checking a draft does not teach anyone a secret.
34. As a Keeper, I want an undelivered utterance to remain pending, so that its intended audience has not already heard it.
35. As an output author, I want only permitted propositions, visible circumstances and expression guidance, so that I can write without access to unnecessary secrets.
36. As an output author, I want NPC speech as meaning, speaker, audience and stance, so that I can produce natural wording without inventing new commitments or facts.
37. As an output author, I want required material to remain present or fail preparation explicitly, so that a context budget cannot silently remove an important consequence.
38. As a maintainer, I want one canonical write path and reconstructible projections, so that multiple ledgers do not become competing truths.
39. As a maintainer, I want stale references, changed snapshots and failed commits to preserve recoverable evidence, so that retry cannot publish a mismatched result.
40. As a maintainer, I want new records to carry version and campaign scope while old records remain untouched, so that history and worldline boundaries remain trustworthy.
41. As a maintainer, I want tests to observe real host, kernel, persistence, next-turn reads and author input, so that serialization alone does not count as feature completion.
42. As a maintainer, I want live play to demonstrate later use of earlier consequences and selective knowledge, so that complete fields do not substitute for coherent gameplay.

## Implementation Decisions

### 1. Authority and scope

- The TypeScript kernel remains the only production kernel. No historical Python source or oracle is changed or restored.
- The eight public verbs remain unchanged. Extend the current apply contract and existing read/recall projections; do not add a ninth verb, a separate event service, a second campaign store, a new model or a compulsory output stage.
- Preserve the ordinary action-admission, mechanics, source, Mod, budget and worldline owners. Event bookkeeping cannot settle an unchosen player action, waive a pending choice, invent dice or disclose source material merely because it is relevant.
- The accepted canonical records establish campaign facts. A source-authored truth, a settled mechanical result, a Keeper-established narrative fact, a character's report and a memory candidate retain different provenance. Recording a character's belief establishes that belief, not the truth of its content.

### 2. Extend apply with an event record

- Add an optional top-level event record to the existing apply batch. It groups that batch's ordinary effects with the Keeper's causal account and new nonnumeric semantic changes. It is not an additional execution pipeline.
- The event record carries a semantic name, an account of the established occurrence, causal/source references, directed NPC relationship changes and actor-specific cognition changes. Already supported mood, stance, presence, conditions and intentions continue through their existing npc effects; the event links their receipts rather than storing competing values.
- A valid semantic-only event may use an empty ordinary effects list. This is allowed only when the event contains an actual occurrence or semantic change; an empty object, a summary request or a proposed future action is not a successful state write.
- Bind the current batch's successful effects automatically to its event. Prior resolve/apply results and older causes are selected through semantic references actually supplied to the Keeper. Host/kernel owners resolve identities and mint persistent ids, versions, turn scope and receipt links.
- Validate the event and its dependent effects together before writing. An invalid event or a refused dependent effect leaves this batch uncommitted. Existing narrow partial-success exceptions must not strand an accepted event whose claimed effects failed; unrelated earlier successful calls remain settled.
- Return an ordinary canonical event receipt for the semantic additions and their bindings. The event receipt records only what this call owns. It cannot carry a second mutable amount, position, inventory or clock value.
- Event semantics are judged by the Keeper and existing applicable semantic-review boundaries. Deterministic checks validate shape, identity, scope, dependencies and ownership, not the truth of arbitrary natural language. No keyword classifier or generic permanent review agent is introduced.

### 3. One canonical record, separate result sections

Persist event receipts with the existing open-turn receipts and completed turn records. Add a versioned, read-only outcome projection to the existing turn/status/read surfaces. The projection is derived from canonical receipts, event records and accepted delivery evidence; it is not a separately editable source of truth.

| Section | Contents and owner |
| --- | --- |
| events | Established occurrences and their causal/source links. A model proposal or future plan is not an occurrence. |
| world_effects | References to original world-effect and mechanical receipts, with their existing settled status. |
| npc_effects | Original NPC effects plus explicitly established directed relationships; retain mood versus relationship distinctions. |
| knowledge_changes | Recipient, proposition, acquisition mode, evidence, attribution, uncertainty and activation status. |
| intent_changes | References to the existing intention lifecycle, including the new planned state. |
| disclosures | Permitted material versus actual accepted delivery, with audience and provenance kept distinct. |

- One turn may contain several events. A settled receipt without a Keeper-authored causal group remains visible as an ungrouped settled result; it must not disappear or acquire an invented explanation.
- Empty sections are valid. Ordinary mechanical turns do not require a separate model call merely to write a summary; their receipts already supply their established results. Pure narration of unchanged surroundings need not manufacture a state change.
- Canonical new semantic state is recoverable from accepted event receipts. The NPC ledger and any cognition lookup index are materialized views under existing kernel ownership, rebuilt on version/revision mismatch. A failed or delayed background extraction cannot make current state unreadable.
- A correction adds a new scoped record identifying what it corrects. It does not rewrite previous turn text, erase evidence, silently reinterpret old statuses or promote a report into source truth.

### 4. Truth, perception, belief and disclosure are independent

- A cognition change names the actual actor and the proposition they observed, heard, read or came to believe. Record its source and whether it is observation, an attributed report or a belief; an unknown acquisition remains unresolved.
- Preserve direct observation, hearing a claim, believing a claim and knowing its underlying truth as different meanings. For a lie, the audience can know that the speaker made the claim without the claim becoming true or accepted.
- Participants, mentioned entities, intended recipients and actual recipients remain separate. Presence alone grants no hearing; a person's name in a sentence grants no knowledge; a sent-but-undelivered message grants none to its addressee.
- Do not infer a player's acceptance, decision, emotion or belief merely because an NPC spoke. Player-authored assertions retain their existing authority.
- Relationship changes are directed and event-grounded. Do not manufacture reciprocal trust or permanent attitude changes from courtesy. Existing numerical stance arithmetic remains with its current owner.
- Backend Keeper access does not make information public or give it to an NPC. NPC decision inputs retain the existing distinction between privileged author context and that person's perceived information.

### 5. Planned intentions extend the current lifecycle

- Add planned to the current attempted, done, failed and abandoned vocabulary. Planned means the actor holds an intention but has not begun acting. Existing attempted rows remain attempted; do not relabel historical records.
- Planned may become attempted through the normal action route, or abandoned through the current explicit intention-settlement route. A newly begun-and-completed ordinary action may produce its normal terminal result without requiring an artificial extra call, provided the execution receipt supports it.
- Recording planned spends no combat turn, time, money or resources and changes no position. It cannot use spend_turn or claim a result that depends on execution.
- Done and failed still require the evidence their existing owners require, including the current safeguards for table-generated acts. A textual declaration of completion cannot override dice.
- Preserve current host-issued intention identity and semantic references. An event links an intention rather than recreating it under a second id. Identical replay does not create a second intention; wording changes do not silently merge different intentions by heuristics.
- Conditions and rationale can accompany a planned intention as Keeper context. A condition becoming relevant permits reassessment by the existing KP/NPC action owner; it does not automatically execute the intention, schedule a new autonomous service or force a future scene.
- Project planned and attempted separately. Do not feed planned into existing openIntents consumers that assume an action has already begun or a result is owed. Terminal records stay terminal.

### 6. Settlement and publication have different activation points

- A completed world action and its already established observations remain settled after successful apply/resolve even if prose generation later fails. The open turn retains them for recovery; this does not claim a Git turn commit happened before the existing publication owner ran.
- A prospective utterance, promise or disclosure prepared for this delivery is pending. It must name the material it depends on and its actual proposed audience. It grants no received knowledge or fulfilled promise while only checked, generated unsuccessfully or omitted.
- Store delivery-dependent claims as pending components, not established events or active cognition. If one submission also contains independently settled effects, retain their distinct activation status. A planned intention to speak may be established now; the speaking and its hearers become established only at their accepted occurrence boundary.
- Accepting the final artifact binds its expressed materials and canonical speech to the pending disclosure. The existing table.narrate/table.ask publication owner records activation once with the durable delivery. This is publication bookkeeping, not permission for the writer to execute arbitrary world effects.
- Preserve table.narrate's synchronous Git boundary and recovery journal. Preserve table.ask's durable pending-choice boundary without adding a Git commit per ask. Delivery-bound activations must follow the owner actually used and must not be duplicated when a later turn closes.
- A failed commit/restart restores unpublished disclosure changes while retaining effects settled before writing. Retrying a valid cached artifact must not replay effects or double-fold relationship/knowledge changes.
- Actual in-world receipt of private information can be established without displaying it to the player. Such an acquisition requires its own accepted event/evidence, not a missing public coverage span. Separate character perception from the player's UI delivery history.

### 7. Output receives an explicit public projection

- Reuse the existing material/source registry, immutable bindings, required-material handling, frozen packet, tool-enabled author and accepted-artifact cache.
- Register event-derived permitted materials through the same semantic source-reference route as other owner results. Each row retains its original authority and provenance. Selecting a reference does not change its disclosure permission.
- Project statement by statement. An event's hidden cause, NPC motive, secret belief, undisclosed name and future plan cannot leak merely because another part of the event is public. A private source can supply an explicitly permitted excerpt without exposing its full body.
- Apply the boundary to every story-bearing author input: selected material, NPC utterances, people/activity, recent exchange, scene information, guidance, source metadata and mechanics. Checking materials alone is insufficient. Expression examples remain advice and cannot introduce their sample facts into the story.
- Unknown/private content has no implicit public grant. Existing free-text/legacy materials remain untrusted portrayal proposals and cannot create durable world, NPC or cognition state. New consequential claims need the event/effect owner first.
- Keep speech meaning, speaker, actual audience and permitted stance. The writer can reorganize and rephrase it, but cannot add a new gesture, action, clue, commitment, emotion, condition or causal claim without supplied material.
- The writer receives no world-mutation tools and no broader campaign/source access. It produces the existing artifact and coverage declarations, not state deltas.
- Supply only the existing task-local permitted packet and writing artifacts to the author's task. This is a context and tool-authorization boundary; do not describe the existing tool-enabled subprocess as an operating-system sandbox or add a new sandbox platform within this feature.
- Required unavailable or stale material returns to the Keeper for focused repair before authoring/publication. Optional omitted material remains undelivered. Cache identity includes the canonical event/cognition/disclosure revisions consumed by the packet.
- Material coverage proves a structural binding, not semantic fidelity. Retain this limitation in tests and reports; a valid span cannot establish that a statement was true, understood, or expressed without distortion.

### 8. Memory and next-turn consumption

- Read current canonical event/cognition/relationship results directly through the existing capsule, NPC perspective, lookup/recall and Jev support owners. Do not wait for literary prose to be summarized before exposing the established result to the next decision.
- Extend those owners' existing catalogs and evidence views; do not add a parallel retriever. Jev may rank or select available evidence. It cannot increase authority, grant knowledge or execute a narrative future because a passage scored highly.
- Keep the existing asynchronous memory lane for attributed reports, summaries, legacy continuity and candidate extraction. A candidate that references a canonical event retains that binding and does not count as a second occurrence or independent corroboration.
- Preserve candidate versus canonical authority in every consumer, including NPC relationships, promises, continuity, recall and support materials. A newer candidate is not automatically stronger than an earlier settled fact; a conflicting claim remains attributed and inspectable.
- Existing fulfillment/correction owners remain authoritative. Making a promise and satisfying it are different events. Belief revision changes the believer's state without retroactively changing what was said.
- Current-event reads include accepted open-turn receipts as well as completed history. Background jobs bind their inputs and cannot overwrite newer canonical state with an older extraction.
- Bounded context projections retain omitted/partial coverage and a supported read route. Budgeting must not silently turn absent information into false or lose the distinction between planned and attempted. No mandatory offer-usage quota is introduced.

### 9. Writers, readers and actions

| Information | Who writes it | Who reads it | What the reader does with it |
| --- | --- | --- | --- |
| Event and causal links | KP through the existing apply transaction, using supplied sources/receipts | Capsule, recall and support projection | KP bases the next event on established causes rather than reconstructing them from prose. |
| World effects | Existing resolve/apply owners | Existing state views and outcome projection | Kernel uses current values; KP respects settled constraints. |
| Directed relationship/cognition changes | Accepted event semantics; delivery owner activates delivery-bound rows | NPC ledger/perspective and memory evidence views | The relevant person changes cooperation or reasoning without granting it to others. |
| Planned and attempted intentions | Existing npc intent owner with the new planned status | Present card and NPC action owner | KP considers plans, executes through normal tools and records actual results. |
| Permitted disclosure | Existing owner projection and explicit Keeper material selection | Final-output owner | Only allowed content reaches the author's packet. |
| Actual disclosure | Existing durable publication owner | Player-known projection, NPC perception and recall | Later decisions distinguish delivered information from unspoken material. |

Telemetry records supplied/selected/omitted material and binding failures for diagnosis. It never pressures the Keeper to use every available fact, fulfill every plan or advance a subplot.

### 10. Compatibility and implementation boundaries

- Version new event/outcome records. Read old campaigns with explicit missing semantic coverage; never fabricate a historical event, knower or planned status from absent fields. Preserve transcripts, model attribution, receipts and failed-run evidence.
- Reuse existing campaign/worldline/loop scope and revision checks. A fork inherits its valid ancestor state under current rules; sibling or later knowledge must not appear merely because an index contains it. Cross-loop knowledge follows the existing explicit owner, not a new global memory rule.
- Preserve opening allowances, source preparation holds, hidden rolls, pending choices, mechanics JSON and disabled Mods. An event wrapper cannot smuggle a forbidden opening action or enable an optional Mod.
- System prompts, tool descriptions, schema labels and host-authored instructions remain English. Player-facing material follows the open play_language; no language tables or semantic regexes are added.
- Before implementation, append the corresponding new RPC contract section and its kernel decisions under the existing contract process. No section number is reserved in this draft while unrelated contract changes are active.
- Scope is the existing kernel/host/read/write/memory/output path and its tests. The event schema is not a general task scheduler, plot planner, graph replacement or document transaction redesign.

## Testing Decisions

### Confirmed highest acceptance seam

**Real Pi public hooks → actual TypeScript kernel → existing durable turn/publication owner → restart or next player input → existing capsule/NPC perspective/recall → captured final-author request and accepted player delivery.**

Reuse the current real-host fixture and real-kernel RPC support. Deterministic tests may substitute provider decisions and the author to make inputs observable; they must be labeled integration tests, never gameplay. The test must see what the author actually receives, not only a helper's proposed output.

This seam includes both ends of persistence and the next consumer. Separate pure helpers are tested only when they own a meaningful invariant that cannot be observed adequately at this seam. No new alternate Keeper or standalone simulated-game harness is required.

Seam confirmation: the owner confirmed this complete acceptance chain on 2026-10-13: “按这个验收边界”. The product direction, spec scope and testing seam are settled; implementation has not started.

### Required behavioral coverage

| Case | Observable acceptance |
| --- | --- |
| Prior shared event affects a later encounter | The subsequent actual Keeper/NPC request contains the directed, event-grounded relationship; absent actors do not inherit it. |
| Event plus ordinary effects | Event links actual roll/world/NPC receipts; final values remain the original owners' values. |
| Semantic-only interaction | A real nonnumeric event can be saved and recalled without a dummy clock, roll or item effect. |
| No new consequence | Empty change sections are accepted; no manufactured event or progress requirement appears. |
| Invalid dependent batch | Refused effect/event leaves no half-accepted semantic result from that batch; earlier successful calls remain. |
| Planned → executed or abandoned | Planned survives restart, spends nothing, is not offered as an attempted action; only proper execution can supply its result. |
| NPC lie | The world fact, attributed statement, hearers and optional belief are separately readable; the lie is not promoted into truth. |
| Private thought or document | An uninformed NPC's actual perspective/request lacks the content despite presence or mention. |
| Proposed but undelivered speech | Repeated checks, writer failure and optional omission grant no knowledge or promise activation to recipients. |
| Private in-world communication | Accepted private acquisition updates only the real recipients and remains absent from the public author packet. |
| Explicit disclosure | Only the selected permitted proposition reaches output; its private source, causal secret and unrelated NPC motive remain absent. |
| Every author input channel | Private sentinel material placed in each supported source/guidance/snapshot channel is absent from the actual writer request and visible UI payload. |
| Required versus optional material | Missing required material stops preparation; omitted optional material remains accurately undelivered. |
| Writer has stale state | A changed event, cognition, intent or disclosure revision rejects the cached/frozen result without replaying effects. |
| Writer retry and restart | The valid artifact can be reused and published once; no second roll, resource change or semantic occurrence is created. |
| Commit failure/recovery | Unpublished delivery-bound knowledge rolls back with publication; prior effects remain recoverable; the retry activates once. |
| Durable ask followed by turn closure | Choice ownership survives; disclosure and ledger folds are not duplicated by later narrate/close. |
| Memory worker unavailable or delayed | Immediate and next-turn canonical reads remain correct; a later candidate does not duplicate or replace the result. |
| Correction and disputed report | A new correction is linked; old evidence remains; all relevant read paths retain source and attribution. |
| Legacy campaign and worldline scope | Older records remain unchanged; correct ancestor state is available, unrelated sibling/future knowledge is not. |
| OOC and mixed input | OOC does not create events or start the author; mixed explanation stays outside fictional materials and state. |
| Opening, pending choices and disabled Mods | The added event record cannot bypass existing gates or change a disabled behavior. |

Existing prior art to reuse includes explicit-output publication/privacy/cache-retry tests, NPC mood and intent receipt folding, heard-participant and directed-relationship tests, player-known/name disclosure, transaction recovery and world-state read/write pairing. Pairing alone does not establish that the Keeper used a field.

### Real gameplay acceptance after implementation

- Follow the project's real RPC play driver, with this main session as the sole natural one-utterance player. Continue an organically coherent episode far enough for an earlier event, relationship, knowledge boundary or pending intention to matter later. Do not substitute a fixed round count for that result.
- Use codex-relay/gpt-6-luna with high reasoning by default, including the author; if upstream concurrency is saturated, use the owner-authorized grok-build/grok-4.5 low fallback consistently for that test and retain the failed Luna evidence. Verify actual models and preserve historical attribution.
- Evaluate whether the later response and action follow the earlier event, whether private information remains private, whether plans remain unexecuted until acted upon, and whether settled mechanics remain consistent. Do not require a prewritten player script or force a specific NPC plan just to cover a checklist.
- A deterministic privacy or recovery check and a coherent live episode provide different evidence. Coverage spans and field counts do not prove prose fidelity, naturalness, long-term reliability or a completed campaign. No such improvement is claimed by this spec.
- Run required heavy suites on an available LAN test box under the existing policy; this spec-only task runs none. GUI packaging or deployment is not added to scope.

## Out of Scope

- Implementing the feature, splitting implementation tickets or starting a long-running execution goal in this spec task.
- Replacing the kernel, output author, Pi loop, rule engine, memory framework or current source-reader architecture.
- A universal event database, message broker, new external dependency, background world simulator or automatic plan scheduler.
- New dice rules, default models, Mod thresholds, player menus, language tables, fixed NPC action banks or compulsory story progression.
- Generic psychological truth detection, guaranteed interpretation of every utterance, or a claim that a structural validator proves semantic fidelity.
- Rewriting historical campaigns, upgrading weak teacher labels into truth, altering the frozen Python oracle or deleting evidence.
- New multiplayer UX, arbitrary audience management screens, player dashboards, packaging, deployment, pushes or remote issue publication.

## Further Notes

### Current-source audit

The following is evidence from the current TypeScript/host source, not a claim of completed new behavior. The glossary supplies domain vocabulary but still cites retired Python paths; those paths were not used as implementation sources. The current contract and actual owners take precedence over old seven-verb or old model wording.

| Existing owner | Verified fact | Consequence for this design |
| --- | --- | --- |
| [apply transaction](../../kernel-ts/apply/index.ts) | Stages ordinary effects, makes receipts/events and retains narrow partial-success exceptions. | Attach semantic records to the same batch and account for those exceptions; do not create an independent commit route. |
| [NPC intent lifecycle](../../kernel-ts/npc/intents.ts), [intent admission](../../kernel-ts/apply/intent.ts) | Only attempted/done/failed/abandoned exist; current openIntents means attempted, and identity/settlement are receipt-bound. | Add planned explicitly; preserve terminal guards and distinguish plan consumers from attempted-action consumers. |
| [NPC effect staging](../../kernel-ts/apply/entities.ts) | Mood and intention are existing keeper-only NPC receipts; mood does not write a duplicate world value. | Reuse them for current feelings and intentions instead of adding equivalent fields to a new writable world object. |
| [NPC ledger fold/rebuild](../../kernel-ts/write/contributions.ts) | Ledger state folds from turn receipts; memory references are added separately. | Canonical new semantic changes should feed the same views without depending on a later candidate extraction. |
| [NPC perspective](../../kernel-ts/npc/perspective.ts), [NPC read composition](../../kernel-ts/npc/read.ts) | Knowledge/belief reports filter by explicit knowers; relationships are directed; current input is marked privileged author context. | Preserve epistemic boundaries across all new reads rather than sending the event's full backstage account to every NPC. |
| [Memory jobs](../../kernel-ts/memory/jobs.ts), [attribution rules](../../kernel-ts/memory/attribution.ts) | Existing candidates include knowledge, belief, relationship and promise with privacy/knowers; extraction reads committed facts, delivered text and delivery evidence. | Retain candidates as attributed evidence; add a direct canonical path for already established new semantics. |
| [Player-known projection](../../kernel-ts/read/player-knows.ts) | Covers people and delivered documents and points to existing clues/memory. | Extend the existing knowledge consumers rather than treating this bounded section as a complete new knowledge database. |
| [Final-output owner](../../extensions/kernel/final-output.ts) | Private material rows are filtered; public materials and coverage form saved delivery evidence; source permission and snapshot binding are checked. | A keeper material alone is not durable world state. Reuse the registry and packet controls and examine every packet channel. |
| [Artifact validator](../../runtime/final-output-artifact.ts) | Checks shape and declared coverage, explicitly not semantic authorization. | Do not turn coverage into an automatic truth or understanding grant. |
| [Publication and recovery](../../kernel-ts/write/index.ts) | Durable ask and narrate have different boundaries; narrate journals state and rolls finalization back on failure. | Include disclosure activation in the correct existing boundary, not a post-output unprotected write. |
| [Real-host output tests](../../tests/extension/final-output.test.mjs) | Exercise real Pi hooks and TS kernel with provider/author substitutes, including provenance, private content, stale state, restart and Git retry. | Extend this highest seam instead of building another simulation harness. |

Existing contract areas to reconcile before implementation: §5 apply/resolve/write lifecycle; §12 post-narrate commit and memory chain; §17 NPC ledger; §27 host runtime composition; §31 writers/readers/actions; §32 action admission; §122 typed Jev tasks and source references; §125 shared evidence and NPC preparation; §141 recovery; §142–143 NPC intentions/actions; §194 two ledgers; §231–232 attribution/relationships; §233 optional output and confirmed source handoff. ADR 0001 keeps the campaign Git history distinct from semantic memory. This draft does not edit the concurrently modified contract or claim those amendments are already implemented.

### External cross-check

- [Microsoft's Event Sourcing guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) supports keeping occurrence history and rebuildable projections, preserving ordering, versions and idempotency. It also warns of substantial migration complexity. That supports extending the existing receipt/turn history here, not replacing it with a new event infrastructure.
- [boardgame.io secret-state documentation](https://github.com/boardgameio/boardgame.io/blob/main/docs/documentation/secret-state.md) filters state before it reaches an individual client. The analogous boundary here is before the writing model receives context. Its mechanically defined game state is simpler than open natural-language propositions, so this precedent does not prove semantic secrecy or that arbitrary Keeper excerpts are safe.
- [TypeSafe's RAG passage classification example](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) separates evidence and conflicting passages before generation. It supports keeping Jev selection, provenance and uncertainty distinct from Keeper decisions and execution permission.
- [FIREBALL, ACL 2023](https://arxiv.org/abs/2305.01528) provides evidence that real game-state information helps generation compared with dialogue alone; [Generative Agents, 2023](https://arxiv.org/html/2304.03442) supports memory-informed behavior while reporting retrieval and memory-fabrication failures. Neither validates this complete implementation or a long autonomous campaign.

### Publication and scope record

The project tracker is repository Markdown under docs/specs. Publishing this spec means a local commit of this document only. The required seam confirmation was received on 2026-10-13. No remote issue, push, campaign mutation, model run, test run or product implementation is part of publication. ready-for-agent describes the completeness of the specification, never feature completion.
