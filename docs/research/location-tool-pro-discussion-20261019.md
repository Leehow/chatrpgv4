# Location architecture: GPT-6 Pro discussion, 2026-10-19

Status: two GPT-6 Pro discussion rounds completed; design synthesis saved. This file records research, not implementation or acceptance.

## Authorization and method

The owner requested a location-system design, evaluation of a location tool separate from `apply`, demand-loaded tool context, and an independent discussion with ChatGPT Pro through the `ego-browser` skill. Production changes, packaging, commits, and playtests are outside this turn's work.

The initial prompt deliberately supplies product goals and observed problems without the previously proposed architecture, concrete schema, seven-verb restriction, or implementation plan. A later round may supply actual integration constraints and challenge the independent proposal. External advice is evidence to evaluate, not authority over campaign truth or product decisions.

- Browser: Ego task space 10, page p1.
- Initial conversation, excluded from design evidence: https://chatgpt.com/c/6ad64190-1628-832f-988e-288f5679ea77
- Initial model-selection error: the agent selected GPT-5.6 Sol / `5.6 Pro`. The owner corrected this explicitly: use GPT-6 Pro, and manually changed the page. No 5.6 answer is adopted as the requested Pro consultation.
- Current owner-selected conversation: https://chatgpt.com/g/g-p-6a4a62e4118c8191bdcddf247b960b3c/c/6ad64236-55e0-8333-a942-daffcee8d1d3
- Current UI verified after resuming user control: `Pro`, with `GPT-6` selected in the model menu. The owner's project and attachments are preserved.
- The model menu was checked again after both responses: `Pro`, with `GPT-6` selected. The resulting conversation title is `设计地点移动系统`.
- No API credential, campaign record, private scenario text, or source bundle was sent.
- The owner's current-turn instruction names the browser model GPT-6 Pro. Do not silently substitute a different browser model or reinterpret this as a change to any product/API model configuration.

## Round 1: exact submitted prompt

请作为独立的软件架构设计者，为一个高自由度、AI 主持的文字 TRPG 设计地点与移动系统。先讨论设计，不写实现代码。

产品中，玩家用自然语言行动，AI 守秘人（KP）理解意图、扮演人物并叙述；系统需要可靠保存实际发生的变化。内容既有作者写好的冒险模组，也有 KP 随游玩合理即兴创造的部分。可使用一个擅长从有限选项做语义判断的小模型 Jev，它不生成开放文本。

现在的体验问题：移动过于依赖已经登记的场景和出口，玩家说到图谱没登记的普通地点就容易卡住；大地点、房间、角落和正在发生的剧情场景容易混淆；临时创造的地方再次访问需要维持身份、布局及玩家造成的后果。与此同时，一个通用 apply 工具包揽大量不相关操作，模型每次都要携带很大的工具说明。

我们正在考虑把地点能力做成独立工具，并只在地点相关需求出现时加载其完整上下文；这只是待评估的想法，请自行比较其他更好的接口和架构。首要目标是自然、自由且连贯的 TRPG 体验，同时减少无关工具上下文和不必要的模型往返。

请从你的判断提出方案：核心抽象与职责、地点身份和结构、生成与持久化、工具接口、按需发现/加载，以及失败恢复。用“走进未登记的普通宾馆”“来到前台旁”“进入房间后再次返回”等例子说明。请特别考虑工具被隐藏后如何避免把合理行动误当作不支持，以及怎样避免重新生成已成立的事实。可以质疑我们的设想，并比较至少两种有实质差异的方案；不必迎合我们，也不需要按现有实现修修补补。

## Local evidence checked while Pro reasons

Source baseline: branch `0.9.8a`, HEAD `af211c243`. Concurrent edits in existing files are preserved; this task adds separate documentation and does not edit the shared contract or production code.

At final audit, the same branch had advanced through five concurrent author/material-context commits to `aa41c5dad`; those changes were not absorbed or edited by this task. The measurements and function probes below retain their original baseline scope.

The following measurements serialize `{name, description, parameters}` with UTF-8 JSON from current source. They are **not** provider payload token counts, prompt-cache measurements, or latency results.

| Source definition | Bytes |
|---|---:|
| Full offered `apply` | 61,981 |
| Existing fixed-envelope `apply` projection | 5,860 |
| Full `move` variant with establishment | 3,130 |
| Full registered-place `move` variant | 2,878 |
| Full `scene` activity variant | 1,383 |

Owners and qualifications:

