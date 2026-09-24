# 表达参考增强 Mod：纵向切片与依赖

日期：2026-09-24。父规格：[craft-reference-mod.md](craft-reference-mod.md)。

状态：**用户已批准；CR-01–03 功能及代码验证完成；CR-04/05 可执行部分已验证，真实 Jev 选卡与完整对照被凭据缺失阻塞**。无远程 issue 编号。切片状态以本文实施记录与运行时任务列表为准，不能据规格存在推断完成。源码起点为 `0.9.5a@ef8efdf97`，实施时确认最新主线与正在运行的单循环形态。

## 共用决定

- 复用 `narration-craft`，不新建平行写作 Mod。保留旧锁，新增动态参考默认 off。
- 基础 Keeper 提示和 `content/craft` 不改；v2 两文件安装脚本不运行。正向原则只进入新版本 Mod。
- 生产只有 TS 内核；禁止寻找/恢复旧 Python。不得修改冻结 oracle、用户脏文件、源材料或玩测证据。
- JSON/Markdown 是 Mod 资产，TS 是宿主实现。新 capability、贡献形状和host-only读取契约先于实现写入 `docs/kernel-rpc.md`。
- 唯一主验收接缝：真实输入和Mod配置 → 宿主最终provider-bound请求 → 原Keeper交付。helper单测和selected日志都不代替它。
- 默认参考最多1800 UTF-8字节，初始选择等待上限1500ms，父任务额度更小时服从父任务；二者是工程上限，不是文笔或性能成绩。
- 不新增规则动作、正文配额、语义关键词路由、写作工具、skill义务或文学审计门禁。
- 每张实现票自己包含契约、逻辑、接线和测试；不把“写schema”“写代码”“补测试”拆成互相等候的横向票。
- 当前48卡和12候选属于未校准输入。生产包只带英文允许运行的字段；中文审阅、HTML、研究、脚本、测试夹具不打入Mod包。
- 版本号在各切片冻结时分配：CR-01可从1.4.0开始；若CR-02增加了已冻结包的字节，必须再升版本，不能重写相同版本。全程不替用户现有战役升级。
- 以下新测试文件名是**计划中的落点**，不是声称文件已经存在或命令已经运行。

## 总览

| ID / plan task | 交付 | 阻塞 | 完成时可观察什么 |
|---|---|---|---|
| CR-01 / `mod-positive-guidance` | 新版本Mod的正向指导与显式升级 | 无 | full/brief真正送达，关闭后消失，基础style不变，没有额外模型请求 |
| CR-02 / `sparse-reference-path` | 从冻结Mod资产到真实请求的有界参考通路 | CR-01 | 受控选择能在实际出站请求中看到一个参考，NONE/超限/过期不注入；生产自动选卡尚未启用 |
| CR-03 / `jev-reference-selection` | 既有Jev端口驱动的可选生产选卡 | CR-02 | 显式打开后按输入epoch至多一次选择，无卡/失败走原Keeper；两种引擎路径不重复调用 |
| CR-04 / `paired-craft-evaluation` | A/B/C/D独立效果与成本对照 | CR-03 | 真实保留上下文的匿名输出、平手/失败和选卡增益分开呈现 |
| CR-05 / `live-craft-acceptance` | 源码UI与主会话逐回合真桌验收 | CR-03 | 设置/升级实际生效，原Keeper真实游玩，证据与新增等待完整保留 |

```text
CR-01 → CR-02 → CR-03 ─┬→ CR-04
                      └→ CR-05
```

CR-04与CR-05无互相依赖，可以同一波开始；**CR-05的玩家和观察面必须由主会话持有**。不把全部工作交给一个worker，也不因离线评估在跑就闲置真桌/UI检查。每张实现票经定向验证和冷代码审阅后，下一票才能依赖其接口。

## CR-01 — 在现有 Mod 内交付正向指导

**plan task:** `mod-positive-guidance`。前置：无。

### 目标与边界

把v2的正向手艺原则融入新版Narration Craft，通过现有Mod提示通路改善指导；不改全局提示，不增加Jev调用，不导入整个卡库。不把新增功能默认开到老存档。

