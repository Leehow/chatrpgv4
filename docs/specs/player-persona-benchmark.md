# player-persona-suite-v1：玩家人格基准

状态：规格（2026-09-11 用户当回合授权「用这些玩家类型做并发测试」）。实现见
`tests/play/personas/`、`tests/play/player.py`、`tests/play/bench.py`、
`tests/play/persona_report.py`。

测的不是「守秘人能不能把模组跑完」，而是：**当玩家把注意力放在完全不同的游戏目标上，
守秘人的哪一项能力先失效。**

---

## 0. 边界：这不是真桌验收

`Agents.md` 的真桌方法只有一种：主会话是唯一玩家，一句一回合。本套件**不替代它，也不许
被当成它**。

| | 真桌验收（§10 / `docs/acceptance.md`） | 本套件 |
| --- | --- | --- |
| 守秘人 | 真产品路径 | **同一条真产品路径** |
| 玩家 | 主会话（人） | 协议隔离的人格 agent |
| 目的 | 产品是否成立 | 换玩家行为后哪条能力退化 |
| 结论可否当验收 | 是 | **否** |

因此：

- 每个 run 的元数据带 `method: "persona-benchmark"` 与 `acceptance: false`；报告首行印同一句。
  谁要拿 108 场当验收，证据文件自己会拒绝。
- **守秘人一侧不许有任何捷径。** 没有批量结算、没有假守秘人、没有关键词路由、没有模板刷
  回合。每回合是 `bin/pi-coc` 的一次真往返，走 `tests/play/driver.py` 的守护进程，与真桌
  完全同一条路。违反即整个 run `invalid`。
- 人格玩家替换的只有「谁在打字」这一端。

## 1. 玩家一侧的隔离（硬不变量）

人格玩家是**另一个进程**，不是本会话的一段提示词，也不是驾驭器里的一个分支。

```
pi --mode rpc --no-tools --no-extensions --no-skills --no-prompt-templates
   --no-context-files --no-session --system-prompt <persona prompt>
   --model <player model>
   cwd = <run scratch>/player   PI_CODING_AGENT_DIR = <run scratch>/player-home
```

四条不变量，`bench.py` 每个 run 自查一次，任一条不成立则该 run 记 `invalid`，不进报告：

1. **无工具、无仓库。** argv 含上面六个禁用开关，工作目录是一个空临时目录，Pi home 是空的；
   人格 agent 读不到模组、图谱、契约、测试标准。
2. **单向通道。** 送进守秘人的字节，必须逐字等于人格 agent 本回合返回的 `player_message`。
   harness 记两端的 sha256，不等就 `invalid`。
3. **玩家只看玩家能看的。** 人格 agent 每回合收到的是「交付投影」（§2），由守秘人本回合
   `narrate`/`ask` 的结果算出：正文 + `mechanics`，且 `visibility: "keeper"` 的行按 §16.5
   删掉。胶囊、工具调用、遥测、模组真相、守秘人系统提示，一个字都不进玩家上下文。
4. **副档不回流。** `private_eval`（§3）只写进 harness 的 trace，永不进守秘人的任何一条消息。

## 2. 交付投影：玩家看到什么

真产品里玩家看的是 PipiCOC 的交付卡：守秘人正文 + 本回合机制行（`pipicoc/mechanics.js`）。
数字不在正文里（§16.3），所以**只喂正文等于把规则党和优化党剥夺到废**。投影规则：

- 正文取 `details.rendered_text`，缺则取驾驭器的 `final_text`。
- 机制取 `details.mechanics`，逐行按收据原样印，**不计算、不改写**；`visibility: "keeper"`
  的行整行丢弃。
- 守秘人问话（`ask`）的选项原样带上；玩家可以用自然语言回答，与真桌一致。
- 一回合没有交付（`settle_class != "settled"`）时，玩家收到的是一行产品级的空转说明，
  与真人在真桌上看到的一致，并计入 `stalled_turns`。

## 3. 人格 agent 每回合的输出

```json
{"player_message": "<发给守秘人的一句自然玩家输入>",
 "private_eval": {"current_goal": "...", "current_hypothesis": "...",
                  "hypothesis_confidence": 0.0,
                  "perceived_agency": 0, "confusion": 0, "engagement": 0, "frustration": 0}}
```

- 只有 `player_message` 过河。
- `private_eval` 是**自述**，不是结构事实；报告里永远标成 self-report，不能当作系统指标
  （`coverage-is-self-report-not-structure` 的教训）。它的价值是给裁判提供「玩家此刻相信
  什么」，而守秘人并不知道——这正好量出最典型的坏毛病：**玩家一猜，守秘人就把它变成真相。**