- `extensions/kernel/tools.ts`: full canonical effect definitions, including both move variants and scene activity.
- `extensions/kernel/lean-apply.ts#offeredTools`: hybrid tool surface.
- `extensions/table/capability-catalogue.ts#fixedCapabilityTools`: existing compact fixed apply envelope and named detail.
- `extensions/table/capability-runtime.ts#project`, `#due`, `#lookup`: request view and disclosure.
- `extensions/table/context-runtime.ts`: `discoveryMode()` returns `full` while `singleKeeper` is true; the context-with-system hook owns the projected tool list. Existing selective infrastructure must not be mistaken for active default behavior.
- `runtime/jev/capability-discovery.ts`: closed relevance decisions; it is called by the table capability runtime, not an unused standalone prototype.
- `docs/kernel-rpc.md` section 228: current selective contract deliberately fixes the tool list and appends detail. A truly separate, demand-loaded tool would require an explicit contract amendment rather than merely turning on that mode.
- `vendor/pi/packages/coding-agent/src/core/agent-session.ts`: callable tool registry and declared tool loadout are distinct. Public integration must be validated against the installed source; no private-member access or Pi patch is proposed by this research.

Earlier pure-memory probes in this chat exercised current production functions: an unknown destination without establishment returns `destination_missing`; native packet movement requires an exact issued destination; two hotels' identically named rooms reuse one table record; unspecified containment defaults to the departure scene. These are function-level observations, not real-table acceptance or a complete diagnosis of the owner's recent failed turns.

## External precedent

