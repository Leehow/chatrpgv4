# Gate Recoverability 第 0 步:闸门清单(2026-08-06)

主文档:[coc-gate-recoverability.md](coc-gate-recoverability.md)
方法:两路**静态扫描**(只读 explore,未做运行时回放):
`gate-scan-canonical`(canonical Python 层)与 `gate-scan-pi`(pi TS 宿主层)。
口径按「问题簇」聚合;行数可能随后续修复漂移,定位时以符号名为准。

## 一、总览

| 侧 | 指标 | 数 |
|---|---|---:|
| canonical | blocked/拒绝且 `next_operation` null/缺失/条件缺失 的返回点 | **67** |
| canonical | 结构化 `failed_fields` 实现 | **0**(全库零出现) |
| canonical | 独立手工拒绝构造形状 | **~55** |
| canonical | `ToolError` raise 总量(`details=` 仅 ~8) | 821 |
| canonical | `RuntimeOperationError` raise(无 code/fields/next_op) | 172 |
| pi TS | 重复契约判断点(白名单/再投影) | **28** |
| pi TS | 观察黑洞点(吞错误/裸 null/改写指令) | **18** |
| pi TS | 执行前拦截点(白名单守卫) | **12** |

`runtime/adapters/pi/` 为冻结旁白桥,确认不参与,已排除。

## 二、canonical Python 侧

### 2.1 开场 hard gate(8 个构造点,6 处字面 `next_operation: None`)

| file:line | phase/形态 | next_operation | 备注 |
|---|---|---|---|
| `coc_toolbox.py:1220-1245` | `opening_source_contract_invalid` | 恒 null(`:1240`) | 共享 helper `_pi_opening_source_contract_error_gate`;9 个调用点(`:1372,:1378,:1396,:1419,:1460,:1492,:1505,:1518,:1568`) |
| `coc_toolbox.py:1291-1304` | `opening_character_setup_required`(era-adaptive) | 恒 null(`:1300`) | 无建卡操作卡 |
| `coc_toolbox.py:1305-1319` | 同上(quick_fire) | 恒 null(`:1314`) | 同上 |
| `coc_toolbox.py:1424-1453` | `opening_source_review_failed` | 恒 null(`:1447`) | 明确禁止 retry |
| `coc_toolbox.py:1466-1487` | `opening_source_review_required` | 恒 null(`:1480`) | 等 coordinator |
| `coc_toolbox.py:1527-1554` | `opening_source_facts_adoption_required` | **有卡** adopt_source_facts | 构造即非 null |
| `coc_toolbox.py:1609-1723` | `opening_source_materialization` | **条件 null**(`:1619`) | `complete`→补卡 `:1655`;`resolver_lost`→补卡 `:1719`;`pending` 且未 lost 仍 null |
| `coc_toolbox.py:1725-1748` | `opening_selection` | **有卡** prepare_opening(`:1743`) | |

透传点(非新构造,可放大 null):

| file:line | 行为 |
|---|---|
| `coc_toolbox.py:1895-1902` | `run_tool` 拦操作 → `ToolError(opening_setup_incomplete, details=gate)` |
| `coc_toolbox.py:8051-8057` | `setup.invoke` 同 |
| `coc_toolbox.py:8105-8120` | PASS 后 gate 有 dict 卡才挂 `receipt.next_operation`;否则只 hint「wait」 |

### 2.2 opening/setup 类 ToolError(~42 处,几乎都不带 next_operation 卡)

| file:line | code | 卡 |
|---|---|---|
| `7647,7704,7756,7897,8072` | `setup_failed` | 缺失(`str(exc)` 包装) |
| `coc_runtime_ops.py:3986-3990` | era 已确立拒绝 | 缺失;文案含 era 新旧值(清晰但无退路) |
| `15431-15439` | `opening_host_work_dispatch_attempts_exhausted` | 缺失(有 job_ids 与上限) |
| `15441-15444` | `opening_host_work_takeover_unavailable` | 缺失 |
| `14539,14551,14946,14950,14988,15010,15019,15088,15227,15233,15337,15380,15495,15720,16363…16493,17462,24702,24708,24713,24789` 等 | 其它 `opening_*` / `opening_setup_invalid` | 缺失(少量 `details=` 为 validation 状态位,非卡) |

仅 `opening_setup_incomplete`×2 透传 gate details(而 details 本身常为 null)。

### 2.3 其它 blocked 与 wire 层(无卡)

| file:line | 类型 |
|---|---|
| `coc_live_turn_runner.py:367,2212,2227,2250,2316` | compound continuation blocked + blocker |
| `coc_action_resolver.py:1471` | semantic resolver blocked/unresolved |
| `coc_director_apply.py:3237,3479` | 路线 completion `status=blocked`(世界状态,非 KP gate) |
| `coc_tomes.py:137,140,215,272` | `{"blocked": code}` |
| `coc_healing.py:930` | `monthly_gain_required` |
| `coc_mcp_wire.py:2079-2095` | `_claim_projection_failure`:投影失败收据,**无**恢复卡(`:2402` 使用点) |

