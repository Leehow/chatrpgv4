# 单一 KP 判断与写作，output 流式交付

Status: implementation authorized by the owner after specification; in progress, not accepted.
Date: 2026-10-13.
Baseline: current 0.9.7a checkout at a45b22c5f, including the inspected uncommitted streaming work. Source, installed App and earlier acceptance are distinct evidence.
Owner direction: reuse the existing kernel and event/cognition/intention storage; one KP decides and writes; output only delivers the public stream. Remove redundant chains, state confidentiality limits, and verify the real App viewport.
Acceptance: the owner explicitly confirmed the highest seam and real App scope during this specification task.

## Problem Statement

玩家的一句追问需要等待很久，看到多次工具失败，最后收到的回答仍可能只是复述问题、重复人物标签、催促玩家去别处。界面存在后台增量但正文不在可视区增长的问题。这样的系统即使字段齐全、保存成功，也没有完成“一个能理解前情并自然回应的 KP”。

当前已有有效的 TypeScript 规则和事务内核、事件收据、人物认知及关系投影、planned/attempted 意图、公开交付激活和重启恢复。问题不是完全缺少这些能力，而是生成链切分过度：部分普通对话先由独立 NPC 模型生成，再由 Jev 分类绑定为行动，由 KP 修补及登记，最后交给独立写作者从材料重建正文。上下文和决定在交接中被压缩、重复和锁死。普通答话甚至进入需要结算凭据的任务生命周期。

2026-10-13 的实际 App 回合耗时约 100 秒，第一次主 KP 推理前已有约 17 秒工作，五次主推理合计约 59 秒，最终独立作者又耗时约 16 秒。三次 narrate 是两次交接拒绝和一次成功提交，不是三次质量改写。事件/认知的数据接线成功不能解释为主持质量、低延迟或可见流式验收成功。

## Solution

将普通回合收敛为一个持续理解游戏的 KP：获取完整相关上下文，判断人物与因果，按需调用现有规则和状态工具，然后直接写公开回应。output 不调用另一位作者、不重新理解剧情，只接收明确的公开通道，负责增量传输、说话人格式、交付记录和恢复。保留原有内核、RunDriver、事件与认知存储、意图生命周期和机制 UI。

“一个 KP”是一个作者和连续的决策上下文，不是禁止必要的工具往返，也不是把全部剧本无差别塞入请求。需要骰子结果时先结算，再由同一 KP 续写。普通无检定对话不再强制经过 NPC 子模型、行动分类、材料提交和第二作者。

后台仍区分事件、世界变化、人物变化、谁获知什么、未执行计划及实际披露。结构化保存是同一次 KP 工作的产物，不是理由充分性评审、第二次剧情规划或对最终正文重新猜测全部事实。没有变化的栏目为空，不为填表制造行动和情绪。

Owner clarification, 2026-10-13: playable continuity takes priority over eliminating every narrative error before delivery. Minor inaccuracies, imperfect phrasing, local continuity slips and coherent improvisation may be clarified naturally in later turns. Do not add gates that stall the KP in pursuit of error-free prose. This principle governs the interpretation of all semantic quality and acceptance requirements below.

Owner clarification, 2026-10-13: simplify by ablation wherever possible; do not multiply entities without necessity. Deleting an unnecessary stage is preferable to replacing it with a new abstraction. This applies to conceptual entities, agents, protocols, tools, services, records and persisted stores, not just file count.

## User Stories

