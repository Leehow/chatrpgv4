Status: ready-for-agent（2026-09-26，用户：「按你的推荐做，概率调高一点，威胁度越高越容易出现出乎意料的情况」）
Spec: docs/specs/npc-acts-first.md（D10）

# 20 — NPC 掏出出乎意料的东西

## 证据

C4 T10（`.coc/campaigns/npc-acts-c4/turns/0010.json` 的 stakes 收据，telemetry `purpose: npc-act`）：威胁骰 dangerous/severe（12 ≤ 12），生成器写「抓起信封砸过去冲向门口」，绑定的 `draw` 问题 Jev 答 `none` 1.0。缺的是许可与生成字段，不是绑定。

## Scope

1. **数据。** `content/rulesets/coc7/rules-json/npc-stakes.json`：每档加 `surprise_at_most`，并按 D10 的表改 `severe_at_most` / `escalates_at_most`；加许可句（`lines.surprise`，以及 severe 叠加 surprise 时的一句，英文数据）。表的校验（`stakesTable`）要求三列单调：同一档 severe ≤ surprise 不必然，但各列随档位不减；越界 → 表不可用（现有的 `campaign_not_ready` 形状）。
2. **内核威胁骰。** `kernel-ts/npc/stakes.ts`：收据加 `surprise: boolean`、`surprise_at_most`；`npc.stakes` 结果与 `npc.situation.stakes` 加 `surprise` 与许可句。既有 09 的用例靠种子挑结果，阈值变了种子要重挑（照 09 的做法挑，并断言结果与阈值一致）。
3. **生成。** `runtime/jev/npc-act.ts`：答案形状 `{act, produces?}`，`produces` 可选、单行、≤ 60 码点；`surprise` 不为真时出现的 `produces` 丢弃并在 `npc-act` 遥测行记 `produces_dropped: true`（不重试）。`content/setup/npc-act.md` 加两句（其余字节不变、不许列表）：`stakes.surprise` 为真时，他可以拿出桌上没人知道的一样东西，写进 `produces`，行动里要用上或亮出它；它要合他这个人和此刻，没有候选。
4. **绑定与落账。** `runtime/jev/npc-act-step.ts` + `kernel-ts/npc/act-options.ts`：有 `produces` 时，闭合问题在装备目录里选一条或「都不是」（`act-options` 已有 `drawCatalog` 读 `equipment.json` + `weapons.json`；扩成全目录，按类别分两步问，避免超过打包上限；D9 的 `draw` 问题并入这里，不再只看 severe）。选中武器 → 走 `stageDraw`（`kernel-ts/apply/draw.ts`）进持有、同批攻击可用；选中非武器 → 一个归他所有的物件（`world.objects.instances` 的 `owner {kind: npc, id}`，名字取书上的名）；「都不是」→ 铸一个桌上物件，名字取 `produces`，描述取行动句，无数值（用 KP 已在用的 define/object 效果路径，ADR-0005）。收据 `produced: {name, source: 'catalog' | 'table', record?}` + 意图戳 `generated`。`npc.situation.at_hand.holdings` 从下一回合起列出它（确认 01 的持有读法已覆盖 npc 名下的物件；没覆盖就补上）。
5. **契约** §139.19；§139.8 与 D9 相关段加带日期的注。

## Not in scope

- 让掏出的东西自动改变战局；没有 NPC 在场时的随机事件（导演层）。

## Acceptance

- pytest：表的三列按档单调，不单调的表被拒；固定种子下 dangerous 档掷出 ≤ 30 → `surprise: true`，> 30 → false；`npc.situation.stakes.surprise` 与收据一致。
- loop 用例（夹具端口 + Jev 夹具）：
  - surprise 为真、夹具行「从内袋摸出一把袖珍手枪指着他」+ `produces: 袖珍手枪` + Jev 选到目录里的袖珍手枪 → 持有写入、同批攻击带该武器、收据 `produced.source: catalog`；
  - surprise 为真、`produces: 一张泛黄的全家福` + Jev 答「都不是」→ 铸一个归他所有的物件、无数值、`source: table`；下一回合处境包 `at_hand.holdings` 含它；
  - surprise 为假却给了 `produces` → 丢弃、遥测 `produces_dropped`、不落任何物件。
- 变异：去掉 surprise 判断（总允许掏）→ 第三条逮住；去掉「都不是」的铸造 → 第二条逮住。
- 造景（可选，Mac、真模型）：用 07 的探针对 C4 的处境跑一轮，报告 surprise 回合里 `produces` 的出现率与内容（只报告，不设线）。
