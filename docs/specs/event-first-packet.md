# 事件表协议：KP 只写发生了什么，登记由程序推出

Status: 设计稿，待用户拍板（2026-10-25）。未实现。

## 要解决的问题

Codex 逐段读了 9 局长局里 330 段超过 1k token 的 KP thinking（报告见
`.tmp/codex-play/thinking-backfill-report.md`，只做概括）。按主因归类：

| 类别 | 估算 token 占比 | 典型卡点 |
|---|---:|---|
| A 登记、引用与交付怎么装 | 29.6% | 人走 apply 还是 walk_on 还是 new_N；发现走 clue / observe / reveal / exhibit；fact_ref 能不能给这个人用；knowledge_status 选哪个 topic；正文谁写 |
| D 检定适用与结果重审 | 24.8% | 已有收据还重判；可选续接当义务（§268.1、§268.6 已处理一部分） |
| C 跨阶段执行顺序 | 22.8% | 人、线索立即落盘，移动等 output；一回合跨几个地点要手工排先后 |
| E 人物与因果演绎 | 10.2% | 正常思考，不是要消掉的 |
| B 查书何时收手 | 7.3% | 未命中、未读到、书里没写分不清 |
| F 被拒后的整轮重想 | 5.4% | 小拒绝触发整条计划重写 |

1025c 和 1025b 比：调用轮数和 apply 次数都降了，但 A 类反而翻倍，每轮平均等待
没有变（121.7s 对 121.3s）。§267 把发现、情绪、姓名搬进 output 包，只是把入口挪了
位置，KP 仍然要先决定“这件事用哪个协议名词装”。

根因是**同一件故事里的事有好几种合法写法，而选哪种要靠 KP 自己推理**：

- 一个人出场：`apply npc to:here`、包里的 `walk_on`、互动里的 `new_N`、书中人按书名 walk_on。
- 调查员得知一件事：`clue`、`place observe`、`reveal source_N`、`exhibit_ref`、互动 `content`。
- 一个人开口：`fact_ref`、`source_ref`、`exhibit_ref`、`knowledge_status`、`meaning`，外加 told / heard / party_said 和 refer / restate / clarify / update 四种策略。
- 文件：`document open / show / observe(held|shown|glimpse)`、`handover`，各有在场前提。
- 时点：`apply` 立即生效，`output` 回合末生效；同一个人、同一个地点在两边各有一份状态。

## 设计：一张事件表

KP 每一轮只交一样东西：**按发生顺序排的事件表**。每条事件用故事里的动词写：谁、
对谁、做了什么、说了什么、在哪里。人和地点**一律用名字**，可以是书里印的名字，也可以是
桌上已有的称呼，或者一个新称呼。KP 不发引用，不选登记方式，也不写正文。

```json
{"events":[
  {"go":"马丁滩治安官办公室","inside":"马丁滩","with":["周衡"]},
  {"arrive":"欧文·塔布勒"},
  {"show":"阿卡姆警局公函","by":"周衡","to":"欧文·塔布勒","reads":true},
  {"give":"阿卡姆警局公函","from":"周衡","to":"欧文·塔布勒"},
  {"say":"欧文·塔布勒","to":"周衡","act":"answer","tells":["k3",{"claim":"墓地的事他上周就听说了"}],"beat":"把公函压在镇纸下"},
  {"feel":"欧文·塔布勒","toward":"周衡","disposition":"neutral"}
]}
```

### 动词（封闭集合，约 12 个）

| 动词 | 意思 | 取代 |
|---|---|---|
| `go` | 一行人去某地；`inside` 表示新地点在哪个地点里面；`with` 是同行的人 | place move、additions、spot 与小地点之争（§268.4）、§267.5 同伴 |
| `wait` | 花时间：分钟、到几点，或者规则时段 | time |
| `arrive` / `leave` | 一个人进场、离场 | apply npc to:here / away、walk_on、new_N、书中人入座 |
| `say` | 开口：`act` 沿用现有的闭合集合；`tells` 是程序给的知识编号 `kN` 或 `{claim}`；`doesnt_know` / `wont_say` 写在这里 | interactions、content 的五种引用、knowledge_status、meaning、四种策略 |
| `notice` | 调查员看到、听到、读到某件事：`kN` 或一句话 | clue、place observe、reveal、exhibit |
| `show` / `give` / `take` | 文件和物品：给人看、交出去、拿起来 | document open / show / observe、handover、object |
| `feel` | 情绪、态度、信任、恐惧 | mood、relationship |
| `learn_name` | 调查员知道了这个人叫什么 | name |
| `scene` | 这里开着还是关着、人多还是人少 | scene |