1. As a player, I want a direct answer to my current question, so that conversation advances beyond repeating my words.
2. As a player, I want an NPC to remember relevant earlier exchanges, so that a follow-up remains a coherent conversation.
3. As a player, I want personalities to shape an answer without replacing its substance, so that characters do more than repeat a trait.
4. As a player, I want an NPC's ignorance to differ from missing retrieval, so that omitted context does not become invented ignorance.
5. As a player, I want ordinary dialogue to work without an artificial task lifecycle, so that speaking does not require a dice settlement.
6. As a player, I want checks only when the situation calls for them, so that every interaction does not become a mechanical obstacle.
7. As a player, I want failed observation to affect what I can infer, so that it does not erase an NPC's ordinary answer.
8. As a player, I want my chosen action respected, so that the Keeper cannot substitute a different target, commitment or cost.
9. As a player, I want settled resources and positions to constrain narration, so that prose does not silently change state.
10. As a player, I want relevant scenario evidence to inform play without forcing the next authored scene, so that my choices matter.
11. As a player, I want text to grow inside the visible conversation area, so that streaming is perceptible rather than merely logged.
12. As a player, I want truthful progress before the first word, so that an empty wait is not mistaken for a frozen App.
13. As a player, I want speaker formatting to remain stable while text arrives, so that NPC dialogue stays readable.
14. As a player, I want dice and item changes in their existing UI, so that a new prose path does not remove mechanics cards.
15. As a player, I want private facts excluded from the public transport, so that hidden records are not sent to my client.
16. As a player, I want an NPC to act on its own knowledge rather than the Keeper's secrets, so that characters are not omniscient.
17. As a player, I want hearing a claim distinguished from believing it, so that a lie does not automatically become my belief or world truth.
18. As a player, I want future intentions to remain unexecuted until someone acts, so that plans do not teleport people or spend resources.
19. As a player, I want interrupted text preserved honestly, so that a retry cannot pretend an unseen speech was delivered.
20. As a player, I want failed delivery to avoid rerolling or duplicate spending, so that transport problems do not change the outcome.
21. As a player, I want a resumed campaign to retain events and selective knowledge, so that restarting does not cause amnesia or information leaks.
22. As a player, I want OOC discussion separated from fiction, so that asking about the App does not create a world event.
23. As a Keeper, I want current authoritative state and recent verbatim exchanges together, so that I can reason about the actual situation.
24. As a Keeper, I want relevant NPC knowledge, relationships, goals and plans in one coherent view, so that I need not reconstruct a character from scattered labels.
25. As a Keeper, I want retrieved passages with source and uncertainty intact, so that ranking does not grant truth or disclosure permission.
26. As a Keeper, I want an explicit omitted-context notice and a supported read route, so that I can recover information instead of inventing it.
27. As a Keeper, I want independent context reads batched or concurrent, so that unnecessary serial work does not delay my first response.
28. As a Keeper, I want useful cached context reused until its owner changes, so that each sentence does not rebuild the whole request.
29. As a Keeper, I want Jev to assist bounded retrieval and choices when useful, so that it does not pre-author my NPC response.
30. As a Keeper, I want rule results returned to the same conversation, so that no second author must reconstruct my reasoning.
31. As a Keeper, I want one canonical event and cognition write path, so that saving semantics does not duplicate the rule engine.
32. As a Keeper, I want prospective speech held pending, so that intended listeners learn only what was actually delivered.
33. As a Keeper, I want delivered words linked to their speaker and audience without copying the same meaning through several forms, so that bookkeeping does not create needless repairs.
34. As a Keeper, I want optional summaries and style aids off the critical path, so that a failed auxiliary job does not block ordinary dialogue.
35. As a maintainer, I want output to have no generative author call, so that its responsibility and latency are explicit.
36. As a maintainer, I want one run and one publication owner, so that a new generation path does not create competing turns or stores.
37. As a maintainer, I want canonical events readable before background extraction, so that fresh decisions do not depend on a summarizer finishing.
38. As a maintainer, I want confidentiality tested both structurally and semantically, so that channel filtering is not mistaken for perfect secrecy.
39. As a maintainer, I want compatibility limited to record readability and the same delivery adapter, so that old entrypoints cannot secretly invoke a second writer.
40. As a maintainer, I want actual provider requests, model identities and visible paint timing retained, so that performance claims describe the running product.
41. As a maintainer, I want tests through the existing Pi/driver/kernel/App seam, so that isolated JSON success cannot stand in for gameplay.
42. As a maintainer, I want old failed play evidence preserved, so that a new implementation cannot rewrite earlier results as successes.
43. As a player, I want play to continue through minor narrative mistakes, so that quality checks do not prevent an otherwise playable conversation.
44. As a player, I want later turns to clarify recoverable inconsistencies naturally, so that the story can regain coherence without forced restarts or repeated rewrites.

## Implementation Decisions

### 1. One author; keep existing deep modules

- The existing KP Pi session owns semantic understanding, NPC portrayal, choice of applicable rules, event causality and final prose. Tool results continue in that session. A helper cannot become the ordinary dialogue's first author.
- Keep the existing RunDriver for input ownership, tool execution, cancellation, budgets, waiting and finalization. Change its policy rather than adding an outer orchestrator, a new generic agent framework or a second loop.
- Keep the current TypeScript kernel as the only rule and state authority. Recording KP-authored semantics does not make the kernel a natural-language judge. It checks shapes, actors, scope, prerequisites, mechanical invariants and transaction ownership.
- Reuse the current event, cognition, relationship, intention, disclosure and history stores. No new event database, parallel memory engine or migration of historical prose into asserted truth.
- Output is a delivery module, not an LLM, tool that summons an LLM, or hidden prompt continuation. The normal path must contain zero independent final-writer requests.
- Retain source/setup readers in their existing roles. Removing per-turn authors does not authorize replacing document ingestion with bare completions.
- Start by removing or merging redundant behavior behind the existing interfaces. Do not build a replacement orchestration layer to perform work whose removal already satisfies the requirement.
- Reuse existing result, message, event and delivery shapes before introducing new ones. The private/public channels described below are logical separation requirements, not instructions to create a new service, public tool, generic envelope, scheduler or persistence entity. Extend the smallest existing owner only where necessary.
- Any proposed new entity must identify a concrete unmet requirement, explain why deletion, reuse or a small extension is insufficient, and state its writer, reader and resulting action. Hypothetical future reuse or architectural symmetry is not sufficient justification. This is a design obligation, not another runtime gate for the KP.

### 2. Retire the redundant paths, not merely rename them

| Current responsibility | New responsibility and removal boundary |
| --- | --- |
| Scope/compile/route/bind repeatedly choose the ordinary conversational path | The KP interprets the declared action and chooses tools. Remove this chain as a mandatory gate before ordinary KP inference. Keep rule-owned option catalogs and mechanical prerequisites. |
| NPC scan generates each person's response before the KP writes | Remove mandatory conversational NPC generation, its grounding/re-ask loop and its conversion into an attempted task. KP handles present characters together using their separate knowledge. |
| A generated sentence is bound to a mechanical action or intention_only | Ordinary speech is a prospective utterance, never a fictitious undertaking. Actual mechanical NPC actions still use the existing rule path; genuine future plans use planned. |
| The front KP prepares duplicate fact/speech/meaning material for another author | The KP writes prose once. A canonical record and its public occurrence can be linked without restating the same sentence in three model-facing payloads. |
| Narrate check, source selection, exact copied meaning and final-writer invocation | Replace the ordinary material-authoring handshake with the same KP's typed final result and public stream. No mandatory check-only call, separate handoff inference or model-authored coverage quotes. |
| Final output model, draft checker and semantic rewrite/retry chain | Remove from the new production path. Preserve transport decoding, publication, cache/recovery identity and existing public formatting. |
| Style/expression assistance blocks final writing or rewrites it afterward | Supply available guidance to the KP as advisory context. Do not require a separate reply author or automatic post-publication rewrite. Optional background preparation cannot gate delivery. |
| Background extraction reconstructs all new facts from prose | Canonical changes come from explicit KP records. Keep extraction for derived summaries, retrieval and attributed legacy candidates. |

