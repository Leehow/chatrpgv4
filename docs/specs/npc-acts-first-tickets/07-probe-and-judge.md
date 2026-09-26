Status: ready-for-human（三处拍板后转 ready-for-agent）
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