### 修改范围

- `mods/narration-craft/` 的manifest、agent、brief、版本说明。
- `docs/kernel-rpc.md` §26/§30对应决定，只记录本票实际交付。
- `tests/extension/craft-mod-guidance.test.mjs`（新增）及必要的既有Mod提示测试。
- 仅为本票所需的Mod briefing刷新接线可触及 `extensions/table/context-runtime.ts`；不重构其它上下文层。

### 必须完成

1. 吸收交流目的、已有NPC动机、清晰自然语句、兼容即兴和允许不用修辞的原则；不是把17条长提示逐句复制进去。
2. 保留 `density_guide` 的既有可选语义，不把文字长度当质量守卫。机制、隐私、玩家自主性和说话标记仍由原约束拥有。
3. 新版本full/brief均可用；当前版本和被冻结副本保持原字节。新战役默认及旧战役显式升级走原配置路径。
4. 配置/有效包变化必须使相关brief缓存失效，不能等模组源文件变化才换提示；忙桌pending不提前生效。
5. 用实际宿主context请求接缝捕获full、后续brief、升级后、关闭后四种输出。不能只断言JSON文件里出现新句子。

### 验收

- 基础Keeper提示和style图/表无改动；关闭Mod后的请求不含该包指导。
- 默认、显式升级、忙桌延期、恢复时的版本和设置正确；旧收据、历史与世界状态不变。
- 新版指导可从最终出站请求追溯到版本/digest；没有新增provider调用。
- 提示与预算测试不靠固定全文相等代替语义边界，也不能删除既有系统语言守卫。

### 定向验证

`npm run build:runtime`；`node --test tests/extension/craft-mod-guidance.test.mjs tests/extension/mod-package-boundary.test.mjs tests/extension/keeper-prose-contract.test.mjs tests/extension/jev-pacing-mod-alignment.test.mjs tests/extension/context-policy.test.mjs`。真实outbound截获由新测试承载。命令若因既有独立回归失败，保留原错误并区分本票回归，不修改无关实现刷绿。

## CR-02 — 冻结资产到实际请求的稀疏参考通路

**plan task:** `sparse-reference-path`。前置：CR-01。

### 目标与边界

实现完整的资产读取、参考渲染、时效绑定与实际请求注入。用**受控的测试/离线选择输入**验证通路；生产selector尚未接通时返回明确unavailable，不发模型调用、不伪装已有智能选择。该票完成只称“参考通路可验证”，不称生产自动增强已完成。

### 修改范围与所有权

- `mods/narration-craft/` 的英文card catalog、starter清单、引用描述文件及manifest。
- `kernel-ts/read/mods.ts`、`kernel-ts/mods/index.ts` 及方法/能力注册的实际文件。
- `runtime/craft/`（建议新宿主模块）负责资产shape、渲染与binding；不用npm独立发包。
- `extensions/table/context-runtime.ts` 及现有最终请求投影/观察入口；引擎特有run-owned packet适配只做窄接线。
- `docs/kernel-rpc.md` 中新能力/读取/消息契约。
- 新增 `tests/extension/craft-reference-path.test.mjs`、`craft-reference-lifecycle.test.mjs`；复用workspace与context-policy测试先例。

### 必须完成

1. 先写 `context.craft-reference.v1`、`contributes.craft_reference` 描述、`mods.craft.read` 的index/card形状与只读权威。
2. 包内路径白名单、digest、版本、未知capability兼容处理、单一provider槽和加载顺序；不执行包JS，不暴露任意文件读取。
3. catalog保留48张英文卡；index最多12个已发行候选；card读取一次一个并核对预期digest。生成字段白名单不包含反例、诊断或review文本。
4. 模式默认off；关闭时不读catalog正文、不prepare参考、不注入。测试的固定选择入口仅为依赖注入，不增加生产手工工具、环境变量关键词路由或菜单。
5. renderer至多一个参考，1800字节内先整块去例子，再整块去方法。原请求的事实、输入、工具配对、系统及output reserve不被挤掉。
6. 通过真实上下文准备→投影→provider-bound链验证发行。所有投影重入只发行一次；从历史读到同名custom message不能当当前发行。
7. 绑定战役、世界线、输入和read set、有效包/设置及catalog revision；新输入、源发布、取消、reset/resume和包激活变化均失效。对单循环遵守既有append-only策略，追加失效说明而非重写已发送前缀。
8. configured/available/active与selected/injected/omitted证据分开。无界字符串日志或完整私有payload不进入普通遥测。
9. 组装运行时可以找到host helper和声明的Mod资产；不要求安装App来验证。