- Disabling the old path through a setting is not sufficient completion if normal entrypoints, fallback or budget exhaustion can still silently invoke it.
- Keep older records readable. Any needed compatibility adapter feeds the same publication implementation; it cannot preserve a second active author or state machine.
- Do not delete every Jev module, Mod or specialized rule feature. Remove the superseded control edges and dead product paths within this scope; shared retrieval and rule capabilities remain.

### 3. Complete relevant context, assembled once per state revision

- The initial KP request includes current authoritative state, the actual player message, relevant recent verbatim exchanges, the present characters' profiles and actor-specific cognition, directed relationships, plans, rule references and relevant scenario/history passages.
- Preserve facts, reports, beliefs, plans, source-authored secrets and settled receipts as different categories. Personality and urgency provide tone and motivation; they cannot replace evidence answering the player's question.
- A shared historical event includes enough of its occurrence and consequences to be intelligible. A topic label or tiny summary must not become the only account when the relevant original is available.
- Relevant context does not mean the full campaign at every step. Reuse existing retrieval and memory readers, cache static material by its revision, and retain omitted/partial coverage plus a supported read route. Missing retrieval is not evidence that a fact does not exist or an NPC is ignorant.
- Independent read-only preparation may run concurrently. Serial work requires a real dependency. A write invalidates only affected views; do not repeatedly reclassify or reread unchanged data between sentences.
- Available expression guidance may enter the KP's own context. It carries no new facts or disclosure grants. Optional guidance, summaries and indexes must not postpone the first usable KP request.
- Jev may rank evidence or help select among explicit options. Batch independent questions where useful. Low confidence and incomplete candidates return control to the KP; do not manufacture another mandatory specialist chain.
- Required rules and enabled-Mod execution constraints remain accessible. Removing discovery/route gates does not remove a Mod's actual mechanical rules or substitute generic behavior for it.

### 4. Same-KP result and execution order

- There are two explicit result channels: private structured turn data and public prose. Private data is an intentional compact record, not the model's hidden reasoning. Provider thinking and internal tool traffic are not player prose.
- The normal no-tool dialogue target is one KP generation containing its private record and public response. This is a capability to validate, not a claim that every provider/tool interaction fits one request.
- When a rule outcome, missing fact or state operation is needed, the KP uses the existing tool gateway and continues after the result. It must not publish a dependent success, injury, transfer or arrival before the relevant result is known and accepted.
- The host consumes a bounded structured control portion through the existing operation gateway. Kernel validation and required state settlement happen before dependent public text is released. Keep public bytes buffered during this short validation window; never buffer the whole completed reply merely to emulate streaming.
- Structured control is not a new side-effect writer: ordinary effects use the current apply/resolve owners, identities and idempotency. Internal identifiers are host-issued, not copied from model prose.
- If a prerequisite fails, release none of the dependent buffered claim, return the actual failure to the same KP, and preserve already settled work. After exposure begins, do not silently replace the answer or automatically re-author it in place.
- Final prose and event/cognition records are authored as one coherent result. Do not insert a mandatory extra inference solely to summarize prose, copy a reference, request output or approve the KP's own words.
- Interface ordering and provider support must be verified in the real Pi seam before implementation is accepted. If one provider requires a tool-result round trip, retain the same author and report the extra request; do not smuggle the independent writer back as a fallback.

### 5. Preserve event, cognition and intention semantics

- Reuse the current grouped event and derived outcome sections: events, world effects, NPC effects, knowledge changes, intent changes and disclosures. Numerical and positional values remain owned by original effect receipts.
- Allow semantic-only events and empty change categories. Pure OOC and unchanged descriptive text need not invent an event.
- Preserve directed relationships, observed/heard/read/belief modes, attribution, uncertainty, correction history, campaign/worldline/loop scope and next-turn readers.
- Ordinary speech needs no attempted intent and no dice receipt. A promise or future plan may create planned, but speech delivery and later performance of the promise are different occurrences.
- Keep attempted/done/failed/abandoned protections for real undertakings. Removing the misclassification must not make saying an action happened sufficient to settle it.
- The KP supplies intended speaker/audience and disclosure-dependent records. The host binds the actual emitted utterance to them through its structured occurrence identity, not a second prose paraphrase or self-reported semantic coverage checklist.
- Existing independent settled events remain after delivery failure. Speech-dependent cognition, promises and disclosure remain pending until the existing publication owner accepts their actual public occurrence. An intended audience, model completion or transport acknowledgement alone is not that acceptance.
- Private in-world communication can establish knowledge without public prose, but needs its own explicit valid event/evidence. Mere co-presence or a name in the text gives no knowledge.
- Canonical state is available immediately through current readers. Background extraction retains candidate provenance and cannot overwrite newer canonical facts or count a restatement as independent corroboration.

### 6. Confidentiality and semantic responsibility