成功/旁路卡(非拒绝,供迁移参照):`14572-14594` prepare_opening 成功挂 bootstrap 卡;
`15119,15153` publish 用 `retry_card`(键名非 `next_operation`);
`coc_module_queue_worker.py:1982-1995` + `2201,2212` `_full_parse_next_operation`;
`coc_module_assets.py:1813-1830,2014-2015,2084` full_parse 状态机(complete/queued 清 null);
`12053+,12498` `background_takeover.next_host_action`(平行命名);
`21126,22321` advisory 卡(`hard_gate:False`);`25322` finalize 卡(回合完备性)。

### 2.4 拒绝文案:结构化失败字段名 = 0

`failed_fields` 全 canonical Python 零出现。现状分布:

| 模式 | file:line | 点名字段? | 期望值结构? |
|---|---|---|---|
| 开场 gate `instruction`/`reason` | `1241-1245,1301-1303,1315-1317,1448-1452,1481-1486,1550-1553,1620-1625,1744-1747` | 否(phase/叙事) | 否 |
| contract error 嵌 `source_contract_error` | `1236-1239` | 仅 code/message 自由文本 | 否 |
| `setup_failed` ← `str(exc)` | `7897` 等 | 取决于底层消息 | 无结构 |
| era 拒绝 | `runtime_ops.py:3986-3990` | 有 era + 新旧字面量 | 自由文本 |
| facts 校验 | `runtime_ops.py:568-643` 一带 | 常有 fact 名/缺键 | 自由文本 |
| investigator sheet | `runtime_ops.py:4755-4757` + `coc_character.py:346+` | 多数 `errors.append` 含字段名 | `list[str]` join,非结构化 expected |
| `missing_param` details | `toolbox.py:2199-2206` | **`missing_parameters` 列表** | 现存最接近的结构化诊断 |
| tomes/healing blocked code | `tomes.py:137+`,`healing.py:930` | 枚举 code | 无 expected |
| compound blocker | `live_turn_runner.py:347-362` | reason_code | 玩家文案,无字段 |
| full_parse next_op message | `queue_worker.py:1982-1995` | 操作名级 | 无字段级 |

### 2.5 拒绝构造形状分布(~55 类,无统一构造器)

| 构造方式 | 位置 | 备注 |
|---|---|---|
| 手工 gate dict(每 phase 一份) | `toolbox.py` 8 处 | 开场 hard gate |
| `_pi_opening_source_contract_error_gate` | `:1220`,9 call sites | 统一壳但**强制 null next_op** |
| `_opening_card` | `:14186-14196`,~14 调用 | 只拼卡片形状,非拒绝体 |
| `_full_parse_next_operation` | `queue_worker.py:1982` | OCR 终态重试卡 |
| `ToolError(code,msg,details?)` | toolbox 821 raise,`details=` 仅 ~8 | 通用错误信封 |
| `run_tool.failure()` | `1869-1880` | ok:false 信封 + hints |
| `_error_recovery_hints(code)` | `1103-1181` | code→提示串 |
| `RuntimeOperationError(msg)` | runtime_ops 172 raise | 无 code/fields/next_op |
| `validate_*` → `errors: list[str]` | `coc_character.py` ~84 append | 最接近 failures 派生(predicate=`bool(errors)`) |
| `_compound_blocker(reason_code)` | `live_turn_runner.py:347` | 复合动作阻断 |
| `_claim_projection_failure` | `mcp_wire.py:2079` | 瘦身失败投影 |
| `retry_card` / `next_host_action` | publish / takeover | 平行命名恢复入口(碎片) |
| `investigatorCreatePayloadFailures` | `pi/extensions/index.ts:838` | 文档样板,**不在 canonical Python** |

`rulesets/**` 无拒绝构造;`coc7/resolver.py` 只做规则委托。

## 三、pi TS 侧(`plugins/coc-keeper/pi/**`)

### 3.1 重复契约判断点(28)