### 验收

- 受控选择 `CRAFT-VOI-01` 后，真实outbound只含一个标记清楚的正向参考，原NPC事实和基础style不变。
- NONE、超限、外来ID、旧digest、坏资产、取消、包关闭/替换均不注入，不导致原回合失败。
- 移除真正注入调用或在最终投影删掉参考，证据测试变红；只有selected日志不能绿。
- 正例被整块舍弃的请求与整个参考被舍弃的请求都有准确记录。
- 兼容引擎与单循环均只经一个宿主发行入口，测试明确覆盖append-only失效与新输入更新。

### 定向验证

`npm run build:runtime`；`npm run check:kernel`；`node --test tests/extension/craft-reference-path.test.mjs tests/extension/craft-reference-lifecycle.test.mjs tests/extension/mod-package-boundary.test.mjs tests/extension/context-policy.test.mjs`。

## CR-03 — 在既有 Jev 生命周期内启用生产选卡

**plan task:** `jev-reference-selection`。前置：CR-02。

### 目标与边界

把受控选择替换为现有DecisionPort的真实闭集选择，显式开 `reference_mode=jev` 才运行。选卡只决定可选的表达方法，绝不执行动作或修改事实。

### 修改范围

- `runtime/jev/` 的新craft-reference domain与现有family/config注册；TaskLease与DecisionPort原则上复用，不新增第二客户端。
- 当前run owner/兼容上下文中调用CR-02准备器的窄适配。
- 必要的Mod设置投影、现有设置面板回归，不新建UI页。
- 新增 `tests/extension/craft-reference-selection.test.mjs`；扩展CR-02生命周期和最终请求测试。
- 对应kernel-rpc决定与功能状态说明。

### 必须完成

1. 用12张真实候选的目的/条件/例外与NONE构造Choice；不把Director节拍当答案，不做语义关键词匹配。
2. 只使用本轮已有的输入、场景、相关NPC和必要历史。不为文笔启动lookup、source-reader或第二LLM。
3. 每已接受输入epoch至多一次provider调用，包括自动开场；父TaskLease额度/取消生效，等待上限1500ms或父剩余额度中的更小值，usage一次记账。
4. 缺配置/未挂载、NONE、非法或不完整答卷、异常、超时、迟到和依据修订都跳过，无隐式重试。关闭后零调用、零卡读取、零参考。
5. 采用前重验read set与实际有效包；生产初版不开放跨轮KEEP_CURRENT。同一epoch的缓存不因投影次数增加调用。
6. 单循环由run owner发起，兼容路径由同一adapter发起，避免context和driver同时选卡。未选择任何新文风时维持原Keeper。
7. 捕获真实Jev请求和至少一个实际Keeper出站请求，记录真实模型/family、候选/答案/注入与耗时；这只证明接线，不证明文笔效果。

### 验收

- fake clock/DecisionPort覆盖所有失败和并发情形；实际调用与最终请求关联可追溯。
- 当前场景没有相关材料时允许NONE；不存在为了选卡临时造动机、怪物或感官事实的代码。
- 关闭模式、原审计与七动词路径不变。Jev不可用不是admission_unavailable，不把两类失败混为一谈。
- 1500ms上限和真实费用可观察；不以丢弃late结果为由宣称请求没有发生。

### 定向验证

`npm run build:runtime`；`node --test tests/extension/craft-reference-selection.test.mjs tests/extension/craft-reference-path.test.mjs tests/extension/craft-reference-lifecycle.test.mjs`。真实provider烟测在正常配置可用时运行，证据归实际run；无凭据时明确该项未验，不能用mock替代。

## CR-04 — 分离提示、范例与 Jev 的收益