- KP is privileged: it can read relevant secrets to host the world. Each portrayed NPC still has its own supplied knowledge and beliefs. KP access is not an NPC knowledge grant.
- Output and the story surface receive only the explicit public prose, authorized public names, mechanics and closed progress events. They receive no raw private result envelope, hidden event summary, NPC thought, source body, secret rule outcome or internal tool arguments.
- Provider Thinking remains available in the existing process inspector, including live deltas, message-end catch-up and restored history. Keep its body folded by default and open it on the user's click, as required by sections 22/93 and reaffirmed by the owner on 2026-10-14. Do not suppress, summarize or filter it for spoilers, even when it contains module facts. Existing credential redaction remains. Inspecting Thinking does not publish story text, settle effects or grant any character knowledge.
- Apply this allowlist to live events, message metadata, error notices, reconnect/replay, history APIs and debug UI delivered to the player. Filtering only the visible text node is insufficient.
- The same KP now chooses what to disclose and writes it. Transport filtering proves private fields stayed private; it does not prove a public sentence contains no secret. State this reduced separation explicitly. Do not advertise an information-flow proof or perfect semantic secrecy.
- The KP must distinguish what it knows, what the NPC knows, what the investigator perceives and what has actually been disclosed. A failed Psychology observation changes the investigator's reliable inference, not the NPC's ability to answer an ordinary question.
- Do not add a compulsory semantic reviewer to recover the old isolation. Test semantic disclosure and character knowledge directly; record observed issues without turning every semantic concern into a runtime refusal or automatic playtest stop. New agents or new confidential-author architectures need separate scope approval.
- If public prose actually leaks, preserve the exposure record and report/correct it through the existing recovery semantics. Hiding the bytes afterward cannot undo what the player saw; do not silently promote all leaked content into character knowledge.
- Preserve normal player-action ownership: no new target, cost or commitment can be asserted merely to smooth narration. Keep concrete rule/choice/transaction checks and explicit authorization records. Consolidating repeated semantic admission does not license unchosen actions; no deterministic checker is claimed to solve arbitrary semantic intent.

### 7. Output, publication and App behavior

- Extend the existing delivery owner rather than add a second publisher. It consumes the KP public stream, journals exposed bytes, and emits ordered delivery events with stable run, turn and attempt identity.
- Preserve the synchronous canonical publication boundary, cached exact-text retry after publication failure, durable pending choices, and no duplicate settlement. Streaming visibility remains provisional until publication completes.
- Preserve interrupted partial text as interrupted. It enters later recovery context distinctly from accepted speech/knowledge; a failed stream does not activate the full intended utterance.
- Preserve existing speaker markers, public display-name projection and incremental Markdown rendering. A growing speech span keeps its identity; punctuation or partial markup must not generate duplicate speakers or reveal raw control data.
- Preserve dice, item exchange, cash, conditions, handouts and structured choices through existing mechanics/interaction projections. The KP does not render mechanics arithmetic as story or invent UI identifiers.
- Start truthful, closed progress reporting when the host accepts and begins work. Distinguish context preparation, model work, rule execution and public writing where actually known. A progress label is not evidence of faster prose or a substitute for it.
- On transition to public prose, end the preceding live tool/Thinking group. When the user is following the newest turn, ensure the new prose stays in view as it grows. Respect deliberate scrolling into older history; do not repeatedly yank the user back.
- Completion replaces/reconciles the same growing message and mechanics by identity. No simulated typewriter after a complete response, replay of cached text as new generation, duplicate final bubble or whole-message hold until completion.

### 8. Performance and model policy

- Preserve the owner's configured DeepSeek fast-lane selection for surviving helpers. Do not silently switch models to mask the architectural comparison. There is no final-writer model to configure in the new path.
- Preserve the current production KP selection unless explicitly changed. Official live-driver acceptance follows the current Luna/high test profile, with Grok 4.5/low only on recorded actual Relay saturation. The real App comparison additionally uses the owner's KP configuration and DeepSeek helper setting; label this product-profile run separately, not as uniform test-profile evidence.
- Record actual provider requests and options, helper roles, retries, context bytes, time to first KP request, first public delta, first visible public paint and completed publication. Count all calls, not just tool cards in the UI.
- Ordinary conversation must have zero independent NPC-response and final-author requests, zero mandatory multi-stage route/compile passes, and zero model calls whose sole purpose is narrate/output handoff or coverage repair.
- A no-tool dialogue should use one KP generation. Necessary retrieval or kernel results can add same-KP continuations, each with an attributable dependency. Do not meet a call-count target by inventing results or hiding calls.
- Show the before/after latency breakdown. No absolute provider latency is promised, no artificial throttling is used to create streaming frames, and the historical 100-second failure is not a controlled benchmark for every future exchange.

### 9. Contract precedence and migration

- This owner-directed design supersedes the independent-output-author requirement and the ordinary conversational NPC-first/compile-route pipeline, while retaining their useful storage, rule, context and transport responsibilities.
- Before code changes, amend the owning kernel and Pi host contracts and the affected ADR decisions to reflect the new authority split. Preserve the existing single runtime, one RunDriver, current TypeScript kernel and synchronous publication decisions. A stale reference to old Pi or Python does not authorize restoring it.
- Keep earlier specs and evidence as historical records. Mark the relevant authoring/control clauses superseded in implementation documentation; do not rewrite older acceptance to claim it tested this architecture.
- Opening, normal play, mixed OOC, pending choices, resume and error recovery must all route to the same author/publication design. Completion requires verifying every production entrypoint, not only a new opt-in demonstration.
- The specification task writes documents and publishes its issue only. It does not change contracts, source, tests, settings, packages, installed App or campaign data.

### 10. Writers, readers and actions

| Information | Writer | Reader | Resulting action |
| --- | --- | --- | --- |
| Current state and settled receipts | Existing rule/state kernel | KP and mechanics projection | KP respects real results; UI shows authorized mechanics. |
| Relevant history and source material | Existing stores and retrieval owners | KP | KP interprets context and requests missing evidence without automatic plot execution. |
| Event, directed relationship and cognition | KP through existing kernel transaction | Existing next-turn, perspective and recall readers | Later responses use the right actor's evidence. |
| Planned/attempted intentions | KP through existing intent owner | KP and ordinary execution path | KP reassesses or executes explicitly; recording a plan executes nothing. |
| Public prose and speech attribution | The same KP | Output delivery module | Bytes stream once to the player with stable speaker identity. |
| Actual delivery and interruption | Existing publication/transport owners | Cognition activation, history and recovery | Activate accepted disclosures once; retain interrupted exposure separately. |
| Derived summaries and indexes | Existing background workers | Retrieval consumers | Improve future recall without becoming a second state authority or delaying the reply. |