| # | file:line | 符号/模式 | 状态 |
|---|---|---|---|
| 1 | `index.ts:152-157` | `exactKeysMatch` 基础设施 | 全文件 ~26 次调用 |
| 2 | `index.ts:838-962` | `investigatorCreatePayloadFailures` | 宿主在 canonical 前再判(文档样板,优先级低) |
| 3 | `index.ts:966-1008` | `openingInvestigatorCreateRejection` | 依赖 #2 的执行前拒绝 |
| 4 | `index.ts:1011-1086` | `canonicalSetupInvokeForOpening` | kind 白名单 + 精确键 |
| 5 | `index.ts:1397-1431` | `exactOpeningSetupRouteInvocation` | 精确键集 + 哈希 |
| 6 | `index.ts:1454-1474` | `exactOpeningActivationCard` | 固定 shape |
| 7 | `index.ts:1765-1780` | `exactTableOpeningReceipt` | 回执字段/sha 复判 |
| 8 | `index.ts:1781-1814` | `routeFromGate` | input_mode 白名单映射 |
| 9 | `index.ts:1816-1830` | `exactPrepareCard` | 固定卡 |
| 10 | `index.ts:1834-1853` | `validOpeningStartLocation`/`validOpeningPdfIndices` | bootstrap 参数形状 |
| 11 | `index.ts:1870-1912` | `exactBootstrapCard` | 卡 + missing 键白名单 |
| 12 | `index.ts:2375-2387` | bind→route 接受条件 | 白名单 |
| 13 | `index.ts:2469-2486` | `exactProjectedResumeError` + `canonicalPreboundProbe` | 精确三键 |
| 14 | `index.ts:2512-2547` | `canonicalCharacterSetupProbe` | 两套键列表按 policy 分支 |
| 15 | `index.ts:2548-2600` | `canonicalMaterializationProbe` | 半改:仍只认两操作名 |
| 16 | `index.ts:2601-2619` | `canonicalSourceReviewProbe` | phase/provenance/owner 字面量 |
| 17 | `index.ts:2620-2634` | `canonicalSourceFactsProbe` | facts 卡键集 |
| 18 | `index.ts:3036-3099` | prepare_opening observe | 仅 exactBootstrapCard 才 transition |
| 19 | `index.ts:3119-3161` | opening_bootstrap observe | 仅 `complete`/`current` |
| 20 | `index.ts:3163-3204` | project_opening observe | 状态白名单 |
| 21 | `index.ts:1202-1335` | `exactCanonicalCharacterSetupReceipt` | 六种回执 shape 复判 |
| 22 | `index.ts:5196-5271+` | `validOpeningTransportFacts` | 全键 + status 分支键集 |
| 23 | `index.ts:5334-5464` | `projectPiGuidedCharacterContract` | 按 era 裁 oneOf、改写 schema 元数据 |
| 24 | `index.ts:5467-5490` | `findAutoDispatchTakeover` | 多路径并存→null |
| 25 | `index.ts:5525-5630` | `findCurrentDependencyLifecycle` | 闭合 shape 全量校验 |
| 26 | `index.ts:7020-7052` | `projectStartupSourceFactsAdoption` | details 10 键精确 |
| 27 | `index.ts:7054-7095` | `projectStartupOpeningSelection` | 白名单 + **重写 instruction** |
| 28 | `index.ts:7097-7378` | startup 投影簇(character/materialization/review/contract + 编排) | 见下表 |
| — | `lib/runtime.ts:834-974,80+` | `COORDINATOR_FAILURES`/leaf 闭合白名单 | failure_class/diagnostic 不在集合即抛 |

startup 投影簇(`index.ts:7020-7378`)已通用 vs 仍白名单:

| 投影器 | 行 | 状态 |
|---|---|---|
| `projectStartupSourceMaterialization` | 7171-7246 | **半通用(参照)**:非 pending 转发卡+原 instruction;op 名仍闭合,pending 仍固定 |
| `projectStartupCharacterSetup` | 7097-7169 | 白名单;next 必须 null;**重写 instruction** |
| `projectStartupSourceReviewRequired` | 7248-7288 | 白名单;next 必须 null |
| `projectStartupSourceContractInvalid` | 7290-7328 | 白名单;错误压成 code |
| `startupCanonicalFailureProjection` | 7330-7378 | 仅 `opening_setup_incomplete` 走 6 投影器链;失败→无 details |

### 3.2 观察黑洞点(18)