- 解析失败（不是 JSON、缺字段）重试一次，仍失败则该回合记 `player_malformed`，run 继续；
  连续三次则 run 以 `player_unusable` 收场。

## 4. 人格档案 schema

`tests/play/personas/<id>.json`，**全英文**（模型可见文本一律系统语言，§16.1）。

```json
{
  "id": "P01",
  "name": "detective_problem_solver",
  "kind": "normal" | "stress",
  "summary": "one English line",
  "motivations": {"<activity>": 0.0-1.0},
  "behavior": {"<knob>": "<value>"},
  "special": ["English behaviour rule", "..."],
  "natural_investigator": {"concept": "...", "pregen": "thomas-hayes" | null,
                           "creation_brief": "English brief for the setup lane"},
  "probes": ["what this persona is meant to stress — judge-side only, never shown to the player"],
  "assertions": ["<metric id>", "..."]
}
```

- `motivations` 的键取 2024 DMG 的活动集合：`acting`、`exploring`、`fighting`、`instigating`、
  `optimizing`、`problem_solving`、`socializing`、`storytelling`。这是闭合枚举，不是语义分类表。
- `behavior` 的键值对原样渲染进人格提示，harness 不解释它们。
- `assertions` 只能引用 `tests/play/persona_metrics.py` 注册表里存在的指标 id；引用不存在的
  指标是加载期错误。**没有注册表就没有指标**，防止报告长出一个谁也说不清怎么算的分数。
- `probes` 与 `assertions` 进裁判，不进玩家。玩家只拿 `summary`/`motivations`/`behavior`/
  `special`——否则人格就在「故意测系统」，那是 S 系人格才该做的事。

## 5. 十八个人格

正常十二个覆盖动机体系；压力六个专打系统弱点。

| id | name | 打什么 |
| --- | --- | --- |
| P01 | detective_problem_solver | 线索图、错误假说、是否过度提示 |
| P02 | explorer_lorehound | 非主线路径、世界一致性、不许胡编设定 |
| P03 | method_actor | 角色自主权、NPC 关系、**不许替玩家决定内心** |
| P04 | storyteller | 伏笔与回收、节奏、长期因果 |
| P05 | optimizer | 规则精度、难度一致性、懂规则不等于放水 |
| P06 | butt_kicker | 战斗规则、敌人行为、暴力的世界后果 |
| P07 | instigator | 非预期行动的受理、世界内后果、硬拒绝率 |
| P08 | specialist | 专业技能是否真有价值、另类解法 |
| P09 | simulationist | 时间脊柱、资源账、物理与社会逻辑 |
| P10 | casual | 信息负担、引导清晰度、守秘人不许替玩家玩 |
| P11 | risk_averse | 压力系统与时间推进；不逼玩家送死也要有剧情 |
| P12 | completionist | 重复线索、死循环、节奏控制 |
| S01 | metagamer | **truth_state 不随 player_belief 改变** |
| S02 | anti_railroad | 偏航后的导回是世界内后果还是硬拒绝 |
| S03 | murderhobo | 暴力解社交、世界后果、剧情容错 |
| S04 | passive | 主动性管理：守秘人会不会替玩家玩 |
| S05 | state_cheater | 状态权威：引擎是权威，人物卡是镜像 |
| S06 | info_attacker | 秘密隔离：守秘人信息不许交出去 |

P11、P12 是为 CoC + AI 守秘人加的：这两种行为最容易把导演层跑坏。

## 6. 指标三层

一个分数说明不了任何事。每个指标必须注册在 `tests/play/persona_metrics.py` 里，声明它的
**层**与**证据来源**。

- **A 层 · 收据**（确定性，读 `.coc/campaigns/<id>/telemetry.jsonl` 与 `turns/NNNN.json`）：
  回合数、进规则层的回合、admission 判决分布与耗时、线索收据（发现数 / 全书数 / 重复率）、
  内核错误码、`stalled_turns`、Director 采纳、offers 账、存活与结局、首次写状态前的只读调用数
  （复用 `kpi.py`）。**这一层不问模型。**
- **B 层 · 玩家自述**（`private_eval` 聚合）：agency / confusion / engagement / frustration 的
  中位数与轨迹、假说变更次数。永远标 self-report。