### 11. Continue play through recoverable narrative errors

- The default response to a minor narrative error is continued play, not a new gate. The KP may clarify an earlier statement, correct an NPC's mistaken account, or establish missing context naturally when relevant in later turns. Do not require an immediate apology, correction speech, renewed player authorization or replay of the turn.
- A local continuity slip, imperfect answer, uncertain portrayal, optional context miss or deviation from scenario order does not by itself justify blocking generation, rejecting delivery, retrying the author or restarting the campaign. Do not add a per-sentence reviewer, semantic confidence threshold or compulsory pre-publication proof of consistency.
- The KP may acknowledge and reconcile mistakes; it must not rewrite earlier evidence, claim an error never occurred, or silently replace settled numerical/resource state to make prose fit. Use existing additive event corrections where a persisted semantic record actually needs correction, without imposing that bookkeeping on every imperfect sentence.
- Hard refusals remain tied to concrete execution integrity: invalid state operations, unmet mechanical prerequisites, duplicate writes, unresolved required choices, ownership/scope violations and unavailable required persistence. They do not certify prose quality and must not be expanded into a general narrative veto.
- Debugging and test review may record a minor issue while play continues. Assess whether subsequent responses restore a usable causal account and meaningful player choice. Do not impose a fixed number of turns within which every loose detail must be resolved; some uncertainty is part of play.
- Stop live acceptance for an actual blocking system failure, incorrect rule/state settlement, substituted player action, or a serious contradiction that continued interaction cannot reasonably resolve. Do not equate noticing an imperfection with reaching that threshold.
- The simplification must reduce blocking control flow. Replacing retired gates with differently named admission, consistency, material-completeness or answer-quality gates fails this requirement even if each gate individually appears plausible.

## Testing Decisions

### Highest seam, confirmed by the owner

Use the existing real Pi/RunDriver through the TypeScript kernel, canonical saves, process restart, next-turn perspective/recall and public delivery. Extend observation at that same seam through the packaged App's actual viewport. The owner confirmed this scope on 2026-10-13, including at least three visible text-growth samples and speaker/dice/item UI verification.

Good tests observe the declared action, actual requests, accepted state, displayed bytes and subsequent use. They do not assert a particular private helper layout or prescribe literary sentences. Deterministic provider substitutes may test interruption and transaction fault cases; they are never real-play evidence.

### Behavioral coverage

1. A normal follow-up receives a relevant answer grounded in available NPC knowledge, without a separate NPC author, artificial intent or separate final writer. If the NPC lacks the answer, the uncertainty follows its evidence rather than a missing projection.
2. A failed observational check changes reliable interpretation without suppressing unrelated ordinary conversation. Preserve the existing roll arithmetic and concealed/public projection.
3. An earlier event and directed relationship affect a later reply; another NPC does not inherit that information merely by being present or mentioned.
4. Truth, a reported lie, belief and a prospective plan remain distinct through save/restart and recall. Planned persists without spending time, moving anyone or activating its recipients' knowledge.
5. A real rule/state dependency is settled before dependent prose is exposed. A rejected operation leaves no false success visible; earlier valid effects remain once only.
6. Private result fields and hidden source sentinels never enter player transports, history responses or replay. Separately inspect public meaning for semantic leaks; exact-sentinel checks alone do not prove semantic confidentiality.
7. Actual public utterances preserve their speaker/audience and activate only the corresponding accepted disclosures. Omitted, failed and interrupted utterances do not activate a complete intended claim.
8. No-tool conversation uses one KP generation when the provider supports the specified result protocol. Any additional request has an actual read/settlement/recovery dependency; hidden handoff, coverage and author calls fail the test.
9. Available Mod rules remain usable without mandatory whole-turn classification. Exercise public dice, item transfer/cash and a structured choice through their real owners.
10. Pure OOC creates no fiction; mixed OOC retains channel separation without sending hosting explanations through an NPC's speech.
11. Cancellation before exposure, mid-stream interruption, duplicate events, failed publication and restart preserve exact text/effects. Completed-cache recovery uses the same bytes without generation or rerolling.
12. Context contains the actual question, relevant verbatim exchange, actor cognition and usable source text. Changed state refreshes affected data; omitted context remains explicit and recoverable. Background failures do not block ordinary dialogue.
13. A recoverable narrative inconsistency does not start a hidden reviewer/retry loop or freeze the turn. Continue natural interaction and assess later clarification; retain the original utterance and any necessary additive correction without rewriting history. A readable but imperfect response alone does not fail the whole live episode.

### Real gameplay and App acceptance

- First use the canonical RPC play driver with this main session as the sole natural-language player, one utterance and response at a time. Continue through a coherent interaction with consequences and later reuse; no fixture narrator, scripted player, keyword route, synthetic turn batch or fabricated campaign is live acceptance.
- Judge causal continuity across turns, meaningful responses and player agency rather than sentence-level perfection or exact conformity to an authored script. Coherent improvisation and recoverable mistakes are valid play. Allow the KP to clarify local discrepancies in subsequent natural interaction. Stop only for a real gameplay blocker, a serious contradiction that continued interaction cannot reasonably resolve, unauthorized replacement of player choice, incorrect settlement or system/resource failure; do not stop merely because a scene differs from the book or a reply contains a minor error.
- Then exercise the canonical installed App using the same production paths. Record bundle/source identity and actual model profiles. Read the current macOS hygiene policy before packaging or GUI work and use its single canonical bundle location and signing requirements.
- Cover a natural NPC follow-up, an appropriate real check, an item/resource interaction, selective knowledge, a future intention and resume. Their order is determined by play, not a forced scenario script. Mechanical fault cases unavailable naturally belong to integration evidence, not invented live outcomes.
- For a representative non-instant reply, retain at least three timestamped viewport captures or video samples with increasing visible body text, including partial text before completion. Associate those samples with the same delivery identity and public deltas. DOM text, mounted offscreen nodes, a progress spinner and backend SSE alone fail this gate.
- Start with the transcript following the latest turn and verify prose enters/stays in view when the tool group finishes. Separately scroll upward and verify deliberate history reading is respected. Do not manually reposition the viewport to hide a product follow failure.
- Verify speaker styling during partial markup and completion; public dice and item/choice UI remain present, correctly attributed and unduplicated after reload.
- Record first actual public paint separately from first model thinking, first backend delta and final publication. A fake typewriter, delayed playback or extra text inserted to manufacture three frames invalidates the result.
- Preserve failed and superseded runs with actual profiles. Report missing or unobserved items explicitly; no fixed turn count, test total, complete JSON object or pleasant isolated sample substitutes for this acceptance.

