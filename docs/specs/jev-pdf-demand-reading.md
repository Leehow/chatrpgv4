# Jev PDF demand reading with source dependency coverage

Status: source-reference correction implemented; whole-turn performance and installed-App acceptance remain open
Correction evidence: [original source and incremental publication](../research/jev-source-fragments-acceptance-20260928.md).
Execution: implementation authorized 2026-09-27 and recorded in the [implementation acceptance report](../research/jev-pdf-implementation-acceptance-20260928.md). Native source decisions, staged readiness, advisory module review, background scheduling and public UI progress are implemented. Measured latency and continued-play gaps remain explicit; source changes are not an installed-App release.
Date: 2026-09-27
Baseline inspected: 0.9.6a at 58f5889d3341b7d90fcc9e7cf0fe4108530579b6.
Implementation input: use the [minimal-entry prototype](../research/jev-playable-entry-prototype-20260927.md), [native Pi mechanism prototype](../research/jev-native-pi-reader-20260927.md) and [ticket breakdown](jev-pdf-demand-reading-tickets.md). Actual player-wait targets remain pending real-protocol validation; the earlier broad dossiers cannot set them.

## Latest approved foreground contract (2026-09-28)

Contract section 150 additionally separates reference coverage from permission to play. Ordinary compatible places, people and evidence may be established during the Keeper's normal turn. Source misses remain unknown coverage; they do not mandate adaptation or block improvisation. Only a concrete missing fact needed for the current adjudication justifies further foreground retrieval. Ordinary scene arrival does not require its complete source dossier. Later source publication preserves established campaign identities and values.