检定照旧走 `resolve`，不进事件表。孤注一掷和幸运只由玩家声明（§268.6）。

### 程序负责推出来的东西

1. **人名一律走一个解析口**。顺序是：桌上已有的人（含称呼）→ 书里印的名字 → 新人。
   书里的人按书中身份入座；书里没有的人按 §267.4 当场建全套；首次 `arrive` 或
   首次出现在 `say` / `show` 里就是入场。KP 永远不写 `npc_N`、`new_N`、slot。
2. **知识只有一个编号空间 `kN`**。现在的 fact / source / exhibit / testimony 合成一张
   “这个人此刻能说的事”和“这里能看到的事”。told、heard、party_said 由程序标注，
   KP 不选策略：重复说过的事，程序自己按 refer 处理。没有编号的内容写 `{claim}`，
   存成“说了，未必是真的”。
3. **发现怎么记由程序判**。`notice` 指向书里的线索就记线索、跑书里写的检定；指向
   书页原文就是揭示；只是一句话就记观察。KP 不在 clue、observe、reveal 之间做选择。
4. **文件的状态从动作推出来**。`show` 里 `reads:true` 就是当面读过，`give` 就是交接。
   在场前提由程序按事件顺序在模拟状态里检查：前面一条 `go` 进了办公室，后面的
   `show` 就在同一处。
5. **按顺序执行，没有两套时点**。整张表在一个事务里按顺序模拟：每条事件先在模拟
   状态上检查前提，全部通过再一次提交。检定必须在某次到达之后掷的时候，先交一张
   `final:false` 的表（立即提交），再 `resolve`，最后交 `final:true` 的表。两张表是
   同一套动词，KP 不用再想“这个该 apply 还是该 output”。
6. **拒绝指到具体那一条**。错误带事件下标、哪个名字、缺什么，以及已提交和未提交的
   清单；同一条事件的修正不重写整张表（对应 F 类）。
7. **正文只有作者写**。事件表里唯一的自由文字是 `beat`（几个字的可见动作）和
   `claim`（不超过 60 字的说法）。“谁写正文”这个问题不再出现。

## 实现方式：先在宿主侧编译，内核暂不动

第一步把事件表编译成现有的内核命令（place move、apply npc、walk_on、interactions、
reveal、clue、object/document），也就是在 `runtime/turn-packet-prototype.ts` 前面加
一层 v5 → v4 的编译器。这样内核契约、收据、回放都不变，出问题可以直接切回 v4 做 A/B。

| 阶段 | 内容 | 验收 |
|---|---|---|
| 1 | 名字解析口、`kN` 统一编号、v5→v4 编译器、指引重写（目标是现有指引篇幅的三分之一以内） | 单测覆盖每个动词编译出的 v4 命令；离线回放 1025c 的事件，编译结果与当时成功的写入一致 |
| 2 | KP 工具只暴露 v5；`apply` 退出普通回合，只留给开场、建卡、维护 | Codex 跑对比：同三本、同角色，每轮的长 thinking token、拒绝数、轮数、等待时间 |
| 3 | 视对比结果再把编译器下沉进内核，退掉 v4 的 `interactions` / `reveal` / `walk_on` | 全量测试；旧战役存档能读 |

## 成功和失败的标准

- 成功：A 类长 thinking 在同三本对比里降一半以上；每轮 KP 模型轮数中位数不超过 3；
  平均等待朝 60 秒走。拒绝数不升。
- 空心交付：只改指引措辞、只加别名、只把 v4 字段换个名字，或者为了让数字好看
  减少玩家动作的种类。

## 不做的事

- 不用关键词或正则判断一句话的意思；名字解析只做精确名、书中名和已登记称呼的
  匹配，判断不了就拒绝并列出候选，让 KP 用名字重写。
- 不新增模型车道。
- 不改检定、伤害、治疗这些规则内核。

## 需要你拍板的

1. 方向：同意用“事件表 + 程序推登记”替换现在的 v4 包吗？
2. 范围：第一步只做宿主侧编译器（内核不动、可切回），还是直接按第三阶段做？建议先做第一步。
3. `relationship` 里的 trust / fear / pressure / control 细项是否保留：建议保留在 `feel`
   里作为可选字段。