### Existing prior art and execution limits

Use the current event/perspective integration tests, publication failure and ask recovery cases, final-delivery reducer/history tests, speaker/mechanics tests and the real driver. Adapt their expectations to one author without removing mechanical, privacy or idempotency assertions just to make tests pass. Prefer this single high seam with targeted transport/fault checks over a new broad test framework.

Use bounded ablation comparisons at these same seams: remove a redundant stage, observe actual request count, serial waiting, conversational continuity and retained rule/state behavior, and keep the smallest design that meets the requirements. Add replacement behavior only for a demonstrated missing capability or regression. Do not create a combinatorial benchmark campaign, new evaluation service or permanent parallel production path merely to perform ablation. A reduced file count alone is not evidence of a simpler runtime; report which decisions, calls and entities actually disappeared.

Follow the current LAN test-box policy for heavy suites and builds. Keep live model calls, packaging and GUI acceptance on the Mac. The specification task runs none of these tests and claims no implementation result.

## Out of Scope

- Implementing, refactoring, committing code, changing settings, building or installing an App during this specification task.
- A new production kernel, Python restoration, second event store, alternative worldline engine, generic workflow framework or broad dependency upgrade.
- Rewriting scenario content or inventing facts for the Knott exchange to make the example answer appear better.
- Global model-default changes, removal of DeepSeek from retained helpers, or changing unrelated setup/source readers.
- Removing actual rule enforcement, player agency, disclosure provenance, pending choices or recovery to hit a latency target.
- Perfect semantic secrecy, guaranteed literary quality, or a fixed universal provider response time.
- A permanent additional reviewer, NPC dialogue agent, post-author rewriting service or renamed version of the removed pipeline.
- Speculative abstractions, duplicate stores, generic orchestration/protocol frameworks or new entities without a demonstrated need that existing owners cannot meet.
- Zero-error narrative certification, new semantic gates for ordinary replies, mandatory immediate repair of minor mistakes, or restarting play solely to conceal an imperfect answer.
- Backfilling historical campaigns with inferred canonical events, relabeling old model attribution or deleting evidence.
- Closing unrelated issues, absorbing other owners' edits, pushing code or deploying a second App copy.

## Further Notes

### Current-source audit and implementation navigation

These paths are inspection aids outside the implementation decisions; future implementation must verify the current owning source.

- Existing canonical records and consumers: `kernel-ts/turn-events.ts`, `kernel-ts/apply/index.ts`, `kernel-ts/npc/perspective.ts`, `kernel-ts/npc/intents.ts`, `kernel-ts/memory/recall.ts`, `kernel-ts/write/index.ts` and `kernel-ts/write/delivery.ts`.
- Current control and NPC-first paths: `runtime/jev/hybrid-engine.ts`, `runtime/jev/step-policy.ts`, `runtime/jev/npc-act.ts`, `runtime/jev/npc-act-step.ts` and `kernel-ts/npc/act-options.ts`. The current closed ways omit an ordinary immediate speech result; fixing that enum alone is not this design.
- Context: `extensions/table/context-runtime.ts`, `extensions/table/keeper-support-lookup.ts` and the existing Jev support/prescreen owners. Preserve relevant retrieval, actual request visibility and source identity rather than rebuilding the memory system.
- Current final-author and transport owners: `extensions/kernel/final-output.ts`, `extensions/kernel/index.ts`, `runtime/final-output-stream.ts`, `Electron/packages/pi-backend/src/final-delivery-history.ts`, `Electron/packages/ui/src/transcript-model.ts` and `Electron/packages/ui/src/CocStreamingProse.tsx`.
- Existing highest-seam tests include `tests/extension/turn-events.test.mjs`, `tests/extension/run-driver-output.test.mjs`, the final-delivery UI/backend tests and `tests/play/driver.ts`.
- Contract amendments belong to `docs/kernel-rpc.md`, `docs/pi-host-contract.md` and affected clauses of `docs/adr/0006-pi-native-single-loop.md`; preserve `docs/adr/0001-campaign-git-history.md` publication authority. This spec describes those amendments but does not edit them yet.
- Superseded authoring/control requirements occur in `docs/specs/run-driver-streaming-output.md`, `docs/specs/final-output-materials.md`, `docs/specs/keeper-output-material-handoff.md`, `docs/specs/npc-acts-first.md` and the associated single-loop policies. Preserve event/storage semantics from `docs/specs/turn-events-and-perspectives.md` while replacing its independent-author interface clauses.
- Current event spec evidence establishes storage and selected consumption seams, not general dialogue quality. Its retained live evidence includes four canonical events and selective cognition use, but no live planned-intent adoption. Do not generalize those limits away.
- The latest App latency breakdown and offscreen streaming failure are retained under `.coc/playtests/run-driver-streaming-20261013T112743/`. They are diagnostic baseline evidence, not successful visible-stream acceptance.