**plan task:** `paired-craft-evaluation`。前置：CR-03。与CR-05可并行。

### 目标与交付

按父规格A/B/C/D做受控离线对照。使用真实保留回合及必要语境，冻结模型、提示、卡库、源与结果摘要；生成与评估必须经带工具Pi agent。把输出、匿名化条件、盲读结论、平手/都不好、误选/NONE和成本留在新建的实验目录，不覆盖任何历史证据。

### 范围

- 新的离线对照驱动/配置与测试，仅为本实验需要；不增加生产Agent。
- 调试与保留集按战役/场景分离，不来自本包教学正反例。
- 至少覆盖直接回答、人物拒绝/温暖、安静、观察、失败与重访等不同目的；数量是覆盖记录，不是质量证据。
- 标出事实锁定改写与兼容即兴成文，不能用不同剧情结果的文本证明单纯文笔胜出。
- 原始内容按既有本地证据边界保存，不默认上传第三方评测服务。

### 验收

- 明确 B对A、C对B、D对C 各改变了什么；结果允许负收益，不先定一个要刷到的胜率。
- 独立评估者不知道条件标签；引用具体段落判断承接、自然度、声音、适配、连续性、自主性。自动评估明确标记，不冒充真人。
- 已有真人反馈则单列；没有则记录human-calibration=not-run，不以AI结论宣布真人偏好。
- 卡片实体污染、秘密暗示、遗漏应交付结果、强制修辞、过度冗长与选择延迟都计入失败证据。
- 文本长度和测试数量不作为成功条件；报告选择是否值得保留以及依据。

### 验证方式

检查冻结清单和源/条件对应，重跑一组离线传输验证；审阅保留集与教学数据的来源隔离。该票没有“跑N回合”的验收，也不是实际游玩。

## CR-05 — 源码 UI 与主会话真桌验收

**plan task:** `live-craft-acceptance`。前置：CR-03。与CR-04可并行。

### 执行归属

**主会话持有玩家与浏览器，不可整体委派。** 独立代码审阅或测试修复可作为sidecar，但不能派worker扮演玩家，也不能由脚本替代Keeper。

### 必须完成

1. 使用现有源码服务和内置浏览器检查Mods列表、升级、reference_mode配置、禁用、刷新和安全边界生效；不安装新App。
2. 新建隔离战役，通过 `tests/play/driver.py` RPC 起 `bin/pi-coc`；建卡用 `bin/pi-coc-setup`。默认 `grok-build/grok-4.7-build-fast` / low 当Keeper，主会话一句自然话一回合。
3. 从开场到结局或真实阻断，沿自然选择观察NPC对话、直接问答、安静/观察、失败结果和回合交棒。没有覆盖的场景如实记未覆盖，不造记录凑齐。
4. 核对实际包锁、mode、模型与请求注入，区分“没有选卡”和“选中但未送达”。通过安全边界配置验证关闭后不再有新增选卡与参考。
5. 记录提交到首个剧情内容、交付完成、下次可输入时间，调用/费用和fallback；不拿产品准备状态占位当剧情首字。
6. 保留所有失败和战役证据。当前范围系统缺陷回原实现票修复一次后复验；扩大范围的发现单列，不静默修邻近系统。

### 验收

- UI可操作、配置真实生效，旧锁与旧交付不改；源码实际请求与真实Keeper交付证据一致。
- 不新增文学拒绝、合成事实、未经选择动作或额外写手；发生问题不能以最终走到结局掩盖。
- 到结局不等于证明文笔更好；依据实际段落与玩家交流记录给出体验判断。
- 外部模型或凭据阻断时列明证据和最小缺口，保留已做检查，不拿fixture当真桌通过。
- 最终汇总CR-01至05的实际状态：功能、注入、真实选择、离线效果、真人校准、真桌和等待分别报告。任何未完成项不被测试总数冲掉。

## 代码归属与执行纪律

