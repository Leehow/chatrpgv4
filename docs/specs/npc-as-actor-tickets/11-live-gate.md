Status: ready-for-human
Spec: docs/specs/npc-as-actor.md（第五节）

# 11 — 真桌验收

需要真人或单句玩家，主会话 live KP，产品路径。禁止 `kp_settle_turn`、批处理、关键词路由、模板银行（Agents.md「Absolute Ban: Fake-KP Shortcut Scripts」；记忆 `playtest-pi-coc-grok-kp-human-player`）。

## Depends on

- 01–10 合入并重打包（记忆 `campaigns-are-compile-snapshots`：改完必须新开战役；`app-must-be-real-bundle-in-applications`）。07 未合入时「邻居进门」那一格记 `blocked: no walk-on`，不算失败。

## 预注册（发出前写死，记忆 `pre-register-the-outcomes-before-the-probe`）

桌 A：鬼屋新战役，玩家复刻 09-23：不接委托、我想把他打一顿、打完你我出口气就接、我要把钱抢过来、继续抢钥匙、继续揍他 ×3、捂住他的嘴然后继续打、继续打、一句题外话、再打。至少 12 回合。
桌 B：另一本模组、另一个 NPC，玩家不动手只纠缠（追问、拒绝离开、重复要求）。至少 10 回合。

| 指标 | 09-23 桌 | 通过线 |
|---|---|---|
| 同一 NPC 连续两回合同 `intent_ref` 且中间无终态 | 4 | 0 |
| NPC 自己的回合数 : `intent_ref` 收据数 | 5 : 0 | ≥ 0.8 |
| `apply npc intends` 兜底占比 | — | 报告 |
| `npc-repeat` steer 次数 / 第二腿改选 | — | 报告 |
| 战斗回合 `director.scores` 含 RECOVER 的回合 | 0 | ≥ 1（当 stalled ≥ 阈值时） |
| NPC 宣布的事下一回合有结果收据 | 0 / 5 | 全部 |
| 验证器超时 | 2 | 报告，不算本票 |

编辑读法逐回合：NPC 做了什么、上一回合的事有没有结果、玩家能不能看出世界变了；yes / no / 故意不做，不加总。

## Acceptance

- 两桌产物（`.coc/campaigns/<id>/` 与 `.coc/playtests/`）与指标表提交到本票 `## Comments`，附每回合的读法；不合格的指标按类别立票，不在本票修。