### External cross-check

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) recommends starting with the simplest effective design and treating extra agentic steps as latency/cost tradeoffs. This supports removing unproven handoffs; it does not prove one KP will write better in this game.
- [TypeSafe introduction](https://docs.typesafe.ai/introduction) describes narrow typed judgments rather than generative narration. [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out) supports batching independent questions. Neither requires delegating ordinary character conversation to an action-classification pipeline.
- [LangGraph streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming) separates model-token, state-update and custom progress streams. [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) separates recoverable execution from retained application data. These support retaining transport/state owners while simplifying authorship; no LangGraph dependency is proposed.

### Publication record

Publish this document's specification to the existing GitHub issue tracker with `ready-for-agent`, as requested through the to-spec skill. The label indicates specification readiness, not permission to start implementation during this task. Keep local document and issue text aligned. Record the created issue URL in the task handoff; no old issue is closed or modified by this publication.

### Implementation ledger

Owner authorized implementation after reviewing the specification. Work starts at a45b22c5f on 0.9.7a. Preserve the shared dirty checkout; the current source baseline is retained under `.tmp/single-keeper-streaming/baseline`. Earlier task-owned streaming deltas remain identified against `.tmp/run-driver-streaming-output/baseline`; neither baseline grants ownership of other edits.

Sequence: same-KP delivery through the real Pi/TS seam; remove mandatory orchestration and duplicate authoring; preserve context, transaction and disclosure consumers; focused checks and review; one final full suite; real driver and canonical App viewport acceptance; scoped local commit. The confirmed seam and model rules above apply. No acceptance has passed for this implementation yet.

Implementation decision after the first live trial: default public output uses the existing decoder with a short {{public}} / {{reference}} channel marker and native prose. Canonical writes remain existing tools. A nested private-record plus escaped-prose JSON produced repeated formatting failures; it is retained only as a compatible input, not demanded from normal play. This reduces protocol burden while keeping one KP, separate private/public channels and the existing publication owner.

Live progress: the nested-JSON trial is retained under `.coc/playtests/single-keeper-live-20261013-grok/` as a failed protocol experiment. The native-prose trial completed two turns in 20.4 s and 27.9 s with real Grok 4.5/low (Luna saturation preserved separately). Turn 16 committed the notebook append and a canonical event; the first future undertaking was only in activity/prose, so planned-intent acceptance remains open. A real process restart continues under `single-keeper-restart-20261013-grok`. No App viewport success is claimed yet.

Test retirement: obsolete controller-specific suites for automatic NPC acts, mandatory prescreen/compile/route, policy-origin clerk writes, automatic consequence selection and retained automatic chase/attack preparation were removed with those owners. Their failures are preserved in the first full-run evidence, not relabeled as passes. Canonical rule/state tests remain; replacement `run-driver-output.test.mjs` verifies the native same-KP boundary, real rule results, disclosure, cancellation, persistence and pending choices. The retained provider, source, document and public-rendering tests are being migrated individually where their responsibilities still apply.

Implementation checkpoint (2026-10-13 12:41 UTC): default transport is native prose after `{{public}}` / `{{reference}}`; the earlier JSON envelope is accepted only for compatibility. The production RunDriver performs native model tool continuations, reuses the source-answer carry port without a foreground waiting gate, and invokes no separate prose author. Recovery was corrected to inspect operation outcomes at turn close and preserve reference scope after publication failure. The current direct Pi/TS seam file passes 11 tests, parser 6, backend/UI focused checks pass, and the host type comparison introduces no diagnostics (100 remain versus the pre-change baseline's 113). First full run `run.nxiu7qpy` on amax: extension 5,537 passed / 366 failed before retirement/migration of obsolete controller assertions; native integration 2,094 passed; routing 12 passed. This full run is not a green acceptance claim. The next extension run is active in `.tmp/single-keeper-streaming/ext-current.log`.

Real Grok fallback play continued through the Macario interview, a night/time advance, and return to Knott. The notebook append, event knowledge and planned intention have real receipts. Turn 18 recorded `intent:steven-knott:64b020ddca64` as planned; it survived a process restart and reached Knott's full perspective on return. Turn 22 narrated its attempted offstage search without updating the plan; turn 23 naturally reconciled the same intention as abandoned (no documents found), with new heard knowledge. This one-turn lag is retained as an observed narrative/state imperfection, not hidden or called an immediate success. No reviewer or rewrite was added. Current driver run `single-keeper-cognition-20261013-grok` is stopped. The canonical App package is building with cached archives and LAN runtime builds; viewport acceptance is still outstanding.

App checkpoint (2026-10-13, package 12:41:27 UTC): native captures in `.coc/playtests/single-keeper-app-20261013/native-1243/turn2-growth-{1,2,3}.png` visibly show an unfinished first paragraph, the completed paragraph, then the beginning of the second. Their timing/delivery association is in `turn2-shots.json`; `growth-1.png` from the preceding turn was captured too late and is not incremental evidence. The first three new App responses completed in 33 s, 28 s and 22 s. The item transfer and concealed Psychology card appeared once, with the concealed figures absent. The subsequent move/NPC exchange took 59 s. Actual main model was Grok 4.5/low after the retained Luna saturation; the product fast helper remained DeepSeek Flash/off.

That App round exposed two genuine transport defects, so viewport acceptance is not closed: a deliberate history jump was overridden on the next body update, and nested `{{say:{{name:...}}}}` emitted stray closing braces while streaming. Focused regressions reproduced both; the fixes require a downward user gesture before re-enabling detached follow and consume a complete nested name marker in the existing speech parser. The 31 UI checks and the pure canonical nested-speech check pass. A fresh canonical package is building for revalidation.

The owner also observed untranslated initial equipment and item-transfer names. Inspection found the existing possession collector intentionally excludes names, assuming those are already authored in the play language; this campaign's initial equipment names have no stored projection. This is a separate recorded vocabulary coverage gap, not a claim that automatic translation was removed or repaired in this change.

Full extension run `run.q14NBJOa` completed with 5,412 passed, 78 failed, one skipped (5,491 tests). Remaining failures were classified individually: removed mandatory controllers and old output-argument protocols require retirement/migration, while provider recovery, source carry, publication, privacy and current UI assertions remain binding. Native historical search was found disconnected by controller removal and is restored as an optional capability of the same inference, using the existing Mod/provider boundaries without an additional need classifier. Retained provider tests are being moved to the explicit public/reference channel; no failed run is relabeled as green.

Canonical App revalidation (package 2026-10-13T13:10:24.332Z, stable PipiUI Dev signer): `native-1243/final-build-growth-1.png`, `-2.png`, and `-3.png` visibly progress from a partial first paragraph to additional paragraphs and styled NPC speech, all inside the transcript viewport. Their common delivery id and capture intervals are stored in `final-build-shots.json`. No delayed typewriter or replay was used. `fixed-history-completed.png` remains on old turn-0/turn-2 material after the current turn completed; `fixed-return-latest.png` returns to the new reply with both NPC speakers styled. A real App restart retained prior prose/mechanics without duplicated delivery. Full machine-readable evidence is `.coc/playtests/single-keeper-app-20261013/acceptance.json`.

The accepted App episode had six new delivered turns. The first three were 33 s, 28 s and 22 s; moving and gathering source material took 59 s; the post-restart registration took 40 s. One subsequent social resolve omitted a required skill and was refused without a roll; the KP continued ordinary dialogue without a retry loop. The two Psychology calls are one concealed check and its existing player-safe realization, not two dice rolls. These are measured samples and retained imperfections, not a promise that every turn finishes within that range.

Post-fix focused evidence: 130 fast tests, 18 direct-driver/parser/speech tests, 31 transcript/speech UI tests, backend typecheck, and a zero-new-diagnostic host comparison (100 existing diagnostics versus 113 before implementation). The final all-suite attempt could not reach amax; leehow-pc's older dependency lock was refreshed strictly offline from existing caches, and its final full run is ongoing. No all-suite success is claimed until its exit and per-phase results are checked.

Final review found and reproduced stale native context snapshots retained as unknown custom messages. New snapshots now use the existing `coc-clerk` and scoped `coc-host` owners; the context projection also expires the two earlier native custom types before the current boundary without altering saved history. The focused regression passes for current/unknown context preservation. The native model-step identity and inference event now use their existing telemetry fields, and the retired expression selector receives no decision port on single-Keeper play. Twelve retained source/carry/telemetry/search checks, six current native/search/expression checks, and the three context expiration checks pass. The latest host diagnostics match the prior 100 exactly after normalizing source line offsets.

A final tool-schema audit found obsolete field guidance still asking for mood writes before NPC speech and a removed handoff. Single-Keeper tool projection now replaces that guidance with optional state recording and direct final publication, without changing validation shapes or legacy paths. The regression covers both lean on/off settings and preserves TypeBox markers; all three focused schema tests pass.

Final full run on leehow-pc (`run.mNLTnHYX`, 992 s): extensions 5,433 passed / 7 failed / 1 skipped (5,441 tests), native TS integration 2,094 passed, routing 12 passed. Exit remains 1 in the original record. The seven failures belonged to four files: stale native-source carry and missing step telemetry, plus two legacy protocol/setup fixture migrations. After the fixes, the final source was rebuilt on the box and all six affected/context/schema files were rerun together: 96 passed, zero failed. Evidence is retained at `.coc/playtests/single-keeper-app-20261013/final-tests/`; the original full result has not been relabeled. Final package/restart acceptance follows this source checkpoint.

The 13:35:42 canonical package (`7422c6c06`) restarted successfully but its first follow-up was undelivered after 28 s. Both model attempts completed with text; the decoder refused the output prefix before exposure. No public delta was emitted. A real-provider-request seam regression confirms the current single-Keeper instructions and actor context reach the model, so instruction omission is not established. The original refused text was not retained by the previous error telemetry. The existing private `keeper-delivery` diagnostic now preserves rejected reply bytes, actual model and stop reason; a regression proves this does not expose them to the delivery stream. This package's failed follow-up is not final acceptance.

The diagnostic package (2026-10-13T13:43:36.352Z, base `7422c6c06` plus the private diagnostic delta) continued the same App campaign naturally. Turns 11 and 12 delivered in 27 s and 49 s. The last reply's native viewport screenshots `native-1243/accepted-release/growth-{1,2,3}.png` show a partial first paragraph, more complete text plus a partial second paragraph, then a third paragraph beginning. They share delivery `f773c69672a631ef649f2efcf8a0de03ee69a1e486f62b417868aa3acf0352cc`; capture-start lengths are 32/82/133 characters and intervals are in `accepted-release/shots.json`. All three were visually inspected. One object operation was refused, followed by adoption explicitly naming the existing notebook equipment; no extra roll was created. The full direct Pi/TS driver seam file now passes 13 tests, including actual outgoing instructions and private retention of rejected bytes. The final App evidence and package provenance are updated in `acceptance.json`.

Residual limitations stay explicit: turn 10's intermittent prefix-decoding failure is not diagnosed to its original byte sequence or claimed repaired; subsequent coherent play and viewport streaming do not erase it. Initial English equipment/transfer-name projection remains a separately identified vocabulary coverage gap. The implementation does not claim perfect semantic secrecy, zero tool errors, or a universal time limit. No further reviewer, classifier, prose rewrite, storage entity or automatic gate was added to chase those claims.