- **C 层 · 裁判车道**（模型，事后，离线）：语义判断只能由模型做（`Agents.md`「语义问题不许
  硬编码」）——硬拒绝、替玩家决定内心、未获得证据就确认假说、秘密泄露、伪选择。裁判是带工具
  的 pi agent，读的是 run 的证据目录加模组真相；**每一条 finding 必须引一个回合号与一句原文，
  引不出的 finding 直接丢弃。**裁判不打总分，只对一个闭合枚举作答：
  `ok` / `violation` / `not_exercised`。比率 = violation / (ok + violation)。

硬闸（任一为真，run 标红，与分数无关）：`secret_leak`、`state_corruption`（叙述里发生了却
没有收据）、`rule_p0_error`、`player_internal_state_violation`。

## 7. 两条车道，不许混

- **Controlled**：所有人格用同一张 pregen（`thomas-hayes`），只变人格。回答「行为差异是否导致
  守秘人表现差异」，变量干净。
- **Natural**：人格按自己的偏好拿角色。默认走真建卡进程（`--launcher bin/pi-coc-setup`，
  人格 agent 自己回答七步），因为「玩家自己选了角色之后系统服不服务这种玩法」正是要测的东西；
  `--natural-source library` 改为从调查员库 `investigator.load` 载入预先备好的卡，省一次建卡的
  开销。
- 两条车道的结果分开报，不合并。

## 8. 矩阵、停局条件与代价

一个 run = 一个人格 × 一个 trial × 一条车道 × 一个战役 id × 一个 run id。

- `trial` 是**重复次数**，不是随机种子：守秘人本来就不确定，本套件不宣称可复现。trial 只
  改战役 id、run id 与人格提示里的一句变体提示。
- 停局：`max_turns`（默认 30）、战役进入终局（结局 / TPK）、连续 `K=3` 回合非 `settled`、
  墙钟上限。**不要求跑到结局**：「这个玩家把模组玩崩了」本身就是结果。
- 满矩阵 18 × 3 × 2 = 108 场。以第三张真桌为尺（40 回合 2222 秒，grok-4.6 当守秘人）：
  单场 30 回合约 28 分钟，108 场约 50 小时串行；8 路并发约 6.3 小时，代价在额度而不在时间。
  **满矩阵必须由用户当回合明说才跑**，默认只跑 `tests/play/suites/smoke.json`。

## 9. 并发

- 每个 run 一个战役 id、一个 run id、一个驾驭器守护进程与它自己的 `pi`；锁是按战役的
  （`.coc/locks/<campaign>.lock`），所以互不相干。
- 共享的只有只读的模组库与 `.coc/ui-words/` 缓存。
- 并发度默认 4，`--concurrency` 可调。额度与 provider 限流是真实上限，不是理论上限。
- 证据只增不删（`Agents.md` 永久法）：崩掉的 run 留在原地，报告里标 `invalid` 并说明原因。

## 10. 报告

每个 run 一份 `report.json`：

```json
{"persona": "P07_instigator", "lane": "controlled", "trial": 1,
 "method": "persona-benchmark", "acceptance": false,
 "hard_gates": {"secret_leak": 0, "state_corruption": 0, "rule_p0_error": 0,
                "player_internal_state_violation": 0},
 "receipts": {...A 层...},
 "self_report": {...B 层...},
 "judged": {"<metric id>": {"rate": 0.03, "ok": 29, "violation": 1, "not_exercised": 2,
                             "citations": [{"turn": 7, "quote": "..."}]}},
 "outcome": {"turns": 31, "ending": "partial_success", "critical_clues_found": 7,
             "critical_clues_total": 9, "investigator_alive": true},
 "evidence": {"campaign": ".coc/campaigns/<id>", "playtest": ".coc/playtests/<run>",
              "trace": ".coc/benchmarks/<suite>/<run>"}}
```

套件汇总 `suite.json` + 一张按人格的表。**不出总平均分**：要看的是
「candidate 在哪一种玩家身上退化了」。比较两次套件时按人格出 delta，按退化幅度排序——
一次 Director 改版让主线更顺而把偏航玩家打穿，平均分会把它盖掉，这张表不会。

## 11. 这套东西自己怎么测

`tests/play/test_bench.py` 与 `tests/play/test_player.py` 用现成的
`tests/play/fixtures/fake_pi_rpc.py` 跑，不花额度、不碰模型：验的是隔离四条不变量、投影
（keeper 行被丢掉）、停局条件、并发下的 run 目录不互撞、报告 schema、以及**人格引用未注册
指标时加载失败**。裁判车道的提示词与解析用固定样本验，不调模型。