The owner corrected the foreground design after the 94 s creation / 222 s opening result. [Contract §148](../kernel-rpc.md#148-original-source-context-is-immediately-usable-graphs-publish-incrementally-2026-09-28) supersedes older requirements below that make graph writing or independent graph review a creation/play prerequisite. Jev selects exact original passages; the host copies them into one final public-guide generation. Source-backed entrance context unlocks creation and play while small graph fragments are authored, logically reviewed and published independently. Missing graph coverage is supplied by original-source lookup. Creation advice and warnings never enforce a character build. Parameters/prose may differ from the book; causal links, identities, knowledge boundaries and established table canon remain the priorities.

Prototype: `178ab2c9fbf7a2353b0a6b1458f955721452f2ef` on `codex/prototype-source-fragments-20260928`. Checked source-guide timings were 18.672 s (Blood) and 17.047 s (Masks); these are not integrated player-wait measurements. The source reference packet identifies partial coverage and unassessed visuals. The existing original-page route handles visual interpretation and unavailable text.

## Problem Statement

玩家交出 PDF 模组后，应当尽快完成开场选择、建卡并开始游戏。当前方案让昂贵的视觉读者承担大量找页、重复看图和重复审阅工作。Masks 的交接记录报告首次开场等待 13.5–16 分钟；读者成功退出或索引合法，都不足以证明这个等待合理。

用户同时要求按需读取尽可能不损失完整性：当前出现的角色，可能在后文才解释其秘密、未来行动和线索；当前可用物品、模组规则、NPC 参数也可能分散在附录。只找到最像玩家问题的几页，不能证明材料够用。未来章节中的事实可能从第一次互动就影响守秘人的表现。

2026-09-27 对保留证据的只读复算：

| 同一次 Masks opening 的阶段 | 模型调用 | 输入 token，含缓存读取 | 页图发送数 | 累计图片字节 |
| --- | ---: | ---: | ---: | ---: |
| 作者读取 | 28 | 2,214,099 | 546 | 457,843,618 |
| 独立审阅，20 个单元 | 175 | 3,960,190 | 228 | 205,238,451 |
| 合计 | 203 | 6,174,289 | 774 | 663,082,069 |

作者实际打开 21 个不同物理页，其 21 张不同图片仅 17,396,224 字节。合计输入中 5,223,040 是 cache-read token；不得把它们全部按新增输入价格计费。此表不包括其他导入任务，也不是整个模组的总成本。

两次 index 加 index-audit 的累计输入分别为 1,644,424 与 2,164,691，图片发送数为 472 与 656。交接中“157/142 页”是两个阶段的页数之和；任务合并后的不同物理页分别为 85/78。index 已有后台调度，记录中与 opening 有重叠，不能把它的全部耗时直接当成前台串行阻塞。

当前 Jev fresh-source navigation 只向首次 skeleton 注入页面角色提示；它未贯穿 opening、guidance 与 detail。页图按最近若干张保留，后续写文件或修复结构时仍反复发送。coverage 审阅主要检查作者已经查看的页，跨章节的未知关联仍可能在作者和审阅者之间共同漏掉。

## Solution

首要目标是玩家迅速可玩。前台分成两个小的准备阶段，后台持续解析其余内容：

| 阶段 | 前台需要完成的材料 | 玩家可以做什么 |
| --- | --- | --- |
| 建卡前 | 时代、地点、简短背景、调查员适配与建卡限制，以及必要的开场选择 | 开始并继续建卡 |
| 首场景 | 选定开场的呈现、当前人物和线索、马上需要的规则与参数，以及改变当前互动的异地依赖 | 确认卡后进入场景，提出行动并得到有依据的回应 |
| 持续后台 | 后续章节、人物后续关联剧情、线索联系、规则、物品与参数逐步读取、复核、发布 | 持续游玩；遇到尚未准备的实际需求时优先补读 |

选定开场后，在玩家建卡期间预取首场景。建卡完成不应成为首场景准备的默认起点；只有依赖最终卡面选择的部分才等待它。更长的书主要增加后台工作量，前台用时应主要取决于建卡简报和所选首场景的复杂度。扫描质量、必要依赖或定位困难造成的额外等待须实测报告，不能承诺所有模组耗时相同。

宿主维护可渐进增长的原文定位层；Jev 对具体页段和具体问题做闭合判断；宿主精确取出原文并调度补读；带工具的 Pi 读者完成提取与独立原页复核。TypeScript 内核继续拥有准备状态、规则校验、数值与世界事务。轻量物理页登记可以覆盖全书，但全书语义扫描、完整图谱和所有参数不是两个前台阶段的共同前置条件。

当前必要信息仍须完整：后文秘密若改变当前 NPC 的动机、谎言或行为，就要及时补入；完整后续剧情交给后台。未检查或不可靠的材料必须显式保留；“Jev 分数低”“没有文本匹配”“预算花完”均不能变成来源不存在或全书已完整。

这是对现有 source reading 与 Jev runtime 的扩展。先保留现行原页证据和独立审阅强度，消除找页与上下文的重复工作；改变正式事实的证据标准不在本轮范围内。

## User Stories

1. As a player, I want to choose a source-authored opening sooner, so that importing a book does not consume the beginning of the session.
2. As a player, I want character guidance to reflect the chosen opening, so that a faster import does not produce an unsuitable character.
3. As a player, I want to start before unrelated chapters are fully prepared, so that the book's length does not dictate my initial wait.
4. As a player, I want later discoveries to remain consistent with earlier NPC behavior, so that delayed reading does not rewrite the mystery.
5. As a player, I want the clues I can discover to retain their authored connections, so that selective reading does not break investigation paths.
6. As a player, I want module-specific rules and exceptions to apply when relevant, so that speed does not change the game's consequences.
7. As a player, I want an item's actual conditions and effects available when used, so that an incomplete description does not authorize the wrong outcome.
8. As a player, I want NPC values to come from the correct source and edition, so that the Keeper does not guess missing parameters.
9. As a player, I want maps and handouts to preserve their reveal boundaries, so that private annotations do not become public knowledge.
10. As a Keeper, I want to locate material before a graph entity exists, so that unprepared chapters remain discoverable.
11. As a Keeper, I want a person's aliases, hidden identity and later references considered, so that matching only their present name does not omit a necessary fact.
12. As a Keeper, I want scenario-wide facts and active exceptions carried with local material, so that a locally correct reading does not contradict the book.
13. As a Keeper, I want partial-answer and uncertain passages retained for further checking, so that one threshold does not remove an essential part of the answer.
14. As a Keeper, I want newly found references followed across chapter boundaries, so that required dependencies are prepared before I rely on them.
15. As a Keeper, I want current requirements distinguished from deferred future material, so that a local task does not expand into full-book extraction.
16. As a Keeper, I want exact source excerpts and conditions beside the selected material, so that I do not reconstruct them from routing labels.
17. As a Keeper, I want known material reused and gaps shown, so that a warm query does not restart the same discovery work.
18. As a Keeper, I want a Jev outage to use the existing source-reading fallback, so that routing availability does not invent facts or erase dependencies.
19. As a reader, I want to persist sourced work while images are available, so that later edits can use the retained evidence without automatic image replay.
20. As a reader, I want to reopen an exact page or crop explicitly, so that removing stale image payloads does not prevent careful verification.
21. As an independent reviewer, I want to inspect original evidence independently, so that an author's notes do not become proof of their own correctness.
22. As an independent reviewer, I want to discover relevant omissions beyond the author's selected pages, so that shared retrieval blind spots do not pass coverage review.
23. As a reviewer, I want the assigned records and necessary context supplied together, so that I do not reload an entire candidate for every small review unit.
24. As an operator, I want every physical page accounted for as usable, uncertain or not yet covered, so that text extraction does not silently discard visual content.
25. As an operator, I want text-rich pages with maps or sidebars considered for visual discovery, so that text density is not mistaken for completeness.
26. As an operator, I want source identity and cache versions checked, so that another edition or campaign's material is not reused accidentally.
27. As an operator, I want cancellation and restart to preserve accepted work and pending dependencies, so that interrupted preparation is recoverable.
28. As a maintainer, I want measurements covering navigation, authors, reviewers, retries and background work, so that savings are not obtained by moving costs off the reported path.
29. As a maintainer, I want new input, cache reads, output and actual billing distinguished, so that token reductions are not confused with price reductions.
30. As a maintainer, I want behavior verified through existing source operations and the actual outgoing model request, so that helper tests cannot hide missing integration.
31. As a tester, I want cold imports, warm reuse and natural play checked on both long and short modules, so that one tuned example does not stand in for product acceptance.
32. As a maintainer, I want accepted graph facts, world state and disclosure authority preserved, so that better retrieval remains a read capability.
33. As a player, I want only the small module brief needed for creation before I begin, so that full NPC dossiers and later chapters do not delay my character choices.
34. As a player, I want my selected opening prepared while I create my character, so that confirming the card leaves little additional source wait.
35. As a player, I want to make a meaningful action immediately after the opening, so that an early narrative paragraph does not hide an unprepared scene.
36. As a player, I want background reading to progress while I play, so that later demands can reuse increasingly complete material.
37. As a player, I want a newly needed source fact to take priority over background work, so that speculative preparation does not delay my current action.
38. As a player, I want to see which public creation facts are being located and see each result as it becomes available, so that the preparation wait helps me understand the module.
39. As a player, I want confirmed era, starting place and source-backed creation advice to remain visible as other work continues, so that progress does not disappear behind a generic spinner.

## Implementation Decisions

### D0. Two foreground readiness gates

The creation gate requires only the brief, suitability advice or warnings and opening choices that affect character creation. Authored recommendations must be presented with source support, but a player can confirm a card that differs from them. The first-scene gate requires the chosen scene and its immediate causal/mechanical dependencies. Neither gate depends on whole-book semantic classification, a complete graph, every NPC profile or unrelated background job completion. Existing readiness/publication contracts express these scopes. Per the 2026-09-28 owner ruling, module review prioritizes logical consistency and relationships; exact wording and executable parameter agreement are advisory, while core rules and data validity remain enforced.

An early paragraph or enabled input alone does not prove playability. The Keeper must be able to respond to an ordinary source-dependent opening action through the existing game path. If a missing fact changes the current decision or consequence, its dependent operation waits for a prioritized source read; unrelated creation/play remains available. Do not invent a safe-looking default to bypass missing evidence.

Begin selected-scene preparation as soon as the opening is known, overlapping character creation. Bind reusable work to its source/opening; final character choices invalidate or supplement only dependent material. A changed opening reprioritizes work and retains valid source evidence. Complete future NPC histories and parameter sheets enter current scope only when the current use requires them.

### D1. Reuse the existing owners and proof classes

Extend the current PDF source owner, ReadingService, exact SourceRef materialization, reader runner, independent review and module publication gate. Source reading uses the existing vendored Pi RunDriver through SessionRunDriver, with a reading-specific policy and source/decision/projection ports. Jev uses the existing DecisionAdapter and scoped budget leases inside a decide step. This is not an external Jev prefilter followed by an unchanged model-first reader, and it does not introduce another TaskRuntime or agent loop. Existing play-time plaintext consultation and index-text landing retain their present limited authority; this work does not promote them to accepted parameters or reviewed graph facts.

The current product already has Pi-native decide/infer/operate/scope/wait/finish support. Its Keeper hybrid entry injects that driver, while setup is currently selected as legacy and the reader launcher starts the ordinary Pi CLI without driver injection. The implementation gap is source-session policy/port/entrypoint wiring, not the absence of a general driver. Do not pass the Keeper's campaign/turn policy unchanged to a reader; reading has source/task identities and artifact completion, not player-turn settlement. Preserve separate author/reviewer session contexts for independent review.

Structural steps use operate directly. Jev chooses among actual source candidates and genuinely open next steps. An LLM tool proposal is executed once through Pi's real tool pipeline; it is not semantically re-reviewed by Jev before execution. A new bounded source question raised by that tool result can trigger another native decide/operate sequence before the next infer. Host source evidence enters through the projection port as host messages; no assistant response or model tool result is fabricated to disguise a host operation.

Production must define source-artifact completion evidence explicitly. The prototype leaves the generic run undelivered with source_artifact_complete_no_player_delivery and separately validates the artifact; this is honest experimental accounting, not the final production status contract. Never manufacture narrate/ask receipts or player-visible delivery merely to close a source task.

Navigation identifies possible evidence. Viewed source images establish access to evidence. Accepted independent review permits the existing publication owner to prepare the material. Only the normal game operations authorize disclosure and settlement. These stages remain distinct in persisted state and telemetry.

The first code-bearing slice must amend the current RPC contract at the next free section number, with explicit links to the source-reading, source-reference and reading-budget contracts. Each later slice records its own decision before changing code. This specification does not claim that those contract amendments are implemented.

### D2. Whole-document navigation with bounded work

The source owner enumerates physical pages and mechanically extracts their native text, labels and bookmarks. Cached page text retains exact ranges and source identity. Extract usable ranges progressively; a cheap whole-book native extraction is allowed when measurements justify it, but semantic inspection of every page is not a mandatory foreground gate. Jev sees bounded groups with local context rather than the entire book in one state. Independent page/facet questions share a request where they fit; dependent follow-ups wait for the previous result. Existing bounded concurrency, retries, cancellation and allowance owners remain responsible for resources.

Account for every physical page: usable native text, extraction failure, empty text, ambiguous text, visual discovery pending or inspected. A page may have both usable text and unresolved visual content. Character counts, image-object presence and page geometry are structural observations only; they cannot decide whether a page contains a map, a rule or an important clue.

The navigator caches native text, request-specific judgments and located material by immutable source, extraction version, decision policy/model and relevant request. A generic page-role index is optional navigation metadata, not a mandatory first inference stage: the sandbox found that building it before the first query added work and only weakly reduced the candidate set. A new focus may require a broad semantic pass; repeated unchanged requests reuse prior work. Do not put a fresh full-book model scan on every player input or make all-page deep reading a prerequisite for character creation.

Native outlines, Jev roles and reader-confirmed navigation can coexist with explicit provenance. They do not become interchangeable source proof. The existing index's viewed-heading/reference requirement must be honored or explicitly amended; do not insert unviewed Jev rows and label the current index complete.

### D3. Candidate recall precedes narrow judgment

Candidate pages may come from the entire bound PDF, not only prepared graph entities or nearby chapters. Use actual source content in Jev state. No semantic keyword lists, regex intent classifiers or lexical prefilter may silently exclude pages before Jev. Existing exact source-word/name lookup can remain an auxiliary navigation tool without defining the recall universe.

Judge direct answer evidence, useful partial evidence and contextual/dependency leads separately. Multiple pages can all apply; no single Choice selects the only relevant page. Broad ranking orders inspection, then narrow evidence questions check concrete conditions. Do not adopt the prototype's failed universal 0.7 gate. Thresholds and uncertain handling are calibrated against JPDF-01's calibration cases, recorded by decision family and frozen before held-out evaluation. A failed held-out case remains a failure of that policy; subsequent tuning requires a new held-out set and preserves the original result.

Jev cannot generate new names, quotations, open-ended questions or relationships. The host owns closed candidate references and exact original bytes; the tool-enabled reader interprets aliases, hidden identities, cross-references and unresolved open questions. The same-state decisions are bounded judgments under the existing Jev contract, not a replacement zero-tool text extraction lane. Every new inference call site is inventoried with its owner and budget.

### D4. Current material includes necessary distant dependencies

Each read carries its requested use, focus, source binding, already accepted facts and known dependencies. The reader and navigator consider scenario-wide constraints, people, later role/plot references, clue connections, special rules, item effects and required parameter sources as separate facets. These are closed coverage dimensions, not a hand-authored dictionary for classifying source words.

A later revelation that determines today's motive, knowledge, lie, identity, immunity or gate belongs to current material. A later location's full encounter can remain deferred. Stage in the story or physical distance in the PDF is never the sole reason to defer a fact.

Known necessary dependencies must survive ranking and final request budgeting. New references extend the reading frontier; exact duplicate source material is shared. Continue until the current use's required dependencies are supported, or return an explicit unresolved outcome with resumable work. A budget or hop limit is a resource stop, not a completeness verdict. Cycles are detected mechanically without dropping new evidence or changed questions.

The native prototype exposed a concrete missing third attacker profile in Masks. Writing that need into unresolved did not itself cause another read. Required unresolved entries and independent-review missing findings therefore have an explicit reader: the source policy turns them into bounded source requests and consumes the returned evidence before dependent readiness. Retained tasks resume from those entries without rewriting earlier accepted facts. A new scope is different evidence; the same failed local candidate set is not repeatedly judged as progress. Optional questions and genuinely unstated details remain distinguishable from necessary current dependencies.

### D5. Persist dependency status without inventing another fact graph

Extend the current reading job/material state with a source-bound dependency ledger. Each entry records the owning focus/use, source locations or the bounded question still to locate, why it matters, its current/deferred classification and supporting judgment, review/publication references when accepted, and the next continuation. Use existing host-minted references; model-visible aliases remain semantic.

The ledger distinguishes at least unresolved current dependencies, located but unreviewed candidates, accepted dependencies, deferred future material and unavailable evidence. Exact field names and transitions are finalized in the contract before implementation. Navigation confidence alone cannot advance an entry to accepted. The current draft's unresolved dependencies cannot be deleted merely to pass publication; deferred entries live outside the draft's requirement-to-empty list and preserve their reason.

| Producer | Reader / projection | Action and observable result |
| --- | --- | --- |
| Source owner and Jev navigator record candidate locations and coverage gaps | ReadingService's bounded task input | Reader opens source evidence or retains a resumable unresolved dependency |
| Tool-enabled reader records source-backed relationships and newly found needs | Independent reviewer and existing publication gate | Supported current material is published; unresolved necessary material prevents dependent readiness |
| Publication owner records accepted dependency material | Existing Keeper source/context preparation | Actual outgoing request contains needed facts and provenance; their use is visible in delivery and normal receipts where an action settles |
| Existing read lifecycle retains deferred entries and uninspected source ranges | Continuous background reading and demand lookup | Spare capacity advances retained source work without a player request; a matching actual demand promotes/reuses the same work and closes or updates its entry |

The Keeper receives actionable material and relevant limits, not a debt list. Deferred entries do not pressure the Keeper to visit an unused branch. Semantic trigger applicability is judged through the existing model-owned path; code may evaluate only already-supported structured predicates, not parse natural-language triggers with word lists. Private future facts remain Keeper-only until the existing disclosure rules permit revealing them.

Located but unselected candidates remain in the source frontier with provenance and explicit unreviewed status. They are not accepted facts or mandatory current extraction. The consuming policy can consult their actual text when a new question or a review finding needs them; a display/sample cap does not delete the underlying candidates.

### D6. Source selection does not authorize mechanics or possession

Module-specific rules, item effects and NPC statistics are located before use and independently checked against their original pages and conditions. Numeric values, units, editions, dice expressions, skill bindings, applicability and explicit absence remain subject to existing deterministic validation. Jev may choose a candidate; it does not synthesize a number or executable rule.

Preserve the distinction between an authored item definition, an object instance, a use and an accepted usage profile. Finding an item in the book does not grant ownership or reset quantity/state. Likewise finding a statistic does not authorize a roll. An unresolved required rule or value retains the existing pending/unavailable path for that operation; retrieval must not replace it with an invented default.

### D7. Visual discovery and image lifecycle

A text-rich page can contain a map, table, illustration, handwritten clue or sidebar whose meaning the native text misses. Navigation therefore retains a visual coverage dimension independent of text availability. Source-native references and low-cost visual navigation nominate candidates; bounded overview sheets remain navigation-only. Relevant candidates are reopened at adequate resolution or as exact crops for evidence. Scanned sources keep the existing visual fallback and may not meet the same speed targets as native-text sources; no OCR pipeline is introduced here.

Within a reader/reviewer phase, keep the active evidence needed for the current work and retire completed image history in favor of source identity and retained sourced work. The initial proposal to evict every image after one successful inference is withdrawn: the sandbox showed extra reopens and higher total cost in a controlled rerun. Compare an active image window and durable reading checkpoints before selecting an eviction policy. A reader can explicitly reopen a page/crop for a new check. An author and an independent reviewer legitimately inspect the same image separately. Failed transport may need a resend: distinguish attempted, delivered/consumed where observable, passive replay and deliberate reopen. A context hook firing does not by itself prove a successful observation.

Use source/page/crop/render identity rather than only tool-call IDs for duplicate accounting. Do not suppress the first useful image, silently lose an image on retry or share an author's unverified notes as an independent review result. Full transcripts and source logs remain immutable evidence; only outgoing request projection changes.

### D8. Independent coverage review and bounded reviewer input

Review node/claim logic, necessary causal connections and map reveal safety. Do not independently retranscribe every numeric or prose field of a module; valid parameter and presentation differences are advisory. Authors and reviewers remain tool-enabled Pi agents. Each review unit receives its assigned immutable records plus required local/global/dependency context, with exact source access for further inspection. Reuse the existing grouping, completion and review-cache owners; avoid repeated loading of the full draft and redundant final model messages when the existing checked completion path suffices.

Coverage review runs source-to-candidate as well as candidate-to-source. It can query the navigation layer beyond the author's selected pages and follow omitted references, including when the draft proposes no clues. It must assess the requested current use and its dependencies; it must not turn every future chapter into required current scope. Another Jev yes/no over the author's page list is not independent completeness evidence.

Reuse accepted review only when the source, exact candidate facts, relevant context, coverage scope and review policy match. Changing an unrelated fact need not force identical evidence to be rediscovered, but any dependency that can alter the verdict invalidates reuse. Existing model/review-version constraints remain until explicitly amended and verified.

### D9. Lifecycle, degradation and compatibility

Cancellation, interrupted writers, Jev outage, partial extraction and context-budget omission preserve accepted material and explicit pending work. Source changes, edition changes and cross-campaign mismatches reject stale bindings. Warm reuse must revalidate relevant identities without rereading the whole source. Immutable source navigation may be reused across campaign forks; accepted campaign state and private projections retain their existing isolation.

Jev unavailable or uncertain uses the existing tool-enabled navigation/read fallback with honest coverage. Do not claim accelerated-path completion when the fallback did the work. Existing campaigns need no destructive reimport, no evidence deletion and no forced full-index rebuild to remain usable. Initial rollout is measurable and reversible; final activation is gated on JPDF-09, not merely on setting an environment flag.

### D10. Cost and latency accounting

One import/query identity joins navigation, read, review, repair, retry and overlapping background work. Record source identity, requested use, unique/opened/resent images and bytes, cache/new/output tokens, model calls, elapsed time, waiting/queue time, cancellations and whether accepted material reached the consumer. Log source labels and references, never credentials or PDF/base64 bodies.

Report wall-clock milestones independently: PDF accepted, creation brief/choices usable, opening selected, selected-scene preparation started/ready, character card confirmable/confirmed, playable handoff, and the first meaningful source-dependent action resolved. Report completion/cancellation of associated background work separately. Measure PDF-to-creation and card-confirmation-to-playable residual wait as primary windows; record actual character-creation time and preparation overlap so a long human pause cannot manufacture a good opening result. Also report the immediate-card-confirmation case through the source seam, explicitly as a diagnostic rather than real play. Do not sum overlapping tasks as wall time.

Separate foreground critical-path usage, opening prefetch, first ten natural turns and later background usage, while retaining one non-duplicated all-work total. Every actual-demand promotion records queue wait, evidence wait and reuse. Unknown billing stays unknown; a placeholder zero is not a measured saving. Moving work into the background can improve player latency without reducing total tokens; claim token savings only from the appropriate measured total.

### D11. Jev chooses executable search scope, with retained broadening

Issue source scopes from actual metadata and evidence: native outline/section ranges where available, existing source references, adjacent physical pages, known related source locations, and the whole bound source. Jev chooses among these with the question and the actual supporting text. The host enumerates pages/ranges and performs reads; it does not infer relevance from keywords or language scripts.

The native prototype's missing-profile experiment chose 18 pages adjacent to references on physical pages 172 and 122, then located the missing profile on page 174. Other 651 pages stayed explicitly unsearched. It reduced that supplement's all-model input from 800,462 to 108,373 while both author/review pairs resolved the same required profile; wall time stayed about 140 seconds. This is evidence for adaptive scope, not a general cutoff or full-book completeness guarantee. The radius four was an experimental parameter, not a fixed product law.

An unresolved local attempt broadens instead of repeating the same candidate set or claiming absence. A fresh/ambiguous request can choose whole-source discovery immediately. Preserve the question, source identity, searched/unsearched ranges and reason for broadening. Cache exact unchanged source material and accepted scope-specific results; do not rescan the whole book merely because a new reading job was created.

### D12. Continuous background preparation yields to actual demand

Extend the existing read queue; do not add a second importer. After the creation gate, available capacity prepares the selected opening and continuously advances remaining source ranges and deferred dependencies through read, independent review and publication. Continued progress must not require a new player question. Full background completion is observable separately and never the foreground readiness flag.

Actual creation/play demand has priority, followed by selected-opening or near-term preparation, then remaining book work. Dispatch background work in bounded resumable units, retain progress and reserve capacity for interactive work. Already running provider calls are not assumed instantly preemptible: specify yield/cancellation boundaries in the contract and measure the resulting foreground queue delay. Reuse or promote identical pending work rather than issuing a duplicate expensive read.

On restart resume retained work; on source/opening changes revalidate affected bindings. Surface an unavailable provider or exhausted budget as pending/paused background work rather than completeness. When foreground demand subsides and resources remain, background progress resumes. Its costs and accepted coverage remain visible, and unrelated background failure cannot revoke already valid foreground material.

### D13. Required source gaps differ from pending runtime inputs

The minimal-entry prototype found that an author can invent an unbounded series of prerequisites: an exact repair price, the timing of a discretionary NPC instruction, or exposure elapsed before any player action. A source task cannot discover live world state by searching the PDF. Retain applicable authored modes and conditional alternatives without merging them into one contradictory fixed timeline. Fix an already selected mode in the source request; an unselected mode remains a decision with a consumer.

Use closed need kinds to distinguish a missing authored fact/parameter, runtime state or ruling, later demand and unresolved classification. Jev can route these needs using the requested use and exact relevant source context, but it cannot independently certify completeness. Preserve the original question and provenance. A bounded candidate can go to independent review with pending inputs; the reviewer must explicitly determine whether each can remain runtime/deferred, or still blocks the current source use. A final uncertain or missing-source finding prevents dependent readiness. Actual required source gaps retain the existing follow-up/repair consumer; the prototype's draft submission is not a production publication receipt.

| Producer | Reader | Action |
| --- | --- | --- |
| Author records an open need; Jev gives a closed provisional classification | Source policy and independent coverage reviewer | Fetch genuinely missing current source, or retain the exact pending question for review without repeated whole-book guesses |
| Reviewer records the supported final disposition and source conditions | Publication gate and existing Keeper/kernel context | Source gaps block the dependent use; runtime inputs are evaluated against actual state/choices before any affected operation |

Freeze closed review fields in the actual tool schema. Do not add a required validator field only in prose and pay for model repairs. Native navigation must consume pagination itself or expose a source-question interface that does so; repeated searches of the same first 50 pages do not count as expanded coverage. Preserve exact-page/crop access and visual fallback.

### D14. Show incremental public preparation facts

During the creation-brief wait, extend the existing onboarding progress channel and preparation panel with a small stable list of public creation fields: era, starting place, public premise and investigator suitability advice or warnings. Update each field from real reading/checking events. Work can happen concurrently; do not manufacture a timed sequence of searches, a percentage or an ETA from elapsed time or field counts.

Distinguish queued, searching, found/checking, confirmed, needs-choice and unavailable outcomes. Show a source-grounded candidate value as provisional only after it is eligible for player disclosure; otherwise show the activity without a value. A confirmed value has passed the source and public-guidance checks required for that field. Emit a field update as soon as that state is established, without waiting for unrelated fields or full opening preparation. Preserve confirmed values while later work continues; unavailable is not equivalent to an authored absence. Once the actual creation gate passes, continue into character creation promptly.

Illustrative Chinese display, projected through the existing player-language path rather than hardcoded language strings:

| Field | While working | Once confirmed |
| --- | --- | --- |
| 时代 | 正在检索时代信息… | 时代：1975 年夏末 |
| 地点 | 正在确认起始地点… | 地点：美国德克萨斯州 |
| 建卡建议 | 正在核对模组建议… | 模组建议：至少一位调查员有车，驾驶技能在 55% 以上；你仍可按自己的选择建卡 |

Only public introductory facts for the bound source/opening are eligible. Do not expose hidden identities, later events, clue solutions, Keeper-only chapter titles, internal source questions or raw diagnostic text through either the displayed activity or its value. Use explicit public-field projections and existing semantic disclosure checks, not keyword redaction. A book with different entry eras retains those alternatives until the chosen entry is bound; it cannot briefly present one era as universally confirmed.

The source worker produces bounded field updates; the onboarding host validates job/source/opening/attempt identity and retains the current public snapshot; the UI renders that snapshot in its existing status region. Stale attempts cannot replace newer values. Resume/reconnect restores the same confirmed fields, while a changed source/opening invalidates affected values. Field progress does not independently grant setup_ready or opening_ready. For private opening/background work, show a generic preparation status without the confidential subject being investigated.

Reuse the existing English UI source and presenter/cache for player-language labels and already available public values. A model/reader batch may supply several field updates; do not add a separate generative call for every status change or narrate model internals. Progressive display complements the latency work and does not establish that the measured 49/73-second waits are an irreducible minimum.

### D15. Prototype evidence is required implementation input

Every implementation ticket must consume the relevant retained prototype code and observed successful/adverse cases before contract or code changes. Follow the [pinned evidence and per-ticket map](jev-pdf-demand-reading-tickets.md#required-prototype-evidence). Record the consulted commit/files and case, the production owner that will implement the decision, and the resulting verification evidence. Include this input in delegated assignments so a fresh context has the same obligations.

Ticket review requires the correspondence between prototype decisions, production changes and verification. Explain any deviation with current evidence; missing correspondence or silently discarding an applicable result fails acceptance. Experimental dossier validation, thresholds and scheduling shortcuts need adaptation to the existing production contracts. The prototypes' limits and negative outcomes remain part of the input, and measured source tasks do not replace real player acceptance.

## Testing Decisions

### T1. Existing seams

Prefer the public source preparation/ensure path through real host source access, typed decisions, reader/reviewer submission and TypeScript publication. Inspect the actual outgoing provider request to prove what text/images it carries. Deterministic model stand-ins verify ownership, lifecycle and authority only; retained real Jev decisions and tool-enabled reader runs verify semantic retrieval. The RPC play driver verifies setup, handoff and natural play.

The native seam must additionally prove actual Pi run_start/decide/operate/infer/run_end events, policy-origin reads and a real decision before the first generative request, real model tool/result pairing, and a dependency re-entering the same driver after being discovered. An inherited hybrid-v1 environment variable on an ordinary reader CLI is insufficient. Verify source maps/runtime identity before timing; distinguish the prototype's artifact status from production publication and player delivery.

Focused regressions cover duplicate-image first delivery, retries and explicit reopen; stale or cross-source references; unknown/partial candidates; an omitted distant dependency; deferred material becoming needed; mechanics publication; reviewer access outside the author page set; and canceled/restarted reads. Choose tests whose externally visible failure would violate a user story, not snapshots of helper implementation.

For incremental public progress, exercise worker events through the host snapshot and actual onboarding component. A confirmed public field appears while other fields remain pending; a provisional result stays marked; later unrelated updates retain it. Include a private source heading/question that must not enter the public projection, a stale-attempt event, reconnect and an opening with a different era. Confirm progress does not delay an already satisfied creation gate or add per-update model calls.

### T2. Baseline and quality set, frozen by JPDF-01

Use the same original Masks PDF (669 pages) and Blood Road PDF (111 pages) as the handoff, recording byte hashes and editions. Record current revision, engine, models, thinking, credentials' source (not value), concurrency and cache scope. Historical comparable runs pin grok-build/grok-4.5 with low thinking and the same Jev version/configuration on both arms; verify availability at execution. No global model-setting change is authorized by these documents.

Create 24 source-grounded evaluation cases, 12 per book, before optimizing. Cover each of: distant NPC plot/identity, clue connections, rule exceptions, item conditions, scattered NPC parameters, and visual/native-text gaps. Include difficult partial-answer, alias, absent/unsupported and chapter-boundary cases; more than one behavior may be tested by a case. Split 12 calibration and 12 held-out cases, stratified by book and risk. Original-page adjudication defines required facts, acceptable alternate source locations, relevant dependencies and what may safely be deferred. Do not use the current incomplete graph as the gold standard or feed expected pages/answers to the evaluated locator.

An independent tool-enabled source reader assembles or verifies reference evidence; human review resolves disputed goldens. Generated cases remain unaccepted until grounded. Synthetic authority/failure tests supplement this set; they do not become real-module recall or real-play evidence.

### T3. Pre-registered performance goals

The initial percentage targets were withdrawn on 2026-09-27 at the user's request: prototype alternatives first, then set evidence-based targets. After the minimal native prototype, the two bound cold-product baselines and the independently reviewed 24-case set, JPDF-01 freezes the absolute targets below before optimized-path evaluation. The original proposed 50% time / 60% token / 70% image reductions remain recorded in Comments as superseded proposals, not acceptance gates.

The earlier [sidecar sandbox](../research/jev-pdf-sandbox-20260927.md) suggested seconds-scale navigation and millisecond exact-source reuse. Its 10/15-second locating and 100-ms reuse budgets remain exploratory component hypotheses, not native-loop acceptance gates. The [native Pi prototype](../research/jev-native-pi-reader-20260927.md) proves the actual driver path but shows mixed cold-task time and higher total input before adaptive scope; only the specific local supplement demonstrated a substantial all-input reduction. Both prototypes' broad dossier tasks are invalid-for-intent and invalid-for-acceptance when used to estimate the two small foreground gates. Their raw results remain valid mechanism evidence and must be preserved.

Native prototypes must measure the actual minimal creation brief and selected first scene, including immediate dependencies and independent review. Compare opening preparation started during creation with its measured residual wait after confirmation; include zero-overlap diagnostic timing. Observe continued background progress and actual-demand promotion. Use those measurements to set absolute foreground latency budgets before the integrated evaluation, with total-token goals assessed separately. Existing broad dossier timing cannot set or rule out these budgets. Every reported total includes the Jev work that supplied that run, required repairs and unknown-usage failures.

The [minimal-entry round](../research/jev-playable-entry-prototype-20260927.md), using user-selected Grok 4.5/low, measured source briefs at 49.2/73.1 seconds and selected scene packets at 117.7/111.3 seconds for Blood Road/Masks. Initial locating/image supply was about 1–4 seconds; generation, tool navigation and review dominated. These are exploratory source-readiness measurements across revisions, not actual card/handoff timing or a validated SLA. Retain the failed and slower runs, especially the first brief's missed car/Driving advice. The player may confirm a different card. The target budgets include real product handoff, so they demand less duplicate work than the prototype rather than treating its source-only time as a product pass.

| Metric on each book, compared with its matched baseline | Target |
| --- | --- |
| PDF accepted to usable creation brief/choices | Cold-run cap: Blood Road 60 s, Masks 90 s. Stretch goals 45/70 s. Include checked advice and the actual creation conversation entry, not just Jev's locator result. |
| Card confirmed to playable first scene | Cold-run residual wait at most 60 s for either book; stretch 30 s. Report actual creation overlap and zero-overlap diagnostic. A very quick player confirmation does not erase the wait. |
| Opening delivered to first meaningful source-dependent action completed | Must demonstrate usable current evidence; report any new source wait rather than stopping the timer at prose |
| PDF to playable opening and card-confirmable time | Report machine wait and human decision time separately; neither a long creation pause nor a quick first paragraph proves a gain |
| Foreground queue wait while background preparation runs | At most 5 s from accepted demand to its own source task dispatch, excluding an already sent provider request; the native prototype observed 3.6 s in one diagnostic. |
| All preparation input tokens, including Jev, read, review, retries and background work | Strictly below the matched old path for each book through comparable background completion, with the actual reduction reported. No percentage is credited until author/reviewer and Jev input are joined. |
| All preparation image bytes successfully sent | Strictly below the matched old path for each book, without lost required source images. Context-hook inclusion before transport success is not a successful send. |
| Image history and rereading within a phase | Optimize total payload/calls without losing active evidence; count passive replay, explicit reopen, independent review and transport retry separately |
| Repeated exact request with unchanged relevant accepted evidence | No new full-book navigation scan; reuse accepted material |
| Successful accepted imports | No reader timeout or budget exhaustion |

Measure two matched cold-import pairs per book (baseline and complete optimized path), alternating run order, with fresh isolated homes. Report each run, medians and range; this sample does not establish population tail latency. Preserve controlled component comparisons of image projection alone and Jev locating alone at the source-operation seam; they do not replace full setup measurements. Warm-cache runs are separate. Count associated background work through natural completion; forcibly canceled unfinished work cannot produce a passing completeness claim.

### T4. Quality gates and real play

Every accepted current-use packet must preserve the necessary identities, causal conditions, clue links, rule/item applicability and knowledge boundaries. Missing or contradictory logic is a blocking failure. Ordinary parameter and wording differences are reported as advisory reference differences, not grounds for repeated rereading. Established table facts remain canonical; later source differences are mapped. Report per-book and per-family retrieval recall and final fact recall; aggregate scores cannot hide one failed family. An honest unresolved result is better than a false fact but still does not pass a case requiring supported delivery. Calibration and held-out results remain separate.

Every deferred case retains a usable source locator/continuation; a subsequent demand must retrieve it without an incorrect earlier scene or lost trigger. Visual-only and mixed-content cases must not pass on native text alone. Existing semantic review rejections remain effective. Navigation must never grant player knowledge, readiness, ownership, settlement or executable parameters.

Include the observed creation-advice omission, directory parent/child coverage, a real missing NPC profile, a supplied rule awaiting live elapsed time, a discretionary portrayal choice, and an unconsumed search cursor. A runtime/deferred classification must be independently checked; merely renaming unresolved work cannot pass. A compact brief that omits one required source-backed advice field fails source fidelity even if every included row is true; the player remains free to confirm a different card.

Run one real table per book on the integrated optimized source, from fresh PDF setup through confirmed card and handoff, then at least ten natural player turns unless there is a genuine ending/blocker. The main session is the sole player, using the canonical RPC driver one sentence at a time; no scripted player, second Keeper or synthetic settlement loop. Evaluation answers and hidden source material do not become player instructions. Counts alone are not acceptance: cite delivered behavior showing the exercised capabilities and keep unexercised capabilities explicitly open.

Demonstrate usable creation while unrelated source work remains pending, selected-scene preparation during creation, and the first meaningful action with its required evidence. Observe a background unit advancing without a player request and a newly needed unprepared source demand being promoted while background work exists; verify retained progress resumes afterward. Check a deferred future encounter stays outside both foreground gates and a distant fact affecting the current interaction arrives in time. Classify test facts by actual use, not by dossier size or page count. Keep the 24-case coverage gate for integration; it is not a prerequisite to running the next narrowly scoped timing prototype.

Report first-prose timing on comparable turns; investigate a median or p90 regression above 10%, retaining individual turns and the small-sample limitation. Required product suites run serially on the shared remote test machine under its load policy; the Mac handles focused files, live inference and natural play. Source checks and source onboarding do not establish installed-App acceptance. Canonical packaging/GUI acceptance is a separate explicitly authorized release gate, not an automatic action of these tickets.

## Out of Scope

- Packaging and release. The subsequent user request authorizes production implementation of the scoped tickets and self-testing; it does not authorize installing or shipping an App.
- Replacing tool-enabled Pi readers with zero-tool completions, weakening core ruleset/executable-data checks or logical coverage, or changing the default generative model to manufacture a speedup.
- Restoring the retired OCR/Markdown bundle production path or Python kernel; adding a new OCR service, vector database or external retrieval framework.
- Fully extracting every chapter before play, constructing a second authoritative graph, or imposing source-specific keyword/regex logic.
- Reworking NPC behavior, game rules, object identity, disclosure or action authorization beyond supplying their existing readers with necessary source material.
- Remote issue publication, push, deployment, App installation, evidence cleanup or destructive campaign migration.

## Further Notes

### Local evidence and source map

- [Handoff, read-only](../../../chatrpgv4-wt-integ-sl2/docs/handoff-pdf-import-jev-locating-20260927.md).
- [Masks opening author/review evidence](../../../chatrpgv4-wt-gate-6ba21726d-masks/.coc/modules/book-1/work/read-3/attempt-1/), including usage.jsonl, read-1.jsonl, image logs and verify-1. Values above were recomputed from these records on 2026-09-27.
- Masks index evidence: the sibling gate worktrees ending in 13ce6a7dd-masks and dc37c6b7e-masks, under .coc/modules/book-1/work/read-2/attempt-1. Preserve them.
- Historical prototype branch codex/jev-pdf-routing-prototype-20260919, .pi/prototypes/jev-pdf-routing-20260919/README.md and report.html: native extraction 851 ms, role indexing 4,388 ms; only 2/5 positive cases retained all expected pages under the fixed 0.7 support gate. Small curated locating experiments, not product acceptance.
- Current seams: [reading service](../../extensions/module/reading-service.ts), [reader context projection](../../extensions/module/reader-context.ts), [review owner](../../extensions/module/reader-review.ts), [source owner](../../extensions/module/source.ts), [fresh navigator](../../runtime/jev/fresh-source-navigator.ts), [source consultation](../../runtime/jev/native-source-domain.ts), [reading kernel](../../kernel-ts/modules/reading.ts), [source publication validation](../../kernel-ts/modules/visual.ts).
- Related contracts: [kernel RPC](../kernel-rpc.md) sections 22, 122, 124, 135, 140; [visual reading](visual-pdf-reader.md); [guided onboarding](fast-guided-pdf-onboarding.md); [object identity ADR](../adr/0005-object-identity-and-usage.md); [single-loop ADR](../adr/0006-pi-native-single-loop.md). Reuse the current runtime; this feature needs no further Pi fork or upgrade.
- [Local tracker](../agents/issue-tracker.md) owns publication. Implementation decisions and tickets use domain/interface names; the links above are the dated source map, not permanent ownership assignments.
- Public progress seam, inspected 2026-09-27: [onboarding worker](../../pipicoc/onboarding-worker.ts) emits progress; [onboarding host](../../Electron/packages/pi-backend/src/coc-onboarding.ts) retains phase/attempt state and projects a snapshot; [onboarding UI](../../Electron/packages/ui/src/CocOnboarding.tsx) currently shows a generic guidance paragraph in its existing status region. No production UI was changed by this specification revision.

### External cross-validation, checked 2026-09-27

- [TypeSafe fan-out](https://docs.typesafe.ai/patterns/fan-out): independent questions can share one state/request. This supports batching facets, not dependent multihop reasoning in a single answer.
- [TypeSafe jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13): indirection, irrelevant large states, numeric precision and generation remain limitations. Keep exact copying, arithmetic and control flow with their owners.
- [GraphRAG Local Search](https://microsoft.github.io/graphrag/query/local_search/): entity-led retrieval expands to relationships and original text. Its prebuilt graph cannot prove recall of unindexed relations.
- [LightRAG paper](https://arxiv.org/html/2410.05779v1): entity/relation retrieval and neighboring material support connected retrieval. Its initial extraction cost and answer-quality evaluation do not establish exhaustive TRPG fact recall; no dependency on the framework is proposed.
- [Chrome prioritized yielding](https://developer.chrome.com/blog/use-scheduler-yield): bounded units and explicit priorities keep background continuations behind interactive work. This supports D12's scheduling direction; browser task yielding does not preempt an in-flight model request, so provider capacity and wait boundaries need separate measurement.
- [TanStack Query prefetching](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching): preparing likely next data early and reusing it avoids request waterfalls. This supports overlapping chosen-opening preparation with creation. Unlike cached application data, our material still needs source binding and independent review before readiness; no framework dependency is proposed.
- [W3C status messages](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22) supports non-interrupting status updates; [Fluent progress guidance](https://fluent2.microsoft.design/components/web/react/core/progressbar/usage) distinguishes measurable progress from indeterminate work. These support reusing the existing status region and showing real field milestones rather than an invented overall percentage; neither source establishes PDF fact correctness or disclosure eligibility.

## Comments

2026-09-27, implementation authorization: the owner requested the `implement` skill, self-directed testing and evidence-based decisions while unavailable. The approved scope is this spec and its 12 tickets. This is authorization to implement and test, not evidence that source readiness, true playability, package GUI acceptance or performance gates have passed. Source tests in this effort use Grok 4.5/low as most recently requested; no global/default model rewrite is implied.

2026-09-27, implementation continuity: the owner requested an explicit assurance that future implementers actually consult the prototypes. D15 and the mandatory evidence section in every ticket make this an implementation/review gate, with immutable source pins and concrete case-to-verification records.

2026-09-27, progress-display request: the owner accepted continuing with the measured preparation cost while requesting visible, non-spoiler progress such as searching for the era and then displaying the found era. D14 and JPDF-12 add incremental public facts to the existing onboarding path. This is a spec/ticket revision, not an implemented UI or an assertion that latency cannot improve further.

2026-09-27, minimal-entry round: [live small-scope experiments](../research/jev-playable-entry-prototype-20260927.md) replace broad dossiers as foreground research. The owner explicitly selected Grok 4.5/low for cost; the initial 4.7 attempt was stopped and preserved separately. D13 records the required source/runtime distinction, independent need review, typed review submission and complete navigation ownership. Source packet readiness, background scheduling diagnostics and real player readiness remain separate evidence classes.

2026-09-27, player-readiness clarification: the owner explicitly prioritized rapid playability: a few overview/creation fields first, the selected first scene next, and continuous background parsing of the rest. D0/D12, the two primary timing windows and JPDF-11 make this the central acceptance contract. Earlier broad dossier trials are invalid for this foreground intent/acceptance, while retained as source-mechanism evidence. This revision updates drafts only and claims no new measured latency.

2026-09-27: The user approved writing a specification and splitting tickets after the read-only investigation. The detailed test seams, nine-ticket breakdown and proposed numeric targets are presented for the named skills' review checkpoint. No implementation or live acceptance result is claimed.

2026-09-27, later instruction: the user rejected setting targets before experiments and requested sandbox prototype tests to determine a better implementation. The initial 50% time / 60% token / 70% image reduction proposals are withdrawn. Prototype source and evidence live on codex/jev-pdf-sandbox-20260927; no production implementation is authorized by that experiment.

2026-09-27, sandbox findings: [16 Jev experiments and 9 source-reader trials](../research/jev-pdf-sandbox-20260927.md) are retained, including failures and a copied-build provenance correction. Generic page-role indexing is no longer a mandatory prerequisite, and immediate first-use image eviction is no longer the selected policy. Actual source discovery is measured in seconds; adding a full-book scan before otherwise unchanged generation did not prove lower complete-task cost. Prefer exact native-material supply/reuse at already authorized boundaries; preserve required visual preparation and independent review. Full source-contract/setup performance remains unproven, and those targets remain unset.

2026-09-27, subsequent owner correction and native prototype: Pi already contains the required RunDriver. [The new measured prototype](../research/jev-native-pi-reader-20260927.md) uses it directly and proves live Jev-driven reads and dependent follow-up. Cold native source tasks reduced generative calls on both books but did not consistently improve total time or input. Masks exposed a required third NPC profile, recovered through retained needs; Jev-selected local scope substantially reduced that repair's input. D1, D4, D5, D11 and the native-driver implementation slice now govern the direction. No whole-product speed/completeness acceptance or production code change is claimed.

2026-09-28 owner correction: module logic and relationships take priority over exact wording/numbers. Keeper-established campaign content remains canonical; later source discrepancies are mapped. Contract §147.8 supersedes earlier exact-fidelity gates. This is an explicit owner change, not a silent lowering of failed test targets. Old case answers and scores are retained.
