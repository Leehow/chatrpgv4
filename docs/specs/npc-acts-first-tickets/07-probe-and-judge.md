Status: ready-for-human（2026-09-26 探针已跑：yes 100% 过线，同一件事 9 行未过线；见 Comments 的分析，等 lead 定夺改指令文件还是改包，或改判"同一件事"这道线本身在非执行探针里测得出来）
Spec: docs/specs/npc-acts-first.md（第五节）

# 07 — 造景探针与裁判（离线，真模型）

## Scope

- 脚本 `tests/play/npc-act-probe.py`（或 `.mjs`）：从保留的两桌（`.coc/campaigns/npc-actor-gate-a`、`-a2` 的 turns/NNNN.json）重建诺特 T2–T8 每回合的 D1 包（01 的读，在回放的 checkpoint 上），喂产品端口（02，真实快模型），记录 `{turn, packet_digest, act, bind}`；三轮。
- 裁判：pi -p 子进程（stdin 关掉），指令「处于他的处境的人会这么做吗」，输入 = 包 + 行，输出 yes/no + 一句理由；同一桌内再问一次 04 的同一件事问题。
- 结果落 `.coc/playtests/npc-act-probe-<ts>/`，摘要打印：yes 率、同一件事次数、intention_only 占比、每回合 ms。
- 只在 Mac 跑（真模型；记忆 `leehow-pc-is-the-test-box`：箱子不做 live 调用）。

## Not in scope

- 真桌（08）；把探针结果当验收（它是造景，记忆 `seeded-probe-finds-what-play-cannot`）。

## Acceptance

- 三轮 yes ≥ 90%，同一件事 = 0；未达标不改阈值，回 02 改指令或回 01 改包，记录每次改动与读数。
- 探针输出含每回合的包摘要，能对照 A/A2 那一回合诺特实际做的事。

## Comments