- 规格/契约决策与集成由lead持有；每个实现切片由同一个负责人覆盖代码、测试、失败修复和复验。
- CR-01→02→03共享包、注册与context-runtime接口，是真依赖，不制造并行写冲突。
- CR-04的离线生成/评估可委派带工具agent，CR-05由lead执行；必要时只把独立代码审阅发出。
- 模型按运行时可用路由和切片复杂性选择；历史文档里不存在的模型名不能当可用能力。
- 每张实现票的验证命令写入实际派工verify，使用本票文件；全仓suite留给集成，不在所有worker重复运行。Python测试一次一个，统一 `uv run --frozen python`。
- 实现完先看真实diff与验证，再让下一票建立依赖。reviewer审代码而非审这份计划文本。
- 最终提交只通过secretary接受明确路径；输入材料与用户既有删除不被顺带提交。不push、不删分支、不stash/clean、不改共享历史。

## 规格编写阶段的完成定义

规格阶段只产出文档、分票与依赖图；用户于2026-09-24批准实施后开始CR-01。新增能力仍不会因规格存在而自动启用。

## 实施记录

### CR-01（2026-09-24）

- Narration Craft 1.4.0 的full/brief提示采用正向指导；基础Keeper和style资产未改，density_guide与默认启用语义保留。
- Host briefing缓存加入有效Mod身份、不可变版本和settings；普通full/brief轮转仍复用，禁用/升级/设置激活则重建。
- build:runtime与check:kernel通过；5个定向文件34项全部通过，含真实TS内核+Pi会话+faux provider的双引擎5轮捕获，以及无tool_result失效时的缓存回归。后者在隔离未修改HEAD上失败、修复后通过。
- 冷审阅发现旧pacing对齐测试钉旧版本/文案，已保持语义约束更新；该测试又实际暴露brief总量5446超过5000字节，已精简本包brief而非放宽上限，复跑通过。
- 扩展检查中的single-loop-model-call-diet一项capsule_update断言失败；独立构建的ef8efdf97基线同样失败，列为已有问题，未改断言。其余当次40项通过。此处不宣称全套全绿。
- 无真实Jev或守秘人质量测评，无UI或真桌验收；faux provider是契约测试，不是游玩。所有实现尚待最终集成提交。

### CR-02（2026-09-24）

- 新增窄capability、JSON描述文件、host-only `mods.craft.read`；index最多12候选，card白名单与expected绑定校验，后位provider槽和旧cap不兼容路径均接线。包1.5.0带48张英文卡，reference_mode默认off。
- 宿主每input epoch一次准备、取消与实际请求投影；只读绑定包含NPC/记忆修订，历史/伪造参考不取得当前发行权。已发送参考失效以追加withdrawal表明，不声称撤回模型已见文字。
- 实际剩余请求空间传入renderer；序列化开销仍导致超限时，先整块去例子再决定是否丢整个参考，不挤原材料。
- build:runtime与check:kernel通过；CR02四文件36项通过（资产10、RPC7、生命周期7、双引擎真实Pi/faux provider矩阵12）。此前与CR01联合69项通过；随后补了真实余量保留core回归并复跑上述36项。
- 选中/投影不等于注入：真实provider回调测试包含payload丢参考时不得记injected。仅受控selector，生产尚未发出Jev请求。
- 冷审pass；预算梯子warning已修复并加测试。保留按request记录projected/inactive_reference，以便逐请求确认最终保留情况；它不是新增选择次数。
- 资产sidecar自动集成未获runtime确认，主会话审阅并按8个精确新路径手工集成、复验通过。其工作树暂留收尾分类，不把pendingReview说成自动合并成功。

### CR-03（2026-09-24）