| # | file:line | 形态 |
|---|---|---|
| 1 | `index.ts:7366-7373` | `projectedDetails === null` → 整段省略 `details`,KP 只见 code |
| 2 | `index.ts:7020-7328` | 各 `projectStartup*` `return null` → 落入 #1 |
| 3 | `index.ts:7083-7094` | selection 丢弃 canonical instruction,换宿主固定句 |
| 4 | `index.ts:7136-7148,7163-7167` | character 重写 instruction |
| 5 | `index.ts:7310-7318` | contract invalid 只剩 code,原始诊断丢 |
| 6 | `index.ts:5740-5748` | autoDispatch `!enabled` → `capability_unavailable` |
| 7 | `index.ts:5783-5787` | 已有 active 且非 exactTask → **裸 `return null`** |
| 8 | `index.ts:5667-5675` | `coordinatorDispatchNullReason` state=null 分支仍报 `capability_unavailable` |
| 9 | `index.ts:7745-7774` | bootstrap 提交失败仍包进固定信封 |
| 10 | `index.ts:6458-6476` | `failedBlockingOpeningEnvelope` 固定 message,不带 canonical details |
| 11 | `index.ts:2454-2464,3080-3099,3220+` | observe `accepted:false` 无 `modelProjection`,原 envelope 被替换/忽略 |
| 12 | `lib/runtime.ts:2624-2637` | fulfill 只记 `fulfill_rejected_by_canonical` + 固定 path,**不写 canonical error.code**(主文档 §九.2 仍成立) |
| 13 | `lib/runtime.ts:1711-1725` | leaf 异常压成 `leaf_dispatch_failed`/`leaf_result_invalid`,消息丢 |
| 14 | `lib/runtime.ts:1395-1398` | coordinator parse catch 无原因串 |
| 15 | `lib/runtime.ts:1949-1951` | MCP 无 structuredContent → details 不可达 |
| 16 | `lib/hud.ts:45-50` | onboarding gate → HUD 静默 null |
| 17 | `index.ts:5387,5406` | guided contract 投影失败只剩 code |
| 18 | `index.ts:1690-1695` | rearm=null 时宿主自造 `next_operation: null` + wait_only |

### 3.3 执行前拦截点(12)

| # | file:line | 守卫 | 拦截对象 |
|---|---|---|---|
| 1 | `index.ts:6873-6897 + 7393-7404` | `startupResumeToolError` | 除 capabilities/精确 resume 外几乎所有工具 |
| 2 | `index.ts:8007-8011,8046-8050` | 同上 | `coc_dispatch_source_work`/`coc_progressive_ocr` |
| 3 | `index.ts:7407-7414` | `PRIVATE_LEASE_OPERATIONS` | claim/fulfill/renew/release |
| 4 | `index.ts:2153-2305 + 7416-7430` | **`openingSetupToolError`(主模式)** | `coc_invoke`/discover/ocr;未命中 exact route 或建卡白名单 → throw |
| 5 | `index.ts:2156-2171` | 同上 | gate 激活时 `coc_discover`/`coc_progressive_ocr` 整工具不可用 |
| 6 | `index.ts:2236-2248` | exact route 放行分支 | 非精确卡片调用 |
| 7 | `index.ts:733-865 + 1114-1200` | `characterSetupAllowedActions` | 建卡 ops 白名单准入 |
| 8 | `index.ts:2258-2292` | roll_dice 特判 | 非 Luck/自适应 recipe 强制 JSON 配方拒绝 |
| 9 | `index.ts:2296-2299` | `openingInvestigatorCreateRejection` | 畸形 investigator.create(仍执行前) |
| 10 | `index.ts:4029-4071 + 7434-7445` | `currentDependencyToolError` | dependency 未消费前挡其它 op |
| 11 | `index.ts:8051-8057` | openingSetup on OCR tool | 与 #4 同源 |
| 12 | `index.ts:8074-8110 + 4161-4566` + `mechanical-output-gate.ts:18-32` | transcript/mechanical gate | 玩家可见输出空间收缩 |

`allowed_actions` 写入 route 的位点(供给 KP 的白名单,与 #7 守卫对应):
`1557,1578,1607,1627,1728,1745,2392,2646,2670,3130,3559,3705` 等。

## 四、开放问题(扫描遗留)

1. `opening_character_setup_required` 的正确卡应是 `setup.invoke investigator.create` 还是
   `setup.investigator_contract`?当前双 null。
2. `opening_source_review_*` 是否允许任何 next_operation,还是设计上终态无路?
3. 821 个 `ToolError` 是否全量纳入口径,还是只计 hard_gate/opening/setup?本清单取后者。
4. `investigatorCreatePayloadFailures` 算重复契约还是合法 predicate 样板?已计入但优先级低。
5. mechanical/transcript 门是否计入「执行前拦截」产品指标?已计入输出空间收缩。

## 五、Start Here(第 1-2 步迁移的起点)

1. `plugins/coc-keeper/pi/extensions/index.ts:7020-7378` — 六个 `projectStartup*` + 空 details 编排(重复判断与黑洞交汇,已有半通用样板)。
2. `plugins/coc-keeper/scripts/coc_toolbox.py:1220` `_pi_opening_source_contract_error_gate` 与 `:1354` `_pi_opening_setup_gate`;`:1619` materialization 条件 null。
3. `index.ts:2153-2305 + 7416-7430` — `openingSetupToolError` 执行前白名单。
4. `coc_runtime_ops.py:3986` era 拒绝(清晰但无退路卡)。
5. `lib/runtime.ts:2624-2637` — fulfill 丢 canonical error code(主文档 §九.2)。
6. 对照样板:`pi/extensions/index.ts:838` vs `coc_character.py:346` errors 列表 vs `toolbox.py:2199` `missing_parameters`。
