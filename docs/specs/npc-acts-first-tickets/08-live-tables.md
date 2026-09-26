Status: ready-for-human
Spec: docs/specs/npc-acts-first.md（第五节）

# 08 — 真桌 C、B

需要真人或单句玩家，主会话 live KP，产品路径。禁止 `kp_settle_turn`、批处理、关键词路由、模板银行（`Agents.md`「Absolute Ban」；记忆 `playtest-pi-coc-grok-kp-human-player`）。

## Depends on

- 01–07 合入并重打包（记忆 `campaigns-are-compile-snapshots`：改完必须新开战役）。

## 预注册（开桌前写死，记忆 `pre-register-the-outcomes-before-the-probe`）

- C 桌：鬼屋新战役，诺特，同 A2 台本（拒绝委托、打、抢钥匙、扔钥匙再打、扳手、提起来打、问房子、踹椅子再打、捡钥匙、下楼要钱），≥ 10 回合。
- B 桌：另一本模组、另一个 NPC，玩家不动手只纠缠（追问、拒绝离开、重复要求），≥ 10 回合。

| 指标 | A2 桌 | 通过线 |
|---|---|---|
| 交付 | 10/10 | 100% |
| 内容重复（Jev 同一件事 + 编辑读，按用户口径） | 5 次 | 0 |
| 宣布的事下一回合有结果 | 1/2 | 全部 |
| 裁判「像人」yes（每个 NPC 回合） | — | ≥ 90% |
| `intention_only` 占 NPC 行动收据 | — | 报告 |
| 墙钟中位 / 最长 | 32.1 s / 53.4 s | 中位 ≤ 42 s |
| 正文语言 | 全中文（一处 `</text>` 泄漏） | 全 play_language，无标记泄漏 |

编辑读法逐回合：他做了什么、像不像人、上一回合的事有没有下文；yes / no / 故意不做，不加总。

## Acceptance

- 两桌全部通过线；不通过的按类别分诊立票，不在桌上改（记忆 `long-gates-batch-fixes`）。