- 新 `craft-reference/v1` Choice 工厂复用现有DecisionPort和preparation/provider预算；只显式attempts=0退款，未知调用次数保守记账，晚返complete不采用。NONE允许已有指导足够，不因有适用卡而强制选卡。
- hybrid在首个compose/adjudicate前由run准备，context只adopt/revalidate；legacy复用context已有adapter和共享额度。父deadline与1500ms取较小值，关闭/无key无调用。
- 冷代码审阅pass；13个selector与10个真实Pi离线production用例通过（typed adapter只换fake HTTP），覆盖父预算精确一次扣费和工具续行不双调用。
- 全套扩展初次继承了PipiUI managed/unmounted环境并在600秒超时。相关失败在原HEAD复现；仅为源码CLI测试进程移除PIPIUI_SPAWN_CONTRACT/HOST_PROTOCOL后，原Jev与单循环用例恢复通过，生产挂载门禁未改。
- 全量集成找出并修复：新增read-context修订字段对轻量快照缺map的兼容；可选craft关闭时仍保持旧同步projection返回形状；`mods.craft.read`加入TS专用接口清单，冻结Python参考未改。
- 最终 `check:kernel`、`build:runtime` 通过；源码CLI环境 `npm run test:ext` **2883/2883通过**，237.39秒。日志 `.pi/progress/craft-integration-final.log`。此前CR-01记录的单循环失败由此确认是测试环境条件，不是待修的生产断言。
- 真实Jev smoke未跑：当前验收进程configured=false、全局vault无挂载、源码游戏home也没有Jev vault配置。已请求用户安全配置，不读取其它App或旧日志搜key。该项明确未验，不由fake HTTP替代。

### CR-04（2026-09-24，实际Jev D组仍阻塞）

- 6个保留中文回合按scene分debug/held-out，原始资料和限制保持不变。作者输入剥离arm、split、C选卡理由，避免条件泄漏。
- general-purpose子任务续行接口多次0-turn拒绝，旧冻结文件未损坏；改用独立、带工具Pi CLI，不是裸completion。作者与盲读者均为新进程，模型实际报告grok-build/grok-4.7-build-fast，请求low。
- edition1因重复指导读取而排除；edition2因共同基础约束与玩家可见渲染不匹配而标invalid-for-intent/invalid-for-acceptance。全部保留，没有按胜负删结果。
- 有效edition3包含真实生产Keeper基础提示、当前base style和原定A/B/C内容；盲读前调用真实stripMarkers，明确不把遗漏UI数字或经过分钟数判错。
- 18份样稿与6份自动盲读完成。引文校验0错误（一处补出来的右引号另存勘误，原评审不改）。B/A计数3/2/1平手；实际加参考的4例C/B为2胜2平手；两个NONE对照仍有生成波动。**不是提高百分比、不是真人偏好、不足以默认启用。** 0001材料边界尤其狭窄，不能作自然问答质量强证据。
- 证据 `.coc/evaluations/craft-reference-20260924/RESULTS.md` 与 `automated-reading-v3-validated.json`。D缺Jev凭据，真人与多语言校准未跑。未来off/on比较须同样配置Jev与其它车道，因为key存在也会影响既有准入等路径。

### CR-05（2026-09-24，真实参考注入仍阻塞）

- 主会话用canonical driver与Grok4.7fast/low完成18次自然玩家输入，含开场为19个内核回合；本局legacy，调查、NPC交涉、失败、观察、夜间进屋与玩家主动退出均真实发生。
- T17只在正文/笔记中结束委托，未被算作正式结束。T18明确结束后，真实campaign状态completed并有结算/会话收据。不是清除危险的通关胜利。
- reference_mode实际为jev，19条craft遥测中开场disabled1次，其余selector_unavailable18次，injected=0。因此只验证了无凭据回退与新正向指导的可玩路径，不认证Jev效果。
- UI在独立setting_up战役上验证default off、切jev持久化、刷新、1.3.1→1.5.0升级、禁用/重启用；非Mod世界字段不变。桌面截图目视检查，未宣称移动端验收。没有改旧用户战役或打包App。
- 标准KPI保留23个内核错误/拒绝；新Mod未让不可用Jev阻塞回合，但整体文字仍有复读、指代与未给出资料被写成空白等观察。legacy off/off的场景胶囊刷新缺口早于本次改动，未在此扩展修复或断定复读因果。
- 证据 `.coc/playtests/craft-reference-live-20260924/REPORT.md`、`live-verification.json`、`kpi.txt`、`ui-*.json`；战役位于 `.coc/playtests/craft-reference-home-20260924/`。自有driver和源码Web server均已停止，证据不删除。
- 后续只差安全配置Jev后，另建新run验证真正选卡/注入及其体验；不能把当前injected=0的桌子算作成功启用参考。