- [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search): small discoverable surfaces with deferred definitions; discovery adds a step and provider support matters. Provider-specific wire behavior is not portable by assumption.
- [Anthropic tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool): deferred definitions and inline discovery preserve a stable prefix. Full definitions still travel to that API server; model context and HTTP bytes are separate metrics.
- [DeepSeek context caching](https://api-docs.deepseek.com/guides/kv_cache/), independently rechecked during round 2: reusable persisted prefix units and cache hit/miss usage are distinct from context removal. Prefix persistence is best effort; cold and repeated requests require separate measurement. No price or latency result from that provider is assumed for this project.
- [MiniMax prompt caching](https://platform.minimax.io/docs/api-reference/text-prompt-caching), independently checked after the Pro reply: the tool list participates in prefix matching. Stable compact declarations and actual usage measurements are preferable to assuming smaller requests always cost less.
- [MiniMax tool use](https://platform.minimax.io/docs/guides/text-m3-function-call), independently checked after the Pro reply: preserve complete assistant continuation messages and available reasoning fields. Host-owned guidance projection must not become arbitrary history stripping.
- [CDPR: Building Night City, GDC 2023](https://www.gdcvault.com/play/1028734/Building-Night-City-The-Technology): prefab hierarchy and different-system streaming are distinct concerns.
- [Unreal World Partition](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine): world content and currently loaded cells differ.
- [Unreal Smart Objects](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview): interaction slots and object definitions provide a precedent for within-place positions without full scene replacement.
- [Minecraft Jigsaw](https://learn.microsoft.com/en-us/minecraft/creator/documents/structures/introductiontojigsawstructures?view=minecraft-bedrock-stable): constrained structural composition, not an obligation to copy a fixed room-template bank.
- [Ubisoft Census](https://news.ubisoft.com/en-ca/article/4po3S9Pwp1YcgBmGPmQxAh/watch-dogs-legion-the-tools-that-built-london): generated NPCs and persistent simulation have different owners; applying that separation to places is a design inference.

## Round 1 result

The completed GPT-6 Pro answer is retained as [visible response text](location-tool-gpt6-pro-transcript-20261019.md). It compared a small resident place interface, a structured decision packet, and completely deferred capability discovery. It preferred the first, while accepting a decision packet as an alternative transport for the same domain implementation.

Important independent contributions include explicit anchors, position refinement without travel, registration distinct from fictional construction, source coverage distinct from absence, committed progress at an actual intermediate barrier, and persistence of newly introduced interactive references. It explicitly opposed adding a Jev/generator/reviewer chain to every move.

The answer consulted the owner's existing ChatGPT project attachments, including an older architecture document and an attached paper. Those attachments were not checked here against the current checkout. Its references to their sections are external advice and are not substituted for current-source verification.

## Round 2: exact follow-up prompt

谢谢。现在补充当前实现的几个事实，请据此挑战、收敛你的方案，仍只做设计，不写实现代码。

我们已有 TypeScript 内核事务、原子 apply 批次、收据和幂等重放；作者模组只读，战役变化单独保存。KP 作语义判断，纯表达阶段只能依据既有事实与已提交结果写正文，不能反向写世界。宿主是 Pi，主要运行模型含 MiniMax、DeepSeek，不能假定都有原生 tool search。现有工具披露会把长说明留进历史，因此改最新 tools 数组不一定减少实际上下文。

请具体评估四个问题：

1. 最小常驻地点接口究竟应是一个 place 工具，还是 inspect/move 加按需 establish？请给出足够类型约束的最小形状和调用时序，避免变成任意世界 patch，也避免已知移动、材料已齐的普通新地点都强制多轮发现或生成调用。
2. 独立地点工具怎样保留真正跨领域的原子批次，例如一笔已经谈妥、不可拆的付款换钥匙并进入？哪些情况应分成真实剧情阶段，哪些应由现有事务一起提交？请给一个无需重做全局事务系统、也不把现金字段塞进地点工具的最小方案。技术拒绝与到门口发现上锁，如何分别保存地点事实和实际进展？
3. 对这些 provider，如何按需加载完整地点契约，并让漏判后自然续行？请区分当前声明、可调用执行器、历史中的说明，以及提示缓存成本，指出哪些上下文节省必须实测，不能先承诺。
4. 基础地点系统与可选的地点 Mod 如何分工？在纯表达阶段无写世界权的前提下，怎样让刚出现的前台铃、窗户等可再次指认，同时避免所有装饰都变成独立物品、每次移动都再开一个生成 agent？

请优先给你认为合理的最小版本，明确哪些复杂机制可以暂缓；可以否定我们现有的接口做法。

## Discussion outcome

Both completed responses are in [the visible-response transcript](location-tool-gpt6-pro-transcript-20261019.md). The resulting proposal is [Location system and demand-loaded place tool](../specs/location-system-and-tool.md).

Round 2 changed the first proposal in useful ways:

- Prefer one resident `place` with closed `inspect` and `submit` branches. A submitted move can include its necessary establishment facts; basic creation must not require a separate discovery round.
- Submit the same location command through either a standalone place call or the existing mixed-domain batch. No new location preparation ticket, transaction store or receipt/recovery protocol is needed.
- A later place check must see earlier staged key custody in a batch. An indivisible room-entry agreement cannot silently accept doorstep arrival while charging the payment.
- Technical refusal commits none of that batch. A legitimate doorstep stage can be submitted separately when supported by actual facts. An exception handler must not preserve an arbitrary partial move. A revised plan follows existing new-batch identity rules.
- Keep schema, callable executors, host guidance, immutable raw history, model projection and cache accounting distinct. Project identifiable host blocks through supported hooks; preserve provider-required assistant continuation data.
- KP proposes lightweight anchors before publication. Pro explicitly withdrew its earlier suggestion that a pure author could add world facts. Existing undefined details may be filled; established mutable state changes need their legitimate owner.
- Core movement and identity survive optional Mod disablement. Elaborate templates, specialized geometry and a general object-upgrade framework are not first-version requirements.

The synthesis accepts these points, while treating Pro's illustrative feature/relation enums as examples rather than an exhaustive vocabulary. Global IDs stay host-owned and model references remain semantic names. Large immutable source context, current state and player knowledge remain distinct.

### Method limits

The first prompt did not supply this draft's architecture or desired tool shape. However, this was the owner's existing ChatGPT project, with attached historical architecture documents and account context. After completion, the Sources panel listed the earlier excluded 5.6 conversation under account memory. The exact retrieved content is not visible here. Therefore this is not claimed as a context-isolated blind review, and no claim is made that account memory had zero influence. No 5.6 answer was directly used in the synthesis. The current checkout and independently verified primary documentation remain authoritative for implementation observations.

Only new research/design documents were written by this task. No production contract, source implementation, campaign record, model default or package was changed; no implementation/play acceptance is claimed. The source measurements and pure-memory probes retain their narrower scope.

## Implementation follow-up: action scope (2026-10-19)

A real test found that the old admission projection treated a location move as
approach-only and did not explain Keeper-authored additions. The location-specific
projection now describes its actual entry/local-position scope and leaves the
independent model to judge the selected destination and restrictions.

Two primary precedents were checked before this correction. [Inform action
variables](https://ganelson.github.io/inform-website/book/WI_12_10.html) keep route
attributes such as destination and passage with the action and demonstrate
within-room positioning separately. [Generative Agents planning
source](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/plan.py)
binds an activity to a sector, arena and game object. These support separating
an activity's selection from its concrete spatial binding. Neither establishes
permission for arbitrary world creation; Inform uses an authored world and the
agent simulation is not a player-consent system. Our generic-destination binding
and Keeper creation boundary therefore remain project-specific decisions checked
by the real game, not conclusions attributed to those systems.

The live test also showed why demand loading must include the first spatial
decision, rather than waiting for the Keeper to guess a hidden grammar.
[Anthropic's advanced tool-use design](https://www.anthropic.com/engineering/advanced-tool-use)
and [OpenAI's tool-search contract](https://developers.openai.com/api/docs/guides/tools-tool-search)
both distinguish deferred definitions from executable capabilities and load
selected definitions into the actual model context. That supports input-scoped
disclosure here. Their native search protocols are provider-specific, so this
implementation uses a bounded Jev relevance answer and Pi's public request hooks.
No advertised token or latency reduction from those systems is attributed to
PipiCOC; our actual requests and costs are measured separately.