- **2026-09-26（sonnet 实现，真模型跑通）。** 脚本 `tests/play/npc-act-probe.mjs`：3 轮 × 两桌（`npc-actor-gate-a`、`-a2`）× turn 1–8，内核种子固定 `20260926`（只有生成模型的采样在变，回放本身是确定性的）。真实端口：内核直连 RPC（`build/kernel/rpc.mjs`，同 `tests/kernel/conftest.py` 的 RpcClient 协议）、`runtime/jev/npc-act.ts` 的 `createNpcActLane`（模型 `opencode-go/deepseek-v4.1-flash`，走公开 SDK 起的一个裸会话，`DefaultResourceLoader({noExtensions, noSkills, noContextFiles})` + 一个只捕获 `pi`/`session_start` 的内联扩展）、`runtime/jev/npc-act-step.ts` 的 `npcActBatch`/`interpretNpcAct`、`runtime/jev/decision-adapter.ts` 的 `createDecisionAdapter`（真 Jev，key 从 App 的 vault 读，同 `gate-start.sh`）。绑定从不执行进回放的战役（票面原话："recording the bind is enough"）。凭证：真实 provider auth 从 App 的 agent home（`~/Library/Application Support/Pipi/pipicoc/pi-coc/agent`）拷进一次性临时目录，用完即删；Jev key 全程只在环境变量里，没打印、没落盘、没提交。

  **结果（`.coc/playtests/npc-act-probe-20260926T120817Z/summary.md`，逐回合原表 vs 生成行对照表也在里面）：**

  - **yes 率 100%（23/23 全部答出，0 条裁判没答）**，过 ≥ 90% 的线。
  - **同一件事：9 行，没有一桌是 0**，没过通过线。按桌/轮拆分：`gate-a` r1=1、r2=3、r3=3；`gate-a2` r1=1、r2=1、r3=0。
  - **intention_only 占比 65.2%**（23 个绑定行为里 15 个落 `intention_only`——多数生成的行是"喊人/威胁报警"一类没有闭合结算方式的口头行动，符合 D3"总有兜底"的设计）。
  - **8 秒预算超时 4/27（14.8%）**：成功调用中位数 4.2–5.7 秒（最慢的成功调用 4.8 秒），说明 `npc_act.timeout_ms`（8000）离真实网络延迟的上沿不远，不是脚本的 bug，是真实测得的信号——本票不改这个预算，只如实报。
  - `gate-a2` 桌 t6–t8 三轮都没跑到：原表 t3 之后的战斗推进大量靠内嵌在 `narrate` 文本里的 `{{roll:...}}` marker 触发（旧内核的隐式机制，contract 已不认；本脚本按票面"跳过 narrate 回放"整条跳过），所以战斗在新内核里根本没起来——t4 的 `apply npc.spend_turn` 因为"战斗其实没在跑"被拒，t5 收尾那条 `apply` 因为引用的 intent ref 没建成也被拒，之后彻底停摆。`gate-a` 桌两处小拒绝（"不是他的回合"）没有级联，8 回合都跑完了。

  **同一件事没过线，未改阈值，分析如下（交给 lead 判断改指令文件还是改包）：**

  1. **本票自己的设计让这道闸门在结构上测不全。** 票面明说"不把绑定的行为执行进回放的战役"，这意味着内核自己的账本（`npc.situation` 的 `done`/`happened`）在本探针里永远不会把上一个探到的回合生成的 act 带进下一回合的包——包里只有原始录像自己的 `apply`/`resolve` 调用留下的东西。而契约 §143.5 真正的"不许重复"机制（Jev 的 `same` 问题问的是账本里"还没有结果"的行，`content/setup/npc-act.md` 的"已经试过没结果的事不再原样做"这句指令）依赖的正是这本账在真实执行时被写入。这个探针没有执行绑定，就没有这份反馈，所以它结构上测不出 §143.5 的闸门本身好不好使，只能测生成器"这一回合、给定这份处境"答得像不像人。命中的同一件事，至少一部分是探针"不执行"这个设计本身的产物，不能直接读成"生成器一定会重复"。
  2. **话虽如此，裁判给出的理由是有信息量的。** 命中的大多数是"继续同一个逃跑+呼救策略"（`gate-a` 的 t5→t7→t8、t4→t5→t6 都连续判过同一件事），措辞每次都不一样，但方向一直是"往门口退、喊人报警/救命"。这正是 npc-acts-first 这整条切片要治的老毛病（A/A2 两桌真桌复核里诺特反复喊人、反复砸电话）——新系统的生成器在**没有账本反馈**时，仍然倾向于用不同的话重复同一个大方向的应对；这算不算"同一件事"，以及有账本反馈（§143.5 真的在跑）时闸门会不会把它接住，要等 08 真桌见分晓，这个探针给不出答案。
  3. **同一件事的裁判问题，用的是 `pi -p`，不是内部 Jev 的 `same` 问题。** 票面两处都写"问一次...同一件事问题"走 `pi -p` 裁判（"asked one question...Then the same-act question"），我按字面实现——两问都过 `pi -p` 子进程（stdin 关、`--no-extensions --no-tools`），不是复用 `runtime/jev/npc-act-step.ts` 内部给账本用的那个 Jev `same` 批处理问题。母 spec（`npc-acts-first.md` 第五节）原话是"同一桌内 Jev 判同一件事的行 = 0"，字面上像是要 Jev 判；这里按本票（更晚写、更具体）的字面指示走 `pi -p`，如果 lead 的本意是要走 Jev 的 `same` 机制，需要另说。
  4. **"同一桌内"的范围，按轮不按跨轮池化。** 三轮各自是一次独立的回放+生成采样（内核种子固定所以力学状态一致，只有模型采样在变），我把"同一桌内"理解成"这一轮这一桌自己的回合顺序"，不跨三轮池化比较。如果 lead 要跨轮池化，`round-*/judge.jsonl` 里每行都在，可以重新汇总（`kind: "same_act"`，字段 `same_turn`）。

  **产物：** `.coc/playtests/npc-act-probe-20260926T120817Z/`（`round-{1,2,3}/records.jsonl` 每行 `kind: probe|refusal|turn`；`round-{1,2,3}/judge.jsonl` 每行 `kind: plausibility|same_act`；`summary.md`）。`.coc/playtests/` 已在 `.gitignore` 里，产物不进提交。
  - 复跑命令：`node tests/play/npc-act-probe.mjs --rounds 3 --seed 20260926 [--out <dir>]`（默认写到 `.coc/playtests/npc-act-probe-<timestamp>/`；本机跑，真模型，~15–20 分钟，会产生真实的 provider/Jev 调用开销）。
  - 单独重算 summary（不重新调用任何模型/内核）：临时脚本模式，`import {loadTable, RETAINED_TABLES, writeSummary} from './npc-act-probe.mjs'` 读回已有的 `round-*/records.jsonl`、`round-*/judge.jsonl` 再调 `writeSummary(outDir, {...})`；脚本顶层的 `main()` 现在只在直接执行（`node tests/play/npc-act-probe.mjs`）时跑，import 不会触发（一开始漏了这条把这件事的教训写这里：第一次因为顶层无条件 `main().catch(...)`，import 这个文件重算 summary 意外触发了一整轮新的真实回放/模型/Jev 调用，发现后立刻 kill，用时间戳目录名核对没有覆盖到已完成那次的数据，已清干净误跑产生的临时目录）。
